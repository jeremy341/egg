import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { readBytesLimited, webhookBodyReads } from "@/server/body-limit";
import { config, trustProxyEnabled } from "@/server/config";
import { admitRequest, rateLimiter } from "@/server/rate-limit-core";
import { claimDelivery, handleGithubEvent, matchesWebhookEventShape, releaseDelivery } from "@/server/github/webhook";
import { HttpError } from "@/server/http";
import { maintenanceState } from "@/server/maintenance";

/**
 * Largest body read from GitHub. GitHub allows deliveries of up to 25 MB, but
 * Egg acts on only five events (ping, push, installation, pull_request,
 * repository), and their payloads are normally a few KB. A push lists the files
 * changed in its head commit and a pull request carries its description, so 5 MiB
 * leaves room for large ones. A bigger delivery is refused with 413 and is not
 * recorded, so GitHub's redelivery is the way to retry it. Egg's security page
 * reads this value (see security-facts), so change both together.
 */
const MAX_BODY_BYTES = 5 * 1024 * 1024;
/** A body that stops arriving for this long is dropped, which frees its in-flight slot. */
const BODY_IDLE_TIMEOUT_MS = 15_000;
/**
 * The whole body must arrive within this long. GitHub gives up on a delivery after 10 seconds,
 * so a real one is never this slow; without it a few connections sending a byte at a time
 * could hold every in-flight slot and shut real deliveries out.
 */
const BODY_DEADLINE_MS = 30_000;
const SIGNATURE_FORMAT = /^sha256=[0-9a-f]{64}$/;
/**
 * A global ceiling on verified deliveries, even when no client address is known
 * (TRUST_PROXY off). It is counted only AFTER the HMAC has been verified: a
 * flood of well-formed but wrong signatures cannot burn the shared budget and
 * 429 genuine GitHub deliveries, and without the secret a flood has to hold one
 * of the few body-read slots to cost anything at all. Set above any real GitHub
 * delivery rate so legitimate events are never lost.
 */
const GLOBAL_WEBHOOK_LIMIT = 120;
const GLOBAL_WEBHOOK_WINDOW_MS = 60_000;
const GLOBAL_WEBHOOK_KEY = "webhook-global";

function maintenanceResponse() {
  return NextResponse.json({ error: { code: "maintenance", message: "GitHub events are paused during maintenance. Redeliver this event from GitHub after the window ends; Egg has not recorded it as handled." } }, { status: 503, headers: { "Retry-After": "60" } });
}

function sameSignature(expected: string, given: string): boolean {
  const a = Buffer.from(expected);
  const b = Buffer.from(given);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Read the body while hashing it, then compare the HMAC in constant time.
 * Returns null for a bad signature. The signature covers the whole body, so it
 * can only be checked at the end; the hash is fed chunk by chunk meanwhile.
 */
async function readSignedBody(req: NextRequest, secret: string, signature: string): Promise<Buffer | null> {
  const mac = createHmac("sha256", secret);
  const bytes = await readBytesLimited(req, MAX_BODY_BYTES, {
    idleTimeoutMs: BODY_IDLE_TIMEOUT_MS,
    deadlineMs: BODY_DEADLINE_MS,
    onChunk: (chunk) => mac.update(chunk),
  });
  return sameSignature(`sha256=${mac.digest("hex")}`, signature) ? bytes : null;
}

/**
 * GitHub webhook. Public by design, so the only thing that lets a request in
 * is a valid HMAC signature over the raw body. Requests are refused before any
 * body is read when they lack a length, declare too much, or carry a signature
 * that is missing or malformed. Only then is a slot taken for the read, and at
 * most a few bodies are read at once.
 */
export async function POST(req: NextRequest) {
  const secret = config().GITHUB_WEBHOOK_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "webhook not configured" }, { status: 503 });
  }
  // GitHub always sends Content-Length. Without it the size cannot be bounded
  // before reading, so it is refused.
  const declared = req.headers.get("content-length");
  if (declared === null) return NextResponse.json({ error: "length required" }, { status: 411 });
  if (!/^\d+$/.test(declared) || Number(declared) > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "payload too large" }, { status: 413 });
  }
  const signature = req.headers.get("x-hub-signature-256");
  if (!signature || !SIGNATURE_FORMAT.test(signature)) {
    return NextResponse.json({ error: "bad signature" }, { status: 401 });
  }

  // Per address, after the cheap refusals above. Never banned: GitHub's deliveries come from a few addresses.
  const limited = admitRequest(req.headers, { trustProxy: trustProxyEnabled(), bucket: "webhook" });
  if (limited.refused) {
    return NextResponse.json(
      { error: "too many webhook deliveries from this address; redeliver shortly" },
      { status: 429, headers: { "Retry-After": String(limited.retryAfterSeconds) } }
    );
  }

  const release = webhookBodyReads.acquire();
  if (!release) {
    return NextResponse.json(
      { error: "too many webhook deliveries are being received; redeliver shortly" },
      { status: 503, headers: { "Retry-After": "5" } }
    );
  }
  let body: Buffer | null = null;
  try {
    body = await readSignedBody(req, secret, signature);
  } catch (err) {
    if (err instanceof HttpError) return NextResponse.json({ error: err.message }, { status: err.status });
    throw err;
  } finally {
    release();
  }
  if (!body) return NextResponse.json({ error: "bad signature" }, { status: 401 });
  // Only now, on a verified delivery, does the shared global ceiling count: wrong
  // signatures were refused without ever touching it (see GLOBAL_WEBHOOK_LIMIT).
  const global = rateLimiter().check(GLOBAL_WEBHOOK_KEY, GLOBAL_WEBHOOK_LIMIT, GLOBAL_WEBHOOK_WINDOW_MS);
  if (!global.allowed) {
    return NextResponse.json(
      { error: "too many webhook deliveries; redeliver shortly" },
      { status: 429, headers: { "Retry-After": String(global.retryAfterSeconds) } }
    );
  }
  const raw = body.toString("utf8");

  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }
  const event = req.headers.get("x-github-event") ?? "";
  if (!matchesWebhookEventShape(event, payload)) {
    return NextResponse.json({ handled: false, deployments: [], note: "unsupported event or payload" });
  }
  // Pause every event, including preview removal and installation/repository
  // updates. Do not consume replay state for an event that was not processed.
  if ((await maintenanceState()).active) return maintenanceResponse();
  // GitHub signs the body, not the event header. Bind both into the key so an
  // invalid/alternate label cannot consume the digest for a correctly labeled event.
  const eventHash = createHash("sha256").update(event).update("\0").update(raw).digest("hex");
  if (!(await claimDelivery(eventHash))) {
    return NextResponse.json({ handled: false, deployments: [], note: "duplicate delivery" });
  }
  try {
    const result = await handleGithubEvent(event, payload);
    return NextResponse.json(result);
  } catch (err) {
    await releaseDelivery(eventHash);
    if (err instanceof HttpError && err.code === "maintenance") return maintenanceResponse();
    console.error("webhook failed", err);
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }
}
