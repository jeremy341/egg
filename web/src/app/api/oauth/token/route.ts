import { unstable_rethrow } from "next/navigation";
import { NextResponse, type NextRequest } from "next/server";
import { measureBackendRequest } from "@/server/backend-metrics";
import { readCappedText } from "@/server/api-v1-http";
import { HttpError } from "@/server/http";
import { clientIp, rateLimiter } from "@/server/rate-limit";
import { exchangeCode } from "@/server/oauth";

/**
 * RFC 6749 token endpoint for the authorization-code + PKCE flow.
 *
 * Unlike the dashboard API, this is a protocol endpoint: every failure is an
 * OAuth error object (`{"error":"invalid_grant","error_description":"..."}`),
 * not the app's `{"error":{"code":...}}` shape. It has no cookie identity and
 * no same-origin guard, so a native client or a browser-based MCP client can
 * call it directly with the credentials it was given at registration.
 */

const MAX_BODY_BYTES = 16 * 1024;
const NO_STORE = { "Cache-Control": "no-store", Pragma: "no-cache" };

// OAuth 2.1 error codes. Anything else from a lower layer becomes invalid_request.
const OAUTH_CODES = new Set([
  "invalid_request",
  "invalid_client",
  "invalid_grant",
  "unauthorized_client",
  "unsupported_grant_type",
  "invalid_scope",
  "server_error",
]);

// A small, in-process ceiling on token guesses and code replays. The project's
// shared limiter is used directly because this unauthenticated endpoint has no
// user id to key a named bucket by; a client id (or the caller's address) is
// the stable identity here.
const TOKEN_LIMIT = 60;
const TOKEN_WINDOW_MS = 60_000;

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

/** Accept both the form encoding OAuth clients send and JSON for simple callers. */
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

/**
 * Confidential clients may authenticate with HTTP Basic instead of sending the
 * secret in the body. Values in the Basic header are form-urlencoded per RFC 6749.
 */
function basicCredentials(req: NextRequest, fields: Fields): Fields {
  if (fields.client_secret !== undefined) return fields;
  const header = req.headers.get("authorization");
  if (!header?.startsWith("Basic ")) return fields;
  try {
    const decoded = Buffer.from(header.slice(6).trim(), "base64").toString("utf8");
    const colon = decoded.indexOf(":");
    if (colon < 0) return fields;
    const id = decodeURIComponent(decoded.slice(0, colon));
    const secret = decodeURIComponent(decoded.slice(colon + 1));
    if (!id) return fields;
    return { ...fields, client_id: fields.client_id ?? id, client_secret: secret };
  } catch {
    return fields;
  }
}

type Handler = (req: NextRequest) => Promise<Response>;

/** Uniform OAuth-shaped errors for this endpoint family. */
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
        console.error("Unhandled OAuth token error", err);
        return oauthError("server_error", "Something went wrong on our side.", 500);
      }
    });
}

export const POST = oauthRoute(async (req: NextRequest) => {
  const fields = basicCredentials(req, parseFields(await readCappedText(req, MAX_BODY_BYTES), req.headers.get("content-type")));

  const grantType = fields.grant_type;
  if (!grantType) problem("invalid_request", "Missing grant_type.");
  if (grantType !== "authorization_code") {
    problem("unsupported_grant_type", "Only the authorization_code grant is supported.");
  }
  for (const [name, description] of [
    ["code", "An authorization code is required."],
    ["code_verifier", "A PKCE code_verifier is required."],
    ["redirect_uri", "A redirect_uri is required."],
    ["client_id", "A client_id is required."],
  ] as const) {
    if (!fields[name]) problem("invalid_request", description);
  }

  const key = fields.client_id ?? clientIp(req.headers) ?? "anonymous";
  const limit = rateLimiter().check(`oauth:token:${key}`, TOKEN_LIMIT, TOKEN_WINDOW_MS);
  if (!limit.allowed) {
    return oauthError(
      "invalid_request",
      `Too many token requests. Wait ${limit.retryAfterSeconds} second${limit.retryAfterSeconds === 1 ? "" : "s"} and try again.`,
      429,
      { "Retry-After": String(limit.retryAfterSeconds) }
    );
  }

  // The exchange consumes the code and issues the token in one transaction.
  // client_secret is optional: PKCE alone authenticates public clients.
  const token = await exchangeCode({
    code: fields.code!,
    clientId: fields.client_id!,
    clientSecret: fields.client_secret,
    redirectUri: fields.redirect_uri!,
    codeVerifier: fields.code_verifier!,
  });
  return NextResponse.json(token, { status: 200, headers: NO_STORE });
});

const notAllowed = oauthRoute(async () => {
  throw new HttpError(405, "This endpoint only accepts POST.", "invalid_request", { Allow: "POST" });
});
export const GET = notAllowed;
export const DELETE = notAllowed;
