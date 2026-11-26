import { sha256Hex } from "@/server/crypto";
import { HttpError } from "@/server/http";

/**
 * Idempotency-Key support for the write routes of the public API.
 *
 * The first answer to a write is kept for 24 hours under (token, key). Sending the
 * same key again replays that answer without running the write a second time.
 * The same key with a different request (another path, query or body) is 422.
 * A second request that arrives while the first is still running is 409, so two
 * copies of one retry cannot both act.
 *
 * Only answers below 500 are kept. A server error is not a result, so its key is
 * released and a retry runs the request again.
 *
 * Storage is in-process, like the rate limiter: the table is not in the database,
 * so a restart forgets the keys. Same single-container invariant as rate-limit-core.ts.
 */

export const IDEMPOTENCY_HEADER = "Idempotency-Key";
export const IDEMPOTENCY_TTL_MS = 24 * 3_600_000;
const MAX_ENTRIES = 10_000;
const KEY = Symbol.for("egg.idempotency");

type Pending = { state: "pending"; fingerprint: string; expiresAt: number };
type Done = {
  state: "done";
  fingerprint: string;
  expiresAt: number;
  status: number;
  body: string;
  headers: [string, string][];
  /** The answer held a secret and was not kept; a repeat is refused. */
  sensitive?: boolean;
};
type Entry = Pending | Done;

function table(): Map<string, Entry> {
  const g = globalThis as unknown as Record<symbol, Map<string, Entry> | undefined>;
  return (g[KEY] ??= new Map<string, Entry>());
}

/** The header's value, or null when the request has none. A malformed value is a 400. */
export function idempotencyKeyFrom(req: Request): string | null {
  const raw = req.headers.get(IDEMPOTENCY_HEADER);
  if (raw === null) return null;
  const key = raw.trim();
  if (!/^[\x21-\x7e]{1,255}$/.test(key)) {
    throw new HttpError(400, "Idempotency-Key must be 1 to 255 visible ASCII characters.", "validation");
  }
  return key;
}

/** What makes two requests "the same": method, path with query, and the exact body bytes. */
export function fingerprintOf(method: string, pathAndQuery: string, body: string): string {
  return sha256Hex(`${method.toUpperCase()}\n${pathAndQuery}\n${body}`);
}

function sweep(t: Map<string, Entry>, now: number) {
  for (const [k, e] of t) if (e.expiresAt <= now) t.delete(k);
}

/**
 * Run a write once per (scope, key). `scope` is the token id, so one token can
 * never read or replay another token's answer. `run` returns the Response to
 * keep; `now` is injectable for tests.
 */
export async function withIdempotency(opts: {
  scope: string;
  key: string;
  fingerprint: string;
  run: () => Promise<Response>;
  now?: number;
  /** The answer contains a secret. It is not stored, so a repeat is refused rather than replayed. */
  sensitive?: boolean;
}): Promise<Response> {
  const now = opts.now ?? Date.now();
  const t = table();
  const k = `${opts.scope}\u0000${opts.key}`;
  if (t.size >= MAX_ENTRIES) sweep(t, now);

  const seen = t.get(k);
  if (seen && seen.expiresAt <= now) t.delete(k);
  const live = seen && seen.expiresAt > now ? seen : undefined;

  if (live) {
    if (live.fingerprint !== opts.fingerprint) {
      throw new HttpError(422, "This Idempotency-Key was already used for a different request.", "idempotency_mismatch");
    }
    if (live.state === "pending") {
      throw new HttpError(409, "A request with this Idempotency-Key is still in progress. Wait and retry.", "idempotency_in_progress", {
        "Retry-After": "1",
      });
    }
    if (live.sensitive) {
      throw new HttpError(409, "This request already ran and its answer held a secret, so it is not replayed. Check the result with a read call.", "idempotency_secret_not_replayed");
    }
    return new Response(live.body, { status: live.status, headers: [...live.headers, ["Idempotent-Replayed", "true"]] });
  }

  // Claim the key before any await, so a concurrent request sees it as pending.
  const claim: Pending = { state: "pending", fingerprint: opts.fingerprint, expiresAt: now + IDEMPOTENCY_TTL_MS };
  t.delete(k);
  t.set(k, claim);
  if (t.size > MAX_ENTRIES) {
    const oldest = t.keys().next();
    if (!oldest.done) t.delete(oldest.value);
  }

  let res: Response;
  try {
    res = await opts.run();
  } catch (err) {
    if (t.get(k) === claim) t.delete(k);
    throw err;
  }
  if (res.status >= 500) {
    if (t.get(k) === claim) t.delete(k);
    return res;
  }
  const body = await res.text();
  const headers = [...res.headers.entries()];
  if (t.get(k) === claim) {
    if (opts.sensitive) {
      t.set(k, { state: "done", fingerprint: opts.fingerprint, expiresAt: claim.expiresAt, status: res.status, body: "", headers: [], sensitive: true });
    } else {
      t.set(k, { state: "done", fingerprint: opts.fingerprint, expiresAt: claim.expiresAt, status: res.status, body, headers });
    }
  }
  return new Response(body, { status: res.status, headers });
}

/** Test helper: forget every stored key. */
export function clearIdempotencyKeys(): void {
  table().clear();
}
