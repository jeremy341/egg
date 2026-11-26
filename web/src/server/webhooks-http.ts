import type { NextRequest } from "next/server";
import { requireScope, type Principal, type Scope } from "@/server/api-tokens";
import { withIdempotency, fingerprintOf, idempotencyKeyFrom } from "@/server/api-idempotency";
import { authenticate, httpErrorResponse, jsonResponse, readCappedText } from "@/server/api-v1-http";
import { API_LIMITS, enforceApiRate, type Bucket } from "@/server/api-v1-kit";
import { handle, HttpError } from "@/server/http";
import { rateLimiter } from "@/server/rate-limit";

/**
 * Shared glue for the /api/v1/webhooks routes. Same rules as the rest of the
 * public API: bearer token only (cookies are never read), the token must hold
 * the scope, the existing per-token rate limit applies, and every webhook is
 * looked up by the token's owner, so another user's id is a plain 404.
 */

type Ctx = { params: Promise<Record<string, string | string[] | undefined>> };

const MAX_BODY_BYTES = 4 * 1024;

/** A small JSON object body, or an empty object when there is none. */
export async function readObjectBody(req: Request): Promise<Record<string, unknown>> {
  const text = (await readCappedText(req, MAX_BODY_BYTES)).trim();
  if (text === "") return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new HttpError(400, "Request body must be JSON", "bad_json");
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new HttpError(400, "Request body must be a JSON object", "bad_json");
  }
  return parsed as Record<string, unknown>;
}

export function webhookRoute(
  scope: Scope,
  bucket: Bucket,
  fn: (principal: Principal, req: NextRequest, webhookId: string | undefined) => Promise<{ data: unknown; status?: number }>,
  sensitive = false
) {
  return handle<Ctx>(
    async (req, ctx) => {
      const principal = await authenticate(req);
      requireScope(principal, scope);
      enforceApiRate(principal, bucket);
      // Checked before any work, so a malformed key is a 400 and never runs the write.
      const idemKey = req.method === "GET" ? null : idempotencyKeyFrom(req);
      const id = (await ctx.params).webhookId;
      const webhookId = typeof id === "string" ? id : undefined;

      const run = async (): Promise<Response> => {
        try {
          const { data, status } = await fn(principal, req, webhookId);
          // Secret-bearing callbacks must pass sensitive=true; only the no-replay marker is kept.
          return jsonResponse(data, status ?? 200);
        } catch (err) {
          if (idemKey !== null && err instanceof HttpError) return httpErrorResponse(err);
          throw err;
        }
      };
      if (idemKey === null) return run();

      // A clone keeps the body for fn; the size cap matches what fn reads.
      const text = await readCappedText(req.clone(), MAX_BODY_BYTES);
      return withIdempotency({
        scope: principal.tokenId,
        key: idemKey,
        fingerprint: fingerprintOf(req.method, req.nextUrl.pathname + req.nextUrl.search, text),
        sensitive,
        run,
      });
    },
    { skipOriginCheck: true }
  );
}

/**
 * The Account page uses its own routes with the signed-in browser session (the
 * v1 routes above take a bearer token only). The same sliding-window limiter
 * applies: 30 changes a minute, and 10 test sends a minute.
 */
export function enforceSessionRate(userId: string, kind: "write" | "test"): void {
  const { limit, windowMs } = API_LIMITS[kind === "test" ? "ssh" : "write"];
  const result = rateLimiter().check(`webhooks-session:${kind}:${userId}`, limit, windowMs);
  if (result.allowed) return;
  const seconds = result.retryAfterSeconds;
  throw new HttpError(
    429,
    `Too many requests. Wait ${seconds} second${seconds === 1 ? "" : "s"} and try again.`,
    "rate_limited",
    { "Retry-After": String(seconds) }
  );
}
