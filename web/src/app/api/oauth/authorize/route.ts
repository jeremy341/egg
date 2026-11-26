import { connection, NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/server/auth/current";
import { safeNextPath } from "@/server/auth/redirect";
import { config } from "@/server/config";
import { readTextLimited } from "@/server/body-limit";
import { handle, HttpError } from "@/server/http";
import {
  createGrant,
  DEFAULT_MCP_SCOPE,
  getClient,
  MCP_SCOPES,
  summarizeClient,
  validateRedirectUri,
  type ClientSummary,
} from "@/server/oauth";

/** SHA-256 base64url challenge: exactly 43 unpadded characters. */
const CHALLENGE_RE = /^[A-Za-z0-9_-]{43}$/;
/** Keep client-supplied state small enough to echo back safely. */
const MAX_STATE_LENGTH = 512;

/**
 * An authorization failure that can be reported to the client. Redirect URIs
 * are only carried once they have been checked against the registered list, so
 * an attacker cannot use an error response to turn this into an open redirect.
 */
class OAuthFailure extends Error {
  constructor(
    readonly code: string,
    readonly redirectUri?: string,
    readonly state?: string | null
  ) {
    super(code);
    this.name = "OAuthFailure";
  }
}

type RequestContext = { redirectUri?: string; state?: string | null };

type AuthorizeRequest = {
  client: ClientSummary;
  redirectUri: string;
  scopes: string[];
  state: string;
  codeChallenge: string;
  codeChallengeMethod: "S256";
};

type Reader = (key: string) => string | null;

function fail(ctx: RequestContext, code: string): never {
  throw new OAuthFailure(code, ctx.redirectUri, ctx.state);
}

/**
 * Validate an authorization request once and use the same rules for the GET
 * that shows consent and the POST that creates the grant. The hidden fields on
 * the form are never trusted on their own: every value is checked again here,
 * including the redirect URI against the client's registered list.
 */
async function validateRequest(read: Reader, ctx: RequestContext): Promise<AuthorizeRequest> {
  const clientId = read("client_id");
  if (!clientId) fail(ctx, "invalid_request");

  const row = await getClient(clientId);
  if (!row) fail(ctx, "invalid_client");
  const client = summarizeClient(row);

  const redirectUri = validateRedirectUri(read("redirect_uri"), client.redirectUris);
  ctx.redirectUri = redirectUri;

  const state = read("state");
  if (!state || state.length > MAX_STATE_LENGTH) fail(ctx, "invalid_request");
  ctx.state = state;

  if (read("response_type") !== "code") fail(ctx, "unsupported_response_type");

  // An omitted scope means the default (mcp:deploy), which the client must hold.
  // The client can only ask for scopes it registered, so this never widens it.
  const scopeParam = read("scope");
  const scopes = scopeParam
    ? [...new Set(scopeParam.split(/\s+/).filter(Boolean))]
    : [DEFAULT_MCP_SCOPE];
  const known = MCP_SCOPES as readonly string[];
  if (scopes.length === 0 || scopes.some((scope) => !known.includes(scope))) fail(ctx, "invalid_scope");
  if (scopes.some((scope) => !(client.scopes as readonly string[]).includes(scope))) fail(ctx, "invalid_scope");

  const codeChallengeMethod = read("code_challenge_method") ?? "S256";
  if (codeChallengeMethod !== "S256") fail(ctx, "invalid_request");
  const codeChallenge = read("code_challenge");
  if (!codeChallenge || !CHALLENGE_RE.test(codeChallenge)) fail(ctx, "invalid_request");

  return { client, redirectUri, scopes, state, codeChallenge, codeChallengeMethod: "S256" };
}

/** Send someone who is signed out to sign in, and back to this request afterwards. */
function loginRedirectTo(nextPath: string) {
  const next = safeNextPath(nextPath);
  const url = new URL("/login", config().APP_URL);
  url.searchParams.set("next", next);
  return NextResponse.redirect(url, 303);
}

/** The consent screen, with only values that already passed validation. */
function consentUrl(request: AuthorizeRequest) {
  const url = new URL("/oauth/consent", config().APP_URL);
  url.searchParams.set("client_id", request.client.clientId);
  url.searchParams.set("redirect_uri", request.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", request.scopes.join(" "));
  url.searchParams.set("state", request.state);
  url.searchParams.set("code_challenge", request.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url;
}

/** Report an error to the registered client, or show a local error when there is no safe URI. */
function failureResponse(failure: OAuthFailure) {
  const state = failure.state ?? null;
  if (failure.redirectUri) {
    try {
      const url = new URL(failure.redirectUri);
      url.searchParams.set("error", failure.code);
      if (state !== null) url.searchParams.set("state", state);
      return NextResponse.redirect(url, 303);
    } catch {
      // A validated URI should always parse; fall through to the local error.
    }
  }
  const url = new URL("/oauth/consent", config().APP_URL);
  url.searchParams.set("error", failure.code);
  if (state !== null) url.searchParams.set("state", state);
  return NextResponse.redirect(url, 303);
}

function toFailure(err: unknown, ctx: RequestContext): OAuthFailure {
  if (err instanceof OAuthFailure) return err;
  if (err instanceof HttpError) return new OAuthFailure(err.code, ctx.redirectUri, ctx.state);
  throw err;
}

/**
 * Authorization endpoint. Signed-out visitors are sent to sign in with a safe
 * return path; signed-in visitors are sent to the consent screen. Errors that
 * carry a registered redirect URI go back to the client as OAuth error params.
 */
export async function GET(req: NextRequest) {
  // State (session, clock) decides the response, so this route is never prerendered.
  await connection();
  const ctx: RequestContext = {};
  try {
    const request = await validateRequest((key) => req.nextUrl.searchParams.get(key), ctx);
    if (!(await getCurrentUser())) {
      return loginRedirectTo(`${req.nextUrl.pathname}${req.nextUrl.search}`);
    }
    return NextResponse.redirect(consentUrl(request), 303);
  } catch (err) {
    return failureResponse(toFailure(err, ctx));
  }
}

/**
 * Consent decision. The form POSTs the same fields the GET validated; approval
 * creates a single-use authorization code and redirects with `code` and
 * `state`. Denial returns `error=access_denied` to the client instead.
 */
export const POST = handle(async (req: NextRequest) => {
  const ctx: RequestContext = {};
  try {
    // OAuth consent is a small form-urlencoded POST. Read it through the
    // capped reader so a huge body cannot be buffered in memory.
    const body = await readTextLimited(req, 16 * 1024);
    const form = new URLSearchParams(body);
    const read: Reader = (key) => form.get(key);
    const request = await validateRequest(read, ctx);

    const user = await getCurrentUser();
    if (!user) {
      const consent = consentUrl(request);
      return loginRedirectTo(`${consent.pathname}${consent.search}`);
    }

    const decision = read("decision");
    if (decision === "deny") {
      const url = new URL(request.redirectUri);
      url.searchParams.set("error", "access_denied");
      url.searchParams.set("state", request.state);
      return NextResponse.redirect(url, 303);
    }
    if (decision !== "approve") fail(ctx, "invalid_request");

    const grant = await createGrant({
      clientId: request.client.clientId,
      userId: user.id,
      redirectUri: request.redirectUri,
      scopes: request.scopes,
      codeChallenge: request.codeChallenge,
      codeChallengeMethod: request.codeChallengeMethod,
    });
    const url = new URL(grant.redirectUri);
    url.searchParams.set("code", grant.code);
    url.searchParams.set("state", request.state);
    return NextResponse.redirect(url, 303);
  } catch (err) {
    return failureResponse(toFailure(err, ctx));
  }
});
