import { randomUUID } from "node:crypto";
import { and, eq, lte } from "drizzle-orm";
import { sha256Hex } from "@/server/crypto";
import { type Db, getDb } from "@/server/db";
import { idempotencyKeys } from "@/server/db/schema";
import { HttpError } from "@/server/http";

/**
 * Idempotency-Key support for the write routes of the public API and the MCP write tools.
 *
 * The first answer to a write is kept for 24 hours under (token, key). Sending the
 * same key again replays that answer without running the write a second time.
 * The same key with a different request (another path, query or body) is 422.
 * A second request that arrives while the first is still running is 409, so two
 * copies of one retry cannot both act.
 *
 * Only answers below 500 are kept. A server error is not a result, so its key is
 * released and a retry runs the request again. A sensitive answer (one that shows a
 * secret) is never kept: its key stays claimed, and a repeat is refused with 409.
 *
 * Storage is the `idempotency_keys` table, so a key survives a restart and every
 * process sees the same answers. A key whose request died mid-write stays pending
 * (a repeat is 409) until it expires, rather than running the write again.
 */

export const IDEMPOTENCY_HEADER = "Idempotency-Key";
export const IDEMPOTENCY_TTL_MS = 24 * 3_600_000;
const SWEEP_EVERY_MS = 60_000;
const CLAIM_ATTEMPTS = 3;

type Row = typeof idempotencyKeys.$inferSelect;

let lastSweep = 0;

/** Validate a key: 1 to 255 visible ASCII characters, surrounding spaces ignored. A malformed key is a 400. */
export function parseIdempotencyKey(raw: unknown): string {
  const key = typeof raw === "string" ? raw.trim() : "";
  if (!/^[\x21-\x7e]{1,255}$/.test(key)) {
    throw new HttpError(400, "Idempotency-Key must be 1 to 255 visible ASCII characters.", "validation");
  }
  return key;
}

/** The header's value, or null when the header is absent. A malformed value is a 400. */
export function idempotencyKeyFromHeader(raw: string | null): string | null {
  return raw === null ? null : parseIdempotencyKey(raw);
}

/** The header's value, or null when the request has none. A malformed value is a 400. */
export function idempotencyKeyFrom(req: Request): string | null {
  return idempotencyKeyFromHeader(req.headers.get(IDEMPOTENCY_HEADER));
}

/** What makes two requests "the same": method, path with query, and the exact body bytes. */
export function fingerprintOf(method: string, pathAndQuery: string, body: string): string {
  return sha256Hex(`${method.toUpperCase()}\n${pathAndQuery}\n${body}`);
}

/** Drop expired rows, at most once a minute per process. */
async function sweepExpired(db: Db, now: number): Promise<void> {
  if (now - lastSweep < SWEEP_EVERY_MS) return;
  lastSweep = now;
  await db.delete(idempotencyKeys).where(lte(idempotencyKeys.expiresAt, new Date(now)));
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
  const db = await getDb();
  await sweepExpired(db, now);
  const own = and(eq(idempotencyKeys.scope, opts.scope), eq(idempotencyKeys.key, opts.key));

  for (let attempt = 0; attempt < CLAIM_ATTEMPTS; attempt++) {
    // An expired row is no answer any more, so drop it before trying to claim the key.
    await db.delete(idempotencyKeys).where(and(own, lte(idempotencyKeys.expiresAt, new Date(now))));

    // Claim the key before running anything. The insert is one statement, so of two
    // concurrent requests exactly one gets the row; the other sees it as pending.
    const claimId = randomUUID();
    const claimed = await db
      .insert(idempotencyKeys)
      .values({
        scope: opts.scope,
        key: opts.key,
        claimId,
        fingerprint: opts.fingerprint,
        state: "pending",
        createdAt: new Date(now),
        expiresAt: new Date(now + IDEMPOTENCY_TTL_MS),
      })
      .onConflictDoNothing()
      .returning({ claimId: idempotencyKeys.claimId });
    if (claimed.length === 1) return runClaimed(db, opts, claimId);

    const [seen] = await db.select().from(idempotencyKeys).where(own).limit(1);
    // Released by its request a moment ago: try to claim it again.
    if (!seen) continue;
    if (seen.expiresAt.getTime() <= now) {
      await db.delete(idempotencyKeys).where(and(own, eq(idempotencyKeys.claimId, seen.claimId)));
      continue;
    }
    return answerFrom(seen, opts);
  }
  throw new HttpError(409, "A request with this Idempotency-Key is still in progress. Wait and retry.", "idempotency_in_progress", {
    "Retry-After": "1",
  });
}

/** A live row answers the request: refuse a different request, wait for a pending one, or replay the kept answer. */
function answerFrom(seen: Row, opts: { fingerprint: string }): Response {
  if (seen.fingerprint !== opts.fingerprint) {
    throw new HttpError(422, "This Idempotency-Key was already used for a different request.", "idempotency_mismatch");
  }
  if (seen.state === "pending") {
    throw new HttpError(409, "A request with this Idempotency-Key is still in progress. Wait and retry.", "idempotency_in_progress", {
      "Retry-After": "1",
    });
  }
  if (seen.sensitive) {
    throw new HttpError(409, "This request already ran and its answer held a secret, so it is not replayed. Check the result with a read call.", "idempotency_secret_not_replayed");
  }
  const kept = JSON.parse(seen.headers) as [string, string][];
  return new Response(seen.body, { status: seen.status ?? 200, headers: [...kept, ["Idempotent-Replayed", "true"]] });
}

/** Run the write for a claim this request holds, then keep its answer, or release the key. */
async function runClaimed(
  db: Db,
  opts: { scope: string; key: string; run: () => Promise<Response>; sensitive?: boolean },
  claimId: string
): Promise<Response> {
  const mine = and(
    eq(idempotencyKeys.scope, opts.scope),
    eq(idempotencyKeys.key, opts.key),
    eq(idempotencyKeys.claimId, claimId)
  );
  // A failed release leaves the claim to expire. The caller needs the original error, not this one.
  const release = async () => {
    try {
      await db.delete(idempotencyKeys).where(mine);
    } catch {
      /* the claim expires on its own */
    }
  };

  let res: Response;
  let body: string;
  try {
    res = await opts.run();
    if (res.status >= 500) {
      await release();
      return res;
    }
    body = await res.text();
  } catch (err) {
    await release();
    throw err;
  }

  // If this write fails to store its answer, the claim stays pending: the write ran, so a
  // retry must be refused rather than run again.
  const headers = [...res.headers.entries()];
  await db
    .update(idempotencyKeys)
    .set(
      opts.sensitive
        ? { state: "done", status: res.status, body: "", headers: "[]", sensitive: true }
        : { state: "done", status: res.status, body, headers: JSON.stringify(headers), sensitive: false }
    )
    .where(mine);
  return new Response(body, { status: res.status, headers });
}

/** Test helper: forget every stored key. */
export async function clearIdempotencyKeys(): Promise<void> {
  const db = await getDb();
  await db.delete(idempotencyKeys);
}
