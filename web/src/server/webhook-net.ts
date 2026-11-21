import { promises as dns, type LookupAddress } from "node:dns";
import { request } from "node:https";
import { isIP } from "node:net";
import { HttpError } from "@/server/http";
import { isPublicAddress } from "@/server/net-guard";

/**
 * The network side of outbound webhooks. The server posts to an address the
 * user chose, so this is the SSRF boundary:
 *
 * - The URL is https on port 443, with a domain name (no IP literal), no
 *   credentials and no fragment (`parseWebhookUrl`).
 * - At send time the name is resolved and every answer must be public
 *   (`resolveSafeAddress`, built on `isPublicAddress`, which refuses private,
 *   loopback, link-local and metadata, multicast, carrier-grade NAT, unique
 *   local, reserved, and IPv6 forms that embed one of those IPv4 ranges).
 * - The connection goes to that checked address: the request's DNS lookup is
 *   pinned to it, so a second lookup cannot rebind the name. TLS still checks
 *   the certificate against the hostname.
 * - Redirects are never followed, the whole exchange has a 5 second limit, and
 *   at most 4 KB of the response is read and then thrown away.
 */

export const SEND_TIMEOUT_MS = 5000;
export const RESPONSE_CAP_BYTES = 4096;
export const URL_MAX_LENGTH = 500;

/** Internal marker so a resolution deadline is told apart from a DNS failure. */
class DeadlineError extends Error {}

/** Race work against a deadline, clearing the timer as soon as it settles. */
function withDeadline<T>(work: Promise<T>, ms: number): Promise<T> {
  // The lookup keeps running after the deadline. Give it a rejection handler so a
  // late failure cannot surface as an unhandled rejection.
  work.catch(() => {});
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new DeadlineError()), ms);
    work.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); }
    );
  });
}

export type SendErrorCode =
  | "dns_failed"
  | "blocked_address"
  | "timeout"
  | "redirect"
  | "network"
  | `http_${number}`;

export class WebhookSendError extends Error {
  constructor(
    readonly code: SendErrorCode,
    message: string,
    /** True when trying again later might work. */
    readonly retryable = false
  ) {
    super(message);
    this.name = "WebhookSendError";
  }
}

const invalid = (message: string) => new HttpError(400, message, "validation");

/** Check a webhook URL before it is stored. Throws a 400 with a plain reason. */
export function parseWebhookUrl(raw: string): URL {
  const text = raw.trim();
  if (text.length === 0 || text.length > URL_MAX_LENGTH) {
    throw invalid(`The URL must be 1 to ${URL_MAX_LENGTH} characters.`);
  }
  let u: URL;
  try {
    u = new URL(text);
  } catch {
    throw invalid("That is not a valid URL.");
  }
  if (u.protocol !== "https:") throw invalid("The URL must start with https://.");
  if (u.username || u.password) throw invalid("Remove the user name and password from the URL.");
  if (u.hash || text.includes("#")) throw invalid("Remove the # part from the URL.");
  // The URL parser drops :443, so any port left over is a different one.
  if (u.port !== "") throw invalid("Use the standard https port (443).");
  const host = u.hostname.replace(/^\[|\]$/g, "");
  // The parser also turns 2130706433 and 0x7f.1 into dotted form, so this catches them.
  if (isIP(host)) throw invalid("Use a domain name, not an IP address.");
  if (!host.includes(".")) throw invalid("Use a full public domain name.");
  return u;
}

/** True for anything that is not a public, globally routable address. */
export function isBlockedAddress(address: string): boolean {
  return !isPublicAddress(address);
}

export type Lookup = (host: string) => Promise<{ address: string; family: number }[]>;

export const systemLookup: Lookup = (host) => dns.lookup(host, { all: true, verbatim: true });

/**
 * Resolve the host and return one address to connect to. Every answer must be
 * public: one internal record is enough to refuse.
 */
export async function resolveSafeAddress(
  host: string,
  lookup: Lookup = systemLookup
): Promise<{ address: string; family: 4 | 6 }> {
  if (isIP(host.replace(/^\[|\]$/g, ""))) {
    throw new WebhookSendError("blocked_address", "IP addresses are not allowed.");
  }
  let found: { address: string; family: number }[];
  try {
    found = await lookup(host);
  } catch {
    throw new WebhookSendError("dns_failed", "The name did not resolve.", true);
  }
  if (found.length === 0) throw new WebhookSendError("dns_failed", "The name did not resolve.", true);
  if (found.some((f) => isBlockedAddress(f.address))) {
    throw new WebhookSendError("blocked_address", "The name points at a private or internal address.");
  }
  const first = found[0];
  return { address: first.address, family: isIP(first.address) === 6 ? 6 : 4 };
}

export type SendRequest = {
  url: URL;
  /** The checked address. The transport must connect here and nowhere else. */
  address: string;
  family: 4 | 6;
  headers: Record<string, string>;
  body: string;
  timeoutMs: number;
  maxBytes: number;
};

/** Posts one request and reports the status. Never follows a redirect. */
export type Transport = (req: SendRequest) => Promise<{ status: number }>;

/** The real transport: node https with the lookup pinned to the checked address. */
export const httpsTransport: Transport = (req) =>
  new Promise((resolve, reject) => {
    let settled = false;
    const finish = (err: WebhookSendError | null, status = 0) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (err) reject(err);
      else resolve({ status });
    };

    const r = request(
      {
        method: "POST",
        host: req.url.hostname,
        servername: req.url.hostname,
        port: 443,
        path: `${req.url.pathname}${req.url.search}`,
        headers: { ...req.headers, "content-length": String(Buffer.byteLength(req.body)) },
        // No shared keep-alive pool: each request carries its own pinned address.
        agent: false,
        lookup: (_host, options, cb) => {
          const pinned: LookupAddress = { address: req.address, family: req.family };
          if (options.all) (cb as (e: null, a: LookupAddress[]) => void)(null, [pinned]);
          else (cb as (e: null, a: string, f: number) => void)(null, req.address, req.family);
        },
      },
      (res) => {
        const status = res.statusCode ?? 0;
        if (status >= 300 && status < 400) {
          res.destroy();
          r.destroy();
          return finish(new WebhookSendError("redirect", "The receiver answered with a redirect, which is not followed."));
        }
        let read = 0;
        res.on("data", (chunk: Buffer) => {
          read += chunk.length;
          // Read at most the cap, then stop: the body is never used.
          if (read >= req.maxBytes) {
            res.destroy();
            finish(null, status);
          }
        });
        res.on("end", () => finish(null, status));
        res.on("error", () => finish(null, status));
      }
    );
    const timer = setTimeout(() => {
      r.destroy();
      finish(new WebhookSendError("timeout", "The receiver did not answer within 5 seconds.", true));
    }, req.timeoutMs);
    r.on("error", () => finish(new WebhookSendError("network", "Could not connect to the receiver.", true)));
    r.end(req.body);
  });

export type SendDeps = {
  lookup?: Lookup;
  transport?: Transport;
  /** Total budget shared by the DNS lookup and the send. Defaults to SEND_TIMEOUT_MS. */
  timeoutMs?: number;
};

/**
 * Resolve, check and post. Resolves on a 2xx answer; otherwise throws a
 * WebhookSendError whose `retryable` says whether another attempt makes sense.
 * The lookup is bounded too, and the time it used comes off the send's budget,
 * so a stalled DNS server cannot hold the whole exchange past the deadline.
 */
export async function safePost(
  url: URL,
  headers: Record<string, string>,
  body: string,
  deps: SendDeps = {}
): Promise<{ status: number }> {
  const totalMs = deps.timeoutMs ?? SEND_TIMEOUT_MS;
  const startedAt = Date.now();
  let target: { address: string; family: 4 | 6 };
  try {
    target = await withDeadline(resolveSafeAddress(url.hostname, deps.lookup ?? systemLookup), totalMs);
  } catch (err) {
    if (err instanceof DeadlineError) {
      throw new WebhookSendError("timeout", "The receiver did not answer within 5 seconds.", true);
    }
    throw err;
  }
  const remaining = Math.max(1, totalMs - (Date.now() - startedAt));
  const { status } = await (deps.transport ?? httpsTransport)({
    url,
    ...target,
    headers,
    body,
    timeoutMs: remaining,
    maxBytes: RESPONSE_CAP_BYTES,
  });
  if (status >= 200 && status < 300) return { status };
  if (status >= 300 && status < 400) {
    throw new WebhookSendError("redirect", "The receiver answered with a redirect, which is not followed.");
  }
  throw new WebhookSendError(
    `http_${status}`,
    `The receiver answered ${status}.`,
    status >= 500 || status === 429 || status === 408
  );
}
