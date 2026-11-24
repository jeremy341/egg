import { NextResponse, type NextRequest } from "next/server";
import { bearerFrom, principalFor, type Principal } from "@/server/api-tokens";
import { callEndpoint, endpointById, enforceApiRate, type Endpoint } from "@/server/api-v1";
import { fingerprintOf, idempotencyKeyFrom, withIdempotency } from "@/server/api-idempotency";
import { handle, HttpError } from "@/server/http";
import { assertRateRoom, clientIp, enforceRateLimit } from "@/server/rate-limit";

/**
 * HTTP glue for the public API and the MCP endpoint. The ONLY credential
 * accepted here is `Authorization: Bearer egg_...`. Cookies are never read, so
 * a signed-in browser session cannot act through the API.
 */

const WWW_AUTHENTICATE = { "WWW-Authenticate": "Bearer" };

/** The same answer for a missing header, a wrong prefix, and an unknown, revoked or expired token. */
export async function authenticate(req: Request): Promise<Principal> {
  const secret = bearerFrom(req);
  if (secret === null) {
    throw new HttpError(
      401,
      "Send an access token as an Authorization: Bearer egg_... header.",
      "unauthorized",
      WWW_AUTHENTICATE
    );
  }
  // Guessing tokens is pointless against 256 random bits, but each guess costs a database
  // read. An address that keeps sending tokens that are not valid is turned away. With no
  // proxy header there is no way to tell callers apart, so nobody is throttled.
  const ip = clientIp(req.headers);
  if (ip) assertRateRoom("badToken", ip);
  const principal = await principalFor(secret);
  if (!principal) {
    if (ip) enforceRateLimit("badToken", ip);
    throw new HttpError(401, "That access token is not valid.", "unauthorized", WWW_AUTHENTICATE);
  }
  // Per token, on top of the per-user buckets in api-v1-kit.ts. Counted only for a valid token.
  enforceRateLimit("apiToken", principal.tokenId);
  return principal;
}

/** Authenticated responses are never cached. */
export function jsonResponse(data: unknown, status = 200, headers: Record<string, string> = {}) {
  return NextResponse.json(data, { status, headers: { "Cache-Control": "no-store", ...headers } });
}

/**
 * Read a size-capped text body. The Content-Length header is only a hint, so the
 * bytes are counted as they arrive and reading stops at the cap. Nothing is logged.
 */
export async function readCappedText(req: Request, maxBytes: number): Promise<string> {
  const tooLarge = () => new HttpError(413, "The request body is too large.", "too_large");
  const declared = Number(req.headers.get("content-length") ?? 0);
  if (Number.isFinite(declared) && declared > maxBytes) throw tooLarge();
  if (!req.body) return "";

  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw tooLarge();
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

/**
 * The endpoint's body fields, from the raw JSON text of its body. Unknown fields are
 * refused, and so is any field on an endpoint that takes none. An empty body is fine.
 */
export function parseBodyFields(ep: Endpoint, text: string): Record<string, unknown> {
  const allowed = Object.keys(ep.body);
  const trimmed = text.trim();
  if (trimmed === "") return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    throw new HttpError(400, "Request body must be JSON", "bad_json");
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new HttpError(400, "Request body must be a JSON object", "bad_json");
  }
  const fields = parsed as Record<string, unknown>;
  const unknown = Object.keys(fields).find((k) => !allowed.includes(k));
  if (unknown !== undefined) {
    const note =
      allowed.length === 0 ? "This endpoint takes no body fields." : `Allowed: ${allowed.join(", ")}.`;
    throw new HttpError(400, `Unknown field "${unknown.slice(0, 60)}". ${note}`, "validation");
  }
  return fields;
}

/** Read a request's body (size-capped) and parse it as the endpoint's body fields. */
export async function readBodyFields(ep: Endpoint, req: Request): Promise<Record<string, unknown>> {
  return parseBodyFields(ep, await readCappedText(req, ep.maxBodyBytes));
}

/** The same JSON error body `handle` writes. Used where a failure must be stored as a response for replay. */
export function httpErrorResponse(err: HttpError) {
  return NextResponse.json({ error: { code: err.code, message: err.message } }, { status: err.status, headers: err.headers });
}

type Ctx = { params: Promise<Record<string, string | string[] | undefined>> };

/** A route handler for one endpoint of the shared list. */
export function v1Route(id: string) {
  const ep = endpointById(id);
  if (!ep) throw new Error(`Unknown API endpoint: ${id}`);

  // Bearer only: there is no cookie, so there is nothing for a cross-site page to ride on.
  return handle<Ctx>(
    async (req: NextRequest, ctx) => {
      const principal = await authenticate(req);
      enforceApiRate(principal, ep.bucket);
      // Checked before any work, so a malformed key is a 400 and never runs the write.
      const idemKey = ep.readOnly ? null : idempotencyKeyFrom(req);

      const params = await ctx.params;
      const query: Record<string, unknown> = {};
      for (const key of Object.keys(ep.query)) {
        const v = req.nextUrl.searchParams.get(key);
        if (v !== null) query[key] = v;
      }
      const path: Record<string, unknown> = {};
      for (const key of Object.keys(ep.pathParams)) path[key] = params[key];

      const text = await readCappedText(req, ep.maxBodyBytes);
      const run = async (): Promise<Response> => {
        try {
          // Path values win, so a body field can never retarget the id in the URL.
          const body = parseBodyFields(ep, text);
          const data = await callEndpoint(principal, ep, { ...query, ...body, ...path });
          return jsonResponse(data, ep.status);
        } catch (err) {
          if (idemKey !== null && err instanceof HttpError) return httpErrorResponse(err);
          throw err;
        }
      };
      if (idemKey === null) return run();

      return withIdempotency({
        scope: principal.tokenId,
        key: idemKey,
        fingerprint: fingerprintOf(req.method, req.nextUrl.pathname + req.nextUrl.search, text),
        sensitive: ep.sensitive === true,
        run,
      });
    },
    { skipOriginCheck: true }
  );
}
