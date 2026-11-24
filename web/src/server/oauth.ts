import { createHash } from "node:crypto";
import { and, desc, eq, isNull } from "drizzle-orm";
import { newId, randomToken, safeEqual, sha256Hex } from "@/server/crypto";
import { getDb, schema, withLockRetry } from "@/server/db";
import { HttpError } from "@/server/http";

/**
 * OAuth 2.1 authorization-code server with PKCE (S256) for MCP clients.
 *
 * Only digests of authorization codes, client secrets and access tokens are
 * stored: the raw code/secret/token is shown exactly once. Codes live 10
 * minutes and are single-use; access tokens live one day. Scopes are
 * hierarchical (exec implies deploy implies read), so a token holding a
 * stronger scope satisfies every weaker check.
 *
 * Route handlers, the consent screen and the API authentication layer consume
 * these functions; nothing here reads cookies or talks to HTTP, which keeps
 * the security rules in one testable place.
 */

export const ACCESS_TOKEN_PREFIX = "egg_oauth_";
export const CLIENT_ID_PREFIX = "eggcli_";
export const CODE_TTL_MS = 10 * 60 * 1000;
export const TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
export const TOKEN_EXPIRES_IN = TOKEN_TTL_MS / 1000;
export const MAX_CLIENTS_PER_USER = 25;

/** Scopes an OAuth client may request, from weakest to strongest. */
export const OAUTH_SCOPES = ["mcp:read", "mcp:deploy", "mcp:exec"] as const;
export const MCP_SCOPES = OAUTH_SCOPES;
export type McpScope = (typeof OAUTH_SCOPES)[number];

/** Higher rank implies every lower rank. Unknown scopes rank zero. */
const SCOPE_RANK: Record<string, number> = {
  "mcp:read": 1,
  "mcp:deploy": 2,
  "mcp:exec": 3,
};

/** A SHA-256 digest, base64url without padding: exactly 43 characters. */
const CHALLENGE_RE = /^[A-Za-z0-9_-]{43}$/;
/** RFC 7636 verifier alphabet and length bounds. */
const VERIFIER_RE = /^[A-Za-z0-9._~-]{43,128}$/;

const bad = (message: string, code: string) => new HttpError(400, message, code);

// ---------------------------------------------------------------------------
// Secrets and identifiers
// ---------------------------------------------------------------------------

/** Hash a bearer token, authorization code or client secret for storage/lookup. */
export function hashToken(value: string): string {
  return sha256Hex(value);
}

export function generateClientId(): string {
  return `${CLIENT_ID_PREFIX}${randomToken(16)}`;
}

export function generateClientSecret(): string {
  return randomToken(32);
}

export function generateClientCredentials() {
  return { clientId: generateClientId(), clientSecret: generateClientSecret() };
}

/** The PKCE S256 challenge for a verifier (base64url, no padding). */
export function pkceChallenge(verifier: string): string {
  return createHash("sha256").update(verifier, "ascii").digest("base64url");
}

// ---------------------------------------------------------------------------
// Redirect URIs
// ---------------------------------------------------------------------------

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

function isLoopback(host: string): boolean {
  return LOOPBACK_HOSTS.has(host) || host.endsWith(".localhost");
}

/**
 * Validate a redirect URI. Only https is allowed, except for loopback HTTP
 * (native/desktop clients). Fragments and embedded credentials are refused.
 * When `allowed` is given the URI must also appear there literally. Returns
 * the normalized URI so callers store and compare one canonical form.
 */
export function validateRedirectUri(value: unknown, allowed?: readonly string[]): string {
  if (typeof value !== "string" || value.length === 0) {
    throw bad("A redirect URI is required.", "invalid_redirect_uri");
  }
  if (value.includes("#")) {
    throw bad("Redirect URIs must not contain a fragment.", "invalid_redirect_uri");
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw bad("Redirect URI is not a valid absolute URL.", "invalid_redirect_uri");
  }
  if (url.username || url.password) {
    throw bad("Redirect URIs must not contain credentials.", "invalid_redirect_uri");
  }
  const loopback = isLoopback(url.hostname.toLowerCase());
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) {
    throw bad("Redirect URIs must use https, or http on a loopback address.", "invalid_redirect_uri");
  }
  const normalized = url.href;
  if (allowed && !allowed.includes(normalized) && !allowed.includes(value)) {
    throw bad("That redirect URI is not registered for this client.", "invalid_redirect_uri");
  }
  return normalized;
}

export function isValidRedirectUri(value: unknown): boolean {
  try {
    validateRedirectUri(value);
    return true;
  } catch {
    return false;
  }
}

/** Host shown on the consent screen next to the full redirect URI. */
export function redirectHost(uri: string): string {
  try {
    return new URL(uri).host;
  } catch {
    return uri;
  }
}

// ---------------------------------------------------------------------------
// Scopes
// ---------------------------------------------------------------------------

/** Parse a stored/JSON scope array into the recognized MCP scopes, deduplicated. */
export function parseScopes(raw: string | readonly unknown[] | null | undefined): McpScope[] {
  let list: unknown = raw;
  if (typeof raw === "string") {
    try {
      list = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(list)) return [];
  const out = new Set<McpScope>();
  for (const item of list) {
    if (typeof item === "string" && (OAUTH_SCOPES as readonly string[]).includes(item)) out.add(item as McpScope);
  }
  return [...out];
}

/** True when `held` grants `required`, counting the hierarchy exec > deploy > read. */
export function hasScope(held: readonly string[], required: string): boolean {
  const needed = SCOPE_RANK[required];
  if (needed === undefined) return false;
  return held.some((scope) => (SCOPE_RANK[scope] ?? 0) >= needed);
}

export function requireScope(held: readonly string[], required: string): void {
  if (!hasScope(held, required)) {
    throw new HttpError(403, `This token does not have the ${required} permission.`, "forbidden");
  }
}

/** Validate and normalize a requested scope list (non-empty, known scopes only). */
function normalizeScopes(raw: unknown): McpScope[] {
  if (!Array.isArray(raw) || raw.length === 0) throw bad("Pick at least one scope.", "invalid_scope");
  const out = new Set<McpScope>();
  for (const item of raw) {
    if (typeof item !== "string" || !(OAUTH_SCOPES as readonly string[]).includes(item)) {
      throw bad("Unknown OAuth scope.", "invalid_scope");
    }
    out.add(item as McpScope);
  }
  return [...out];
}

function parseStringArray(raw: string): string[] {
  try {
    const list = JSON.parse(raw) as unknown;
    return Array.isArray(list) ? list.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Client registration and listings
// ---------------------------------------------------------------------------

type ClientRow = typeof schema.oauthClients.$inferSelect;

export type ClientSummary = {
  id: string;
  name: string;
  clientId: string;
  redirectUris: string[];
  scopes: McpScope[];
  createdAt: string;
};

export function summarizeClient(row: ClientRow): ClientSummary {
  return {
    id: row.id,
    name: row.name,
    clientId: row.clientId,
    redirectUris: parseStringArray(row.redirectUris),
    scopes: parseScopes(row.scopes),
    createdAt: row.createdAt.toISOString(),
  };
}

/** Look a client up by its public id, for the authorize/consent step. */
export async function getClient(clientId: string): Promise<ClientRow | undefined> {
  const db = await getDb();
  return db.select().from(schema.oauthClients).where(eq(schema.oauthClients.clientId, clientId)).get();
}

export type RegisterClientInput = {
  userId: string;
  name: string;
  redirectUris: readonly unknown[];
  scopes: readonly unknown[];
};

/** The registration response: the raw secret is included here and nowhere else. */
export type RegisteredClient = ClientSummary & { clientSecret: string };

/**
 * Register a client. Returns the generated client id and the raw secret once;
 * only the secret's hash is stored. Redirect URIs are normalized and must be
 * https or loopback http.
 */
export async function registerClient(raw: RegisterClientInput, now = new Date()): Promise<RegisteredClient> {
  const { userId } = raw;
  const name = typeof raw?.name === "string" ? raw.name.trim() : "";
  if (!name || name.length > 80) throw bad("Give the client a name of at most 80 characters.", "validation");
  if (!Array.isArray(raw?.redirectUris) || raw.redirectUris.length === 0) {
    throw bad("Register at least one redirect URI.", "validation");
  }
  const redirectUris = [...new Set(raw.redirectUris.map((uri) => validateRedirectUri(uri)))];
  const scopes = normalizeScopes(raw?.scopes);

  const db = await getDb();
  const clientId = generateClientId();
  const clientSecret = generateClientSecret();
  const row: ClientRow = {
    id: newId(),
    userId,
    name,
    clientId,
    clientSecretHash: hashToken(clientSecret),
    redirectUris: JSON.stringify(redirectUris),
    scopes: JSON.stringify(scopes),
    createdAt: now,
  };
  await withLockRetry(() =>
    db.transaction(async (tx) => {
      const owned = await tx
        .select({ id: schema.oauthClients.id })
        .from(schema.oauthClients)
        .where(eq(schema.oauthClients.userId, userId));
      if (owned.length >= MAX_CLIENTS_PER_USER) {
        throw bad(`You can register up to ${MAX_CLIENTS_PER_USER} OAuth clients. Remove one first.`, "limit");
      }
      await tx.insert(schema.oauthClients).values(row);
    })
  );
  return { ...summarizeClient(row), clientSecret };
}

export async function listUserClients(userId: string): Promise<ClientSummary[]> {
  const db = await getDb();
  const rows = await db
    .select()
    .from(schema.oauthClients)
    .where(eq(schema.oauthClients.userId, userId))
    .orderBy(desc(schema.oauthClients.createdAt));
  return rows.map(summarizeClient);
}

/** Remove one of the user's clients and every grant/token issued to it. */
export async function revokeClient(userId: string, id: string): Promise<boolean> {
  const db = await getDb();
  const owned = await db
    .select({ clientId: schema.oauthClients.clientId })
    .from(schema.oauthClients)
    .where(and(eq(schema.oauthClients.id, id), eq(schema.oauthClients.userId, userId)))
    .get();
  if (!owned) return false;
  // Grants and tokens reference the public client id, not the row id, and the
  // tables have no FK to clients, so remove them before the client itself.
  await db.delete(schema.oauthGrants).where(eq(schema.oauthGrants.clientId, owned.clientId));
  await db.delete(schema.oauthTokens).where(eq(schema.oauthTokens.clientId, owned.clientId));
  await db.delete(schema.oauthClients).where(eq(schema.oauthClients.id, id));
  return true;
}

// ---------------------------------------------------------------------------
// Authorization codes and access tokens
// ---------------------------------------------------------------------------

export type CreateGrantInput = {
  clientId: string;
  userId: string;
  redirectUri: string;
  scopes: readonly unknown[];
  /** Base64url SHA-256 challenge from the client. */
  codeChallenge: string;
  /** Must be "S256"; PKCE "plain" is refused. */
  codeChallengeMethod?: string;
};

/** Create a single-use authorization code after checking client, URI and scopes. */
export async function createGrant(input: CreateGrantInput, now = new Date()) {
  const client = await getClient(input.clientId);
  if (!client) throw bad("Unknown OAuth client.", "invalid_client");

  const redirectUri = validateRedirectUri(input.redirectUri, parseStringArray(client.redirectUris));
  const allowedScopes = parseScopes(client.scopes) as readonly string[];
  const scopes = normalizeScopes(input.scopes);
  if (scopes.some((scope) => !allowedScopes.includes(scope))) {
    throw bad("The client is not registered for one of the requested scopes.", "invalid_scope");
  }
  if ((input.codeChallengeMethod ?? "S256") !== "S256") {
    throw bad("Only the S256 PKCE method is supported.", "invalid_request");
  }
  if (typeof input.codeChallenge !== "string" || !CHALLENGE_RE.test(input.codeChallenge)) {
    throw bad("Invalid PKCE challenge.", "invalid_request");
  }

  const code = randomToken(32);
  const row: typeof schema.oauthGrants.$inferSelect = {
    id: newId(),
    clientId: client.clientId,
    userId: input.userId,
    codeHash: hashToken(code),
    scopes: JSON.stringify(scopes),
    codeChallenge: input.codeChallenge,
    redirectUri,
    expiresAt: new Date(now.getTime() + CODE_TTL_MS),
    usedAt: null,
  };
  const db = await getDb();
  await db.insert(schema.oauthGrants).values(row);
  return { code, expiresIn: CODE_TTL_MS / 1000, expiresAt: row.expiresAt, redirectUri };
}

export type ExchangeCodeInput = {
  code: string;
  clientId: string;
  /** Optional: PKCE alone authenticates public clients; when supplied it must match. */
  clientSecret?: string;
  redirectUri: string;
  codeVerifier: string;
};

export type TokenResponse = {
  access_token: string;
  token_type: "Bearer";
  expires_in: number;
  scope: string;
};

/**
 * Exchange an authorization code for an access token. The code is consumed and
 * the token inserted in one transaction; the conditional update on `usedAt`
 * makes a second exchange of the same code fail even under concurrency.
 */
export async function exchangeCode(input: ExchangeCodeInput, now = new Date()): Promise<TokenResponse> {
  if (typeof input?.code !== "string" || !input.code) throw bad("An authorization code is required.", "invalid_grant");
  if (typeof input?.clientId !== "string" || !input.clientId) throw bad("Invalid client.", "invalid_client");
  if (typeof input?.redirectUri !== "string" || !input.redirectUri) {
    throw bad("A redirect URI is required.", "invalid_request");
  }
  if (typeof input?.codeVerifier !== "string" || !VERIFIER_RE.test(input.codeVerifier)) {
    throw bad("Invalid PKCE verifier.", "invalid_grant");
  }

  const db = await getDb();
  const client = await db.select().from(schema.oauthClients).where(eq(schema.oauthClients.clientId, input.clientId)).get();
  if (!client) throw bad("Invalid client.", "invalid_client");
  if (input.clientSecret !== undefined && input.clientSecret !== "") {
    if (!safeEqual(hashToken(input.clientSecret), client.clientSecretHash)) throw bad("Invalid client secret.", "invalid_client");
  }

  return withLockRetry(() =>
    db.transaction(async (tx) => {
      const grant = await tx
        .select()
        .from(schema.oauthGrants)
        .where(eq(schema.oauthGrants.codeHash, hashToken(input.code)))
        .get();
      if (!grant) throw bad("Invalid authorization code.", "invalid_grant");
      if (grant.usedAt) throw bad("Authorization code has already been used.", "invalid_grant");
      if (grant.expiresAt.getTime() <= now.getTime()) throw bad("Authorization code has expired.", "invalid_grant");
      if (grant.clientId !== input.clientId) throw bad("Authorization code was issued to another client.", "invalid_grant");
      if (grant.redirectUri !== input.redirectUri) throw bad("Redirect URI does not match the authorization request.", "invalid_grant");
      if (!safeEqual(pkceChallenge(input.codeVerifier), grant.codeChallenge)) {
        throw bad("PKCE verification failed.", "invalid_grant");
      }

      const used = await tx
        .update(schema.oauthGrants)
        .set({ usedAt: now })
        .where(and(eq(schema.oauthGrants.id, grant.id), isNull(schema.oauthGrants.usedAt)))
        .returning({ id: schema.oauthGrants.id });
      if (used.length === 0) throw bad("Authorization code has already been used.", "invalid_grant");

      const scopes = parseScopes(grant.scopes);
      const accessToken = `${ACCESS_TOKEN_PREFIX}${randomToken(32)}`;
      await tx.insert(schema.oauthTokens).values({
        id: newId(),
        clientId: grant.clientId,
        userId: grant.userId,
        tokenHash: hashToken(accessToken),
        scopes: JSON.stringify(scopes),
        expiresAt: new Date(now.getTime() + TOKEN_TTL_MS),
        createdAt: now,
      });
      return {
        access_token: accessToken,
        token_type: "Bearer" as const,
        expires_in: TOKEN_EXPIRES_IN,
        scope: scopes.join(" "),
      };
    })
  );
}

/** Delete a token by its raw value (RFC 7009). Unknown tokens are a no-op. */
export async function revokeToken(token: string): Promise<boolean> {
  if (typeof token !== "string" || !token) return false;
  const db = await getDb();
  const removed = await db
    .delete(schema.oauthTokens)
    .where(eq(schema.oauthTokens.tokenHash, hashToken(token)))
    .returning({ id: schema.oauthTokens.id });
  return removed.length > 0;
}

export type OAuthPrincipal = {
  userId: string;
  tokenId: string;
  clientId: string;
  scopes: McpScope[];
};

/**
 * Resolve an egg_oauth_ bearer token for the API layer. Expired and unknown
 * tokens are indistinguishable (null), as with personal access tokens.
 */
export async function principalForOAuthToken(secret: string | null, now = new Date()): Promise<OAuthPrincipal | null> {
  if (!secret || !secret.startsWith(ACCESS_TOKEN_PREFIX)) return null;
  const db = await getDb();
  const row = await db
    .select()
    .from(schema.oauthTokens)
    .where(eq(schema.oauthTokens.tokenHash, hashToken(secret)))
    .get();
  if (!row || row.expiresAt.getTime() <= now.getTime()) return null;
  return { userId: row.userId, tokenId: row.id, clientId: row.clientId, scopes: parseScopes(row.scopes) };
}
