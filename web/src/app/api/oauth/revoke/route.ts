import { unstable_rethrow } from "next/navigation";
import { NextResponse, type NextRequest } from "next/server";
import { readCappedText } from "@/server/api-v1-http";
import { measureBackendRequest } from "@/server/backend-metrics";
import { safeEqual } from "@/server/crypto";
import { HttpError } from "@/server/http";
import { clientIdForToken, getClient, hashToken, revokeToken } from "@/server/oauth";
import { clientIp, rateLimiter } from "@/server/rate-limit";

/**
 * RFC 7009 token revocation. A token that is unknown, expired or already
 * revoked is a successful no-op: an attacker who guesses a value learns
 * nothing, and a client can forget a token it no longer has. As on the token
 * endpoint, failures use OAuth error objects rather than the app's API shape.
 */

const MAX_BODY_BYTES = 16 * 1024;
const NO_STORE = { "Cache-Control": "no-store", Pragma: "no-cache" };

const OAUTH_CODES = new Set([
  "invalid_request",
  "invalid_client",
  "invalid_grant",
  "unauthorized_client",
  "unsupported_grant_type",
  "invalid_scope",
  "server_error",
]);

const REVOKE_LIMIT = 60;
const REVOKE_WINDOW_MS = 60_000;

type Fields = Record<string, string>;

function problem(code: string, message: string): never {
  throw new HttpError(400, message, code);
}

function oauthError(
  code: string,
  description: string,
  status = 400,
  headers: Record<string, string> = {}
) {
  return NextResponse.json(
    { error: code, error_description: description },
    { status, headers: { ...NO_STORE, ...headers } }
  );
}

function parseFields(text: string, contentType: string | null): Fields {
  const trimmed = text.trim();
  if (!trimmed) return {};
  const looksJson = trimmed.startsWith("{") || contentType?.includes("application/json");
  if (looksJson) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      problem("invalid_request", "The request body must be form-encoded or JSON.");
    }
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      problem("invalid_request", "The request body must be an object.");
    }
    const out: Fields = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === "string") out[key] = value;
      else if (typeof value === "number" || typeof value === "boolean") out[key] = String(value);
    }
    return out;
  }
  const out: Fields = {};
  for (const [key, value] of new URLSearchParams(trimmed)) out[key] = value;
  return out;
}

type Handler = (req: NextRequest) => Promise<Response>;

function oauthRoute(fn: Handler): Handler {
  return (req) =>
    measureBackendRequest(new URL(req.url).pathname, async () => {
      try {
        return await fn(req);
      } catch (err) {
        unstable_rethrow(err);
        if (err instanceof HttpError) {
          const code = OAUTH_CODES.has(err.code) ? err.code : "invalid_request";
          return oauthError(code, err.message, err.status === 429 ? 429 : 400, err.headers);
        }
        console.error("Unhandled OAuth revocation error", err);
        return oauthError("server_error", "Something went wrong on our side.", 500);
      }
    });
}

export const POST = oauthRoute(async (req: NextRequest) => {
  const fields = parseFields(
    await readCappedText(req, MAX_BODY_BYTES),
    req.headers.get("content-type")
  );
  const token = fields.token;
  if (!token) problem("invalid_request", "A token to revoke is required.");

  // The token_type_hint is advisory: only access tokens exist here, so a
  // refresh_token hint still lets us look the value up.
  const key = fields.client_id ?? clientIp(req.headers) ?? "anonymous";
  const limit = rateLimiter().check(`oauth:revoke:${key}`, REVOKE_LIMIT, REVOKE_WINDOW_MS);
  if (!limit.allowed) {
    return oauthError(
      "invalid_request",
      `Too many revocation requests. Wait ${limit.retryAfterSeconds} second${limit.retryAfterSeconds === 1 ? "" : "s"} and try again.`,
      429,
      { "Retry-After": String(limit.retryAfterSeconds) }
    );
  }

  if (fields.client_id) {
    const client = await getClient(fields.client_id);
    if (!client) problem("invalid_client", "Invalid client.");
    if (fields.client_secret !== undefined) {
      if (!safeEqual(hashToken(fields.client_secret), client.clientSecretHash)) {
        problem("invalid_client", "Invalid client secret.");
      }
    }
    const owner = await clientIdForToken(token);
    if (owner && owner !== fields.client_id) {
      problem("invalid_client", "That token was issued to another client.");
    }
  }

  // Unknown tokens are a no-op, matching RFC 7009. The client id check above
  // still protects a client's live tokens from being revoked by another client.
  await revokeToken(token);
  return NextResponse.json({}, { status: 200, headers: NO_STORE });
});

const notAllowed = oauthRoute(async () => {
  throw new HttpError(405, "This endpoint only accepts POST.", "invalid_request", { Allow: "POST" });
});
export const GET = notAllowed;
export const DELETE = notAllowed;
