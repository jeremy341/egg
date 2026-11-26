import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { sha256Hex } from "@/server/crypto";
import { schema } from "@/server/db";
import { upsertUser } from "@/server/auth/session";
import { useFreshDb } from "@/server/test/db";
import {
  ACCESS_TOKEN_PREFIX,
  CLIENT_ID_PREFIX,
  CODE_TTL_MS,
  OAUTH_SCOPES,
  TOKEN_TTL_MS,
  createGrant,
  exchangeCode,
  generateClientId,
  generateClientSecret,
  getClient,
  hashToken,
  hasScope,
  isValidRedirectUri,
  listUserClients,
  parseScopes,
  pkceChallenge,
  principalForOAuthToken,
  registerClient,
  requireScope,
  revokeClient,
  revokeToken,
  validateRedirectUri,
} from "@/server/oauth";

type Ctx = Awaited<ReturnType<typeof useFreshDb>>;
let ctx: Ctx;
let user: { id: string };

// RFC 7636 Appendix B test vector.
const VERIFIER = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
const CHALLENGE = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";
const REDIRECT = "http://127.0.0.1:3000/callback";

beforeAll(async () => {
  ctx = await useFreshDb();
  user = await upsertUser({ id: "oauth-core-user", name: "OAuth User", email: null, slackId: null });
});
afterAll(async () => {
  await ctx.cleanup();
});
beforeEach(async () => {
  await ctx.db.delete(schema.oauthGrants);
  await ctx.db.delete(schema.oauthTokens);
  await ctx.db.delete(schema.oauthClients);
});

async function makeClient(overrides: Record<string, unknown> = {}) {
  return registerClient({
    userId: user.id,
    name: "Test client",
    redirectUris: [REDIRECT],
    scopes: [...OAUTH_SCOPES],
    ...overrides,
  });
}

async function makeGrant(overrides: Record<string, unknown> = {}, now = new Date()) {
  const client = await makeClient();
  return {
    client,
    ...(await createGrant(
      {
        clientId: client.clientId,
        userId: user.id,
        redirectUri: REDIRECT,
        scopes: ["mcp:read"],
        codeChallenge: CHALLENGE,
        ...overrides,
      },
      now
    )),
  };
}

describe("hashing and key generation", () => {
  it("hashes tokens with sha256 and never returns the input", () => {
    expect(hashToken("egg_oauth_secret")).toBe(sha256Hex("egg_oauth_secret"));
    expect(hashToken("a")).not.toBe("a");
    expect(hashToken("a")).toHaveLength(64);
  });

  it("generates prefixed, unique client ids and unguessable secrets", () => {
    const ids = new Set(Array.from({ length: 20 }, () => generateClientId()));
    const secrets = new Set(Array.from({ length: 20 }, () => generateClientSecret()));
    expect(ids.size).toBe(20);
    expect(secrets.size).toBe(20);
    for (const id of ids) expect(id).toMatch(/^eggcli_[A-Za-z0-9_-]{20,}$/);
    for (const secret of secrets) expect(secret).toMatch(/^[A-Za-z0-9_-]{40,}$/);
  });

  it("computes the RFC 7636 S256 challenge", () => {
    expect(pkceChallenge(VERIFIER)).toBe(CHALLENGE);
  });
});

describe("redirect URI validation", () => {
  it("accepts https and http only on loopback hosts", () => {
    for (const uri of [
      "https://example.com/cb",
      "https://example.com",
      REDIRECT,
      "http://localhost:3000/cb",
      "http://[::1]:5173/cb",
      "http://app.localhost/cb",
    ]) {
      expect(isValidRedirectUri(uri), uri).toBe(true);
      expect(validateRedirectUri(uri)).toBe(new URL(uri).href);
    }
  });

  it("rejects non-loopback http, other schemes, fragments, credentials and relative URLs", () => {
    for (const uri of [
      "http://example.com/cb",
      "http://evil.com/cb#frag",
      "ftp://example.com/cb",
      "com.example.app:/cb",
      "javascript:alert(1)",
      "https://example.com/cb#section",
      "https://user:pass@example.com/cb",
      "/cb",
      "not a url",
      "",
    ]) {
      expect(isValidRedirectUri(uri), uri).toBe(false);
      expect(() => validateRedirectUri(uri)).toThrow();
    }
  });

  it("requires an exact match against a client's registered URIs", () => {
    const allowed = ["https://example.com/cb", REDIRECT];
    expect(validateRedirectUri("https://example.com/cb", allowed)).toBe("https://example.com/cb");
    expect(() => validateRedirectUri("https://example.com/other", allowed)).toThrow(/not registered/);
    expect(() => validateRedirectUri("https://evil.com/cb", allowed)).toThrow(/not registered/);
  });
});

describe("scope hierarchy", () => {
  it("parses JSON scope arrays, dropping duplicates and unknown values", () => {
    expect(parseScopes('["mcp:read","mcp:exec","mcp:read","nope"]')).toEqual(["mcp:read", "mcp:exec"]);
    expect(parseScopes("not json")).toEqual([]);
    expect(parseScopes(["mcp:deploy"])).toEqual(["mcp:deploy"]);
  });

  it("treats exec as implying deploy and read, and deploy as implying read", () => {
    expect(hasScope(["mcp:exec"], "mcp:read")).toBe(true);
    expect(hasScope(["mcp:exec"], "mcp:deploy")).toBe(true);
    expect(hasScope(["mcp:deploy"], "mcp:read")).toBe(true);
    expect(hasScope(["mcp:read"], "mcp:deploy")).toBe(false);
    expect(hasScope(["mcp:read"], "mcp:exec")).toBe(false);
    expect(hasScope(["mcp:deploy"], "mcp:exec")).toBe(false);
    expect(hasScope([], "mcp:read")).toBe(false);
    expect(hasScope(["mcp:exec"], "other:scope")).toBe(false);
    expect(() => requireScope(["mcp:deploy"], "mcp:exec")).toThrow(/mcp:exec/);
    expect(() => requireScope(["mcp:exec"], "mcp:read")).not.toThrow();
  });
});

describe("client registration and listing", () => {
  it("stores only a secret hash and returns the secret once with prefixed id", async () => {
    const client = await makeClient();
    expect(client.clientId).toMatch(new RegExp(`^${CLIENT_ID_PREFIX}`));
    expect(client.clientSecret).toHaveLength(43);
    expect(client.name).toBe("Test client");
    expect(client.redirectUris).toEqual([REDIRECT]);
    expect(client.scopes).toEqual([...OAUTH_SCOPES]);

    const row = await ctx.db.select().from(schema.oauthClients).where(eq(schema.oauthClients.id, client.id)).get();
    expect(row?.clientSecretHash).toBe(hashToken(client.clientSecret));
    expect(row?.clientSecretHash).not.toContain(client.clientSecret);
  });

  it("lists only the owner's clients and never exposes secrets or hashes", async () => {
    const mine = await makeClient({ name: "Mine" });
    const other = await upsertUser({ id: "oauth-other-user", name: "Other", email: null, slackId: null });
    await registerClient({ userId: other.id, name: "Theirs", redirectUris: [REDIRECT], scopes: ["mcp:read"] });

    const list = await listUserClients(user.id);
    expect(list.map((c) => c.name)).toEqual(["Mine"]);
    expect(list[0].clientId).toBe(mine.clientId);
    const text = JSON.stringify(list);
    expect(text).not.toContain(mine.clientSecret);
    expect(text).not.toMatch(/clientSecret|client_secret|Hash/i);
  });

  it("refuses invalid names, URIs and scopes", async () => {
    await expect(makeClient({ name: "   " })).rejects.toThrow();
    await expect(makeClient({ redirectUris: [] })).rejects.toThrow();
    await expect(makeClient({ redirectUris: ["http://example.com/cb"] })).rejects.toThrow(/https/);
    await expect(makeClient({ scopes: ["mcp:everything"] })).rejects.toThrow(/scope/i);
    expect(await ctx.db.select().from(schema.oauthClients)).toHaveLength(0);
  });

  it("removes a client together with its grants and tokens", async () => {
    const client = await makeClient();
    await createGrant({
      clientId: client.clientId,
      userId: user.id,
      redirectUri: REDIRECT,
      scopes: ["mcp:read"],
      codeChallenge: CHALLENGE,
    });
    expect((await ctx.db.select().from(schema.oauthGrants)).length).toBe(1);
    expect(await revokeClient(user.id, client.id)).toBe(true);
    expect(await listUserClients(user.id)).toHaveLength(0);
    expect(await ctx.db.select().from(schema.oauthGrants)).toHaveLength(0);
    expect(await ctx.db.select().from(schema.oauthTokens)).toHaveLength(0);
  });
});

describe("authorization codes and token exchange", () => {
  it("stores only the code hash and enforces the 10 minute lifetime", async () => {
    const now = new Date("2026-01-01T00:00:00Z");
    const { client, code } = await makeGrant({}, now);
    expect(code).toMatch(/^[A-Za-z0-9_-]{40,}$/);
    const grant = (await ctx.db.select().from(schema.oauthGrants)).at(0);
    expect(grant?.codeHash).toBe(hashToken(code));
    expect(grant?.codeHash).not.toBe(code);
    expect(grant?.expiresAt.getTime()).toBe(now.getTime() + CODE_TTL_MS);
    expect(grant?.redirectUri).toBe(REDIRECT);
    expect((await getClient(client.clientId))?.name).toBe("Test client");
  });

  it("rejects PKCE methods other than S256 and malformed challenges, and scopes the client did not register", async () => {
    const client = await makeClient({ scopes: ["mcp:read"] });
    const base = {
      clientId: client.clientId,
      userId: user.id,
      redirectUri: REDIRECT,
      codeChallenge: CHALLENGE,
    };
    await expect(createGrant({ ...base, scopes: ["mcp:read"], codeChallengeMethod: "plain" })).rejects.toThrow(/S256/);
    await expect(createGrant({ ...base, scopes: ["mcp:read"], codeChallenge: "short" })).rejects.toThrow(/challenge/i);
    await expect(createGrant({ ...base, scopes: ["mcp:exec"] })).rejects.toThrow(/scope/i);
    await expect(createGrant({ ...base, scopes: [] })).rejects.toThrow(/scope/i);
  });

  it("exchanges a code for a one-day token and resolves it as a bearer principal", async () => {
    const now = new Date("2026-01-01T00:00:00Z");
    const { client, code } = await makeGrant({ scopes: ["mcp:exec"] }, now);
    const result = await exchangeCode(
      { code, clientId: client.clientId, clientSecret: client.clientSecret, redirectUri: REDIRECT, codeVerifier: VERIFIER },
      now
    );
    expect(result).toMatchObject({
      access_token: expect.stringMatching(new RegExp(`^${ACCESS_TOKEN_PREFIX}[A-Za-z0-9_-]{40,}$`)),
      token_type: "Bearer",
      expires_in: 86400,
      scope: "mcp:exec",
    });

    const token = (await ctx.db.select().from(schema.oauthTokens)).at(0);
    expect(token?.tokenHash).toBe(hashToken(result.access_token));
    expect(token?.tokenHash).not.toContain(ACCESS_TOKEN_PREFIX);
    expect(token?.expiresAt.getTime()).toBe(now.getTime() + TOKEN_TTL_MS);
    expect(token?.createdAt.getTime()).toBe(now.getTime());

    const principal = await principalForOAuthToken(result.access_token, now);
    expect(principal).toMatchObject({ userId: user.id, tokenId: token?.id, clientId: client.clientId, scopes: ["mcp:exec"] });
    expect(hasScope(principal?.scopes ?? [], "mcp:read")).toBe(true);
    // Personal tokens, unknown tokens and expired tokens never resolve here.
    expect(await principalForOAuthToken("egg_personal", now)).toBeNull();
    expect(await principalForOAuthToken(`${ACCESS_TOKEN_PREFIX}unknown`, now)).toBeNull();
    expect(await principalForOAuthToken(result.access_token, new Date(now.getTime() + TOKEN_TTL_MS))).toBeNull();
  });

  it("consumes a code exactly once, even when two exchanges race", async () => {
    const { client, code } = await makeGrant();
    const input = { code, clientId: client.clientId, redirectUri: REDIRECT, codeVerifier: VERIFIER };
    const settled = await Promise.allSettled([exchangeCode(input), exchangeCode(input)]);
    expect(settled.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(settled.filter((r) => r.status === "rejected")).toHaveLength(1);
    expect(await ctx.db.select().from(schema.oauthTokens)).toHaveLength(1);
    await expect(exchangeCode(input)).rejects.toThrow(/already been used/i);
  });

  it("does not consume the code when the verifier, redirect, client secret or expiry is wrong", async () => {
    const now = new Date("2026-01-01T00:00:00Z");
    const { client, code } = await makeGrant({}, now);
    const base = { code, clientId: client.clientId, redirectUri: REDIRECT, codeVerifier: VERIFIER };

    await expect(exchangeCode({ ...base, codeVerifier: "x".repeat(43) }, now)).rejects.toThrow(/PKCE/i);
    await expect(exchangeCode({ ...base, redirectUri: "http://127.0.0.1:3000/other" }, now)).rejects.toThrow(/redirect/i);
    await expect(exchangeCode({ ...base, clientSecret: "wrong" }, now)).rejects.toThrow(/secret/i);
    await expect(exchangeCode({ ...base, clientId: "eggcli_unknown" }, now)).rejects.toThrow(/client/i);
    await expect(exchangeCode({ ...base, code: "unknown" }, now)).rejects.toThrow(/code/i);
    await expect(exchangeCode(base, new Date(now.getTime() + CODE_TTL_MS))).rejects.toThrow(/expired/i);

    expect((await ctx.db.select().from(schema.oauthGrants)).at(0)?.usedAt).toBeNull();
    expect(await ctx.db.select().from(schema.oauthTokens)).toHaveLength(0);
    // A valid exchange still works after the failed attempts.
    const good = await exchangeCode({ ...base, clientSecret: client.clientSecret }, now);
    expect(good.access_token).toMatch(new RegExp(`^${ACCESS_TOKEN_PREFIX}`));
  });

  it("revokes an issued token by its raw value", async () => {
    const { client, code } = await makeGrant();
    const result = await exchangeCode({ code, clientId: client.clientId, redirectUri: REDIRECT, codeVerifier: VERIFIER });
    expect(await principalForOAuthToken(result.access_token)).not.toBeNull();
    expect(await revokeToken(result.access_token)).toBe(true);
    expect(await principalForOAuthToken(result.access_token)).toBeNull();
    expect(await revokeToken(result.access_token)).toBe(false);
    expect(await revokeToken("")).toBe(false);
  });
});
