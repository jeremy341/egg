import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { upsertUser } from "@/server/auth/session";
import { randomToken } from "@/server/crypto";
import { schema, getDb } from "@/server/db";
import {
  ACCESS_TOKEN_PREFIX,
  REFRESH_TOKEN_PREFIX,
  REFRESH_TTL_MS,
  TOKEN_TTL_MS,
  createGrant,
  exchangeCode,
  exchangeRefreshToken,
  hashToken,
  pkceChallenge,
  principalForOAuthToken,
  registerClient,
  revokeClient,
  revokeToken,
} from "@/server/oauth";
import { useFreshDb } from "@/server/test/db";

/** Service-level checks for refresh tokens: rotation, narrowing, expiry, revocation and redirect matching. */

const REDIRECT = "https://cli.example.com/callback";
const T0 = new Date("2026-11-24T12:00:00Z");
const DAY = 24 * 60 * 60 * 1000;

let ctx: Awaited<ReturnType<typeof useFreshDb>>;
let userId: string;

/** Register a client with the given scopes and redirect URIs, returning its public id and secret. */
async function client(scopes: string[], redirectUris = [REDIRECT], name = "CLI") {
  const made = await registerClient({ userId, name, redirectUris, scopes }, T0);
  return { clientId: made.clientId, clientSecret: made.clientSecret };
}

/** Run the authorization step and exchange the code, returning the full token response. */
async function login(clientId: string, scopes: string[], now = T0, redirectUri = REDIRECT) {
  const verifier = randomToken(48);
  const grant = await createGrant(
    {
      clientId,
      userId,
      redirectUri,
      scopes,
      codeChallenge: pkceChallenge(verifier),
      codeChallengeMethod: "S256",
    },
    now
  );
  return exchangeCode({ code: grant.code, clientId, redirectUri, codeVerifier: verifier }, now);
}

const refreshAt = (refreshToken: string, clientId: string, now: Date, scope?: string, clientSecret?: string) =>
  exchangeRefreshToken({ refreshToken, clientId, scope, clientSecret }, now);

const failure = async (p: Promise<unknown>) => (await p.then(() => null, (e: unknown) => e)) as { code?: string; message: string } | null;

beforeAll(async () => {
  ctx = await useFreshDb();
  userId = (await upsertUser({ id: "refresh-user", name: "Refresh", email: null, slackId: null })).id;
});
afterAll(async () => ctx.cleanup());

describe("refresh token issue and storage", () => {
  it("issues a refresh token next to the access token, storing only its hash", async () => {
    const c = await client(["mcp:read", "mcp:deploy"]);
    const issued = await login(c.clientId, ["mcp:read", "mcp:deploy"]);
    expect(issued.refresh_token.startsWith(REFRESH_TOKEN_PREFIX)).toBe(true);

    const db = await getDb();
    const rows = await db.select().from(schema.oauthRefreshTokens).where(eq(schema.oauthRefreshTokens.clientId, c.clientId));
    expect(rows).toHaveLength(1);
    expect(rows[0].tokenHash).toBe(hashToken(issued.refresh_token));
    expect(JSON.stringify(rows)).not.toContain(issued.refresh_token);
    expect(JSON.stringify(rows)).not.toContain(issued.access_token);
  });

  it("gives the access token the same family as its refresh token", async () => {
    const c = await client(["mcp:read"]);
    const issued = await login(c.clientId, ["mcp:read"]);
    const db = await getDb();
    const access = await db
      .select({ familyId: schema.oauthTokens.familyId })
      .from(schema.oauthTokens)
      .where(eq(schema.oauthTokens.tokenHash, hashToken(issued.access_token)))
      .get();
    const refresh = await db
      .select({ familyId: schema.oauthRefreshTokens.familyId })
      .from(schema.oauthRefreshTokens)
      .where(eq(schema.oauthRefreshTokens.tokenHash, hashToken(issued.refresh_token)))
      .get();
    expect(access?.familyId).toBeTruthy();
    expect(access?.familyId).toBe(refresh?.familyId);
  });
});

describe("refresh rotation and reuse", () => {
  it("rotates: a new access and refresh token, and the old refresh token is refused on reuse", async () => {
    const c = await client(["mcp:read", "mcp:deploy"]);
    const first = await login(c.clientId, ["mcp:read", "mcp:deploy"]);
    const second = await refreshAt(first.refresh_token, c.clientId, new Date(T0.getTime() + 60_000));
    expect(second.refresh_token).not.toBe(first.refresh_token);
    expect(second.access_token).not.toBe(first.access_token);
    expect(second.scope).toBe("mcp:read mcp:deploy");
    expect((await principalForOAuthToken(second.access_token, new Date(T0.getTime() + 60_000)))?.scopes).toEqual(["mcp:read", "mcp:deploy"]);
  });

  it("revokes the whole family when a used refresh token is presented again", async () => {
    const c = await client(["mcp:read"]);
    const first = await login(c.clientId, ["mcp:read"]);
    const later = new Date(T0.getTime() + 60_000);
    const second = await refreshAt(first.refresh_token, c.clientId, later);

    const reuse = await failure(refreshAt(first.refresh_token, c.clientId, later));
    expect(reuse?.code).toBe("invalid_grant");

    // The legitimate newer token and its access token are gone too.
    expect(await failure(refreshAt(second.refresh_token, c.clientId, later))).not.toBeNull();
    expect(await principalForOAuthToken(second.access_token, later)).toBeNull();
  });

  it("refuses a refresh token issued to another client", async () => {
    const a = await client(["mcp:read"], [REDIRECT], "A");
    const b = await client(["mcp:read"], [REDIRECT], "B");
    const issued = await login(a.clientId, ["mcp:read"]);
    const err = await failure(refreshAt(issued.refresh_token, b.clientId, T0));
    expect(err?.code).toBe("invalid_grant");
  });

  it("checks a client secret when one is given on refresh", async () => {
    const c = await client(["mcp:read"]);
    const issued = await login(c.clientId, ["mcp:read"]);
    const err = await failure(refreshAt(issued.refresh_token, c.clientId, T0, undefined, "wrong-secret"));
    expect(err?.code).toBe("invalid_client");
    // A failed secret check does not spend the token.
    expect((await refreshAt(issued.refresh_token, c.clientId, T0, undefined, c.clientSecret)).access_token).toMatch(/^egg_oauth_/);
  });
});

describe("scope narrowing on refresh", () => {
  it("narrows the scopes when asked, and the narrowed scope cannot be widened back", async () => {
    const c = await client(["mcp:read", "mcp:deploy", "mcp:exec"]);
    const first = await login(c.clientId, ["mcp:read", "mcp:deploy", "mcp:exec"]);
    const narrowed = await refreshAt(first.refresh_token, c.clientId, T0, "mcp:read");
    expect(narrowed.scope).toBe("mcp:read");
    expect((await principalForOAuthToken(narrowed.access_token))?.scopes).toEqual(["mcp:read"]);

    const widen = await failure(refreshAt(narrowed.refresh_token, c.clientId, T0, "mcp:deploy"));
    expect(widen?.code).toBe("invalid_scope");
  });

  it("refuses a scope the grant never had, and does not spend the refresh token", async () => {
    const c = await client(["mcp:read", "mcp:deploy"]);
    const first = await login(c.clientId, ["mcp:read"]);
    const err = await failure(refreshAt(first.refresh_token, c.clientId, T0, "mcp:deploy"));
    expect(err?.code).toBe("invalid_scope");
    const ok = await refreshAt(first.refresh_token, c.clientId, T0, "mcp:read");
    expect(ok.scope).toBe("mcp:read");
  });

  it("refuses an unknown scope name on refresh", async () => {
    const c = await client(["mcp:read"]);
    const first = await login(c.clientId, ["mcp:read"]);
    expect((await failure(refreshAt(first.refresh_token, c.clientId, T0, "mcp:admin")))?.code).toBe("invalid_scope");
  });
});

describe("expiry", () => {
  it("expires an access token after one day", async () => {
    const c = await client(["mcp:read"]);
    const issued = await login(c.clientId, ["mcp:read"]);
    expect(await principalForOAuthToken(issued.access_token, new Date(T0.getTime() + TOKEN_TTL_MS - 1))).not.toBeNull();
    expect(await principalForOAuthToken(issued.access_token, new Date(T0.getTime() + TOKEN_TTL_MS))).toBeNull();
    expect(issued.expires_in).toBe(DAY / 1000);
  });

  it("keeps a refresh family to 30 days from its first grant, however often it rotates", async () => {
    const c = await client(["mcp:read"]);
    let current = await login(c.clientId, ["mcp:read"]);
    // Rotate daily for 29 days: the family keeps its absolute end date.
    for (let day = 1; day <= 29; day++) {
      current = await refreshAt(current.refresh_token, c.clientId, new Date(T0.getTime() + day * DAY));
    }
    const end = new Date(T0.getTime() + REFRESH_TTL_MS);
    expect((await failure(refreshAt(current.refresh_token, c.clientId, new Date(end.getTime() + 1))))?.code).toBe("invalid_grant");
    const fresh = await refreshAt(current.refresh_token, c.clientId, new Date(end.getTime() - DAY));
    expect(fresh.access_token).toMatch(/^egg_oauth_/);
  });

  it("refuses an expired refresh token", async () => {
    const c = await client(["mcp:read"]);
    const issued = await login(c.clientId, ["mcp:read"]);
    const err = await failure(refreshAt(issued.refresh_token, c.clientId, new Date(T0.getTime() + REFRESH_TTL_MS)));
    expect(err?.code).toBe("invalid_grant");
    expect(err?.message).toMatch(/expired/);
  });
});

describe("revocation", () => {
  it("revoking a refresh token removes its family and every access token from it", async () => {
    const c = await client(["mcp:read"]);
    const first = await login(c.clientId, ["mcp:read"]);
    const second = await refreshAt(first.refresh_token, c.clientId, T0);
    expect(await revokeToken(second.refresh_token)).toBe(true);
    expect(await principalForOAuthToken(second.access_token)).toBeNull();
    expect((await failure(refreshAt(second.refresh_token, c.clientId, T0)))?.code).toBe("invalid_grant");
  });

  it("revoking an access token leaves the refresh token usable", async () => {
    const c = await client(["mcp:read"]);
    const issued = await login(c.clientId, ["mcp:read"]);
    expect(await revokeToken(issued.access_token)).toBe(true);
    expect(await principalForOAuthToken(issued.access_token)).toBeNull();
    const again = await refreshAt(issued.refresh_token, c.clientId, T0);
    expect(again.access_token).toMatch(/^egg_oauth_/);
  });

  it("removing a client removes its refresh tokens", async () => {
    const made = await registerClient({ userId, name: "Gone", redirectUris: [REDIRECT], scopes: ["mcp:read"] }, T0);
    const issued = await login(made.clientId, ["mcp:read"]);
    const row = await getDb().then((db) =>
      db.select({ id: schema.oauthClients.id }).from(schema.oauthClients).where(eq(schema.oauthClients.clientId, made.clientId)).get()
    );
    expect(await revokeClient(userId, row!.id)).toBe(true);
    expect((await failure(refreshAt(issued.refresh_token, made.clientId, T0)))?.code).toBe("invalid_client");
  });

  it("ignores an unknown or wrong-prefix refresh value without error", async () => {
    expect(await revokeToken("egg_refresh_unknown")).toBe(false);
    expect(await revokeToken("")).toBe(false);
  });
});

describe("redirect URI matching at the token step", () => {
  it("accepts an unnormalized form of the registered URI that normalizes to the same one", async () => {
    // Registered as https://cli.example.com, which the server stores as https://cli.example.com/.
    const c = await client(["mcp:read"], ["https://cli.example.com"], "Bare");
    const verifier = randomToken(48);
    const grant = await createGrant(
      {
        clientId: c.clientId,
        userId,
        redirectUri: "https://cli.example.com",
        scopes: ["mcp:read"],
        codeChallenge: pkceChallenge(verifier),
        codeChallengeMethod: "S256",
      },
      T0
    );
    const issued = await exchangeCode({ code: grant.code, clientId: c.clientId, redirectUri: "https://cli.example.com", codeVerifier: verifier }, T0);
    expect(issued.access_token).toMatch(/^egg_oauth_/);
  });

  it("refuses a different URI at the token step and does not spend the code", async () => {
    const c = await client(["mcp:read"], [REDIRECT], "Strict");
    const verifier = randomToken(48);
    const grant = await createGrant(
      { clientId: c.clientId, userId, redirectUri: REDIRECT, scopes: ["mcp:read"], codeChallenge: pkceChallenge(verifier), codeChallengeMethod: "S256" },
      T0
    );
    const bad = await failure(exchangeCode({ code: grant.code, clientId: c.clientId, redirectUri: "https://evil.example.com/cb", codeVerifier: verifier }, T0));
    expect(bad?.code).toBe("invalid_grant");
    const ok = await exchangeCode({ code: grant.code, clientId: c.clientId, redirectUri: REDIRECT, codeVerifier: verifier }, T0);
    expect(ok.access_token).toMatch(/^egg_oauth_/);
  });

  it("issues an access token with the ACCESS prefix only", async () => {
    const c = await client(["mcp:read"]);
    const issued = await login(c.clientId, ["mcp:read"]);
    expect(issued.access_token.startsWith(ACCESS_TOKEN_PREFIX)).toBe(true);
    expect(issued.access_token.startsWith(REFRESH_TOKEN_PREFIX)).toBe(false);
  });
});
