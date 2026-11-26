import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import OAuthConsentPage from "@/app/(app)/oauth/consent/page";
import { GET as authorizeGet, POST as authorizePost } from "@/app/api/oauth/authorize/route";
import { POST as postRevoke } from "@/app/api/oauth/revoke/route";
import { POST as postToken } from "@/app/api/oauth/token/route";
import { GET as serverMetadata } from "@/app/.well-known/oauth-authorization-server/route";
import { authenticate, v1Route } from "@/server/api-v1-http";
import { getCurrentUser } from "@/server/auth/current";
import { upsertUser } from "@/server/auth/session";
import { randomToken } from "@/server/crypto";
import { schema } from "@/server/db";
import {
  ACCESS_TOKEN_PREFIX,
  CLIENT_ID_PREFIX,
  CODE_TTL_MS,
  TOKEN_EXPIRES_IN,
  TOKEN_TTL_MS,
  createGrant,
  exchangeCode,
  hashToken,
  hasScope,
  pkceChallenge,
  principalForOAuthToken,
  registerClient,
  revokeToken,
} from "@/server/oauth";
import { createProject } from "@/server/projects";
import { rateLimiter } from "@/server/rate-limit";
import { createServer } from "@/server/servers";
import { useFreshDb } from "@/server/test/db";

/**
 * End-to-end OAuth contract test against a real SQLite database.
 *
 * Dependencies (all owned by other agents): `@/server/oauth`, the authorize,
 * register, token and revoke route handlers, the consent page, the discovery
 * document, and the v1 dispatcher's OAuth support. The register handler is
 * imported dynamically so a broken route reports its own failure instead of
 * taking down the rest of the file.
 *
 * Nothing here mocks the database, the OAuth service or the dispatcher: only
 * the browser identity is replaced, the same way the other route tests do.
 */
vi.mock("@/server/auth/current", () => ({ getCurrentUser: vi.fn() }));
vi.mock("next/server", async (original) => ({
  ...(await original<typeof import("next/server")>()),
  connection: async () => undefined,
}));

const APP = "http://localhost:3000";
const REDIRECT_URI = "https://cli.example.com/oauth/callback";

let ctx: Awaited<ReturnType<typeof useFreshDb>>;
let user: Awaited<ReturnType<typeof upsertUser>>;
let projectId: string;

/** A PKCE verifier that satisfies the RFC 7636 alphabet and length bounds. */
const verifier = () => randomToken(48);

type NextRequestInit = NonNullable<ConstructorParameters<typeof NextRequest>[1]>;

const apiRequest = (token: string, path: string, init: NextRequestInit = {}) =>
  new NextRequest(`${APP}/api/v1${path}`, {
    ...init,
    headers: { authorization: `Bearer ${token}`, ...(init.headers ?? {}) },
  });

/** Call one v1 endpoint exactly as its HTTP route does, with route params. */
const callV1 = (
  id: string,
  path: string,
  token: string,
  params: Record<string, string> = {},
  init: NextRequestInit = {}
) => v1Route(id)(apiRequest(token, path, init), { params: Promise.resolve(params) });

const failure = async (p: Promise<unknown>) => (await p.then(() => null, (e: unknown) => e)) as Error | null;

/** Collect every string a React element passes down, without rendering a DOM. */
const stringsIn = (node: unknown): string[] => {
  if (typeof node === "string") return [node];
  if (Array.isArray(node)) return node.flatMap(stringsIn);
  if (node && typeof node === "object") {
    const props = (node as { props?: Record<string, unknown> }).props;
    // Server components pass the consent details as named props (clientName,
    // clientHost, redirectUri, scopes) as well as through children.
    return props ? Object.values(props).flatMap(stringsIn) : [];
  }
  return [];
};

beforeAll(async () => {
  ctx = await useFreshDb();
  user = await upsertUser({ id: "oauth-1", name: "Sam", email: "sam@example.com", slackId: null });
  const server = await createServer(user.id, "oauth-api");
  projectId = (
    await createProject(user.id, {
      name: "App",
      slug: "app",
      serverId: server.id,
      repoUrl: "https://github.com/sam/app.git",
      runtime: "node",
      port: 3000,
    })
  ).id;
});

afterAll(async () => ctx.cleanup());

beforeEach(() => {
  rateLimiter().clear();
  vi.mocked(getCurrentUser).mockResolvedValue({ ...user, hackClubId: "oauth-1" });
});

describe("OAuth contract", () => {
  it("uses the documented hierarchical scopes and one-way hashes", () => {
    expect(hasScope(["mcp:read"], "mcp:read")).toBe(true);
    expect(hasScope(["mcp:deploy"], "mcp:read")).toBe(true);
    expect(hasScope(["mcp:exec"], "mcp:deploy")).toBe(true);
    expect(hasScope(["mcp:read"], "mcp:deploy")).toBe(false);
    expect(hasScope(["mcp:deploy"], "mcp:exec")).toBe(false);
    expect(ACCESS_TOKEN_PREFIX).toBe("egg_oauth_");
    expect(CLIENT_ID_PREFIX).toBe("eggcli_");
    expect(createHash("sha256").update("x").digest("hex")).toBe(hashToken("x"));
  });

  it("publishes the authorization-server metadata with S256 and all three scopes", async () => {
    const res = serverMetadata(new NextRequest(`${APP}/.well-known/oauth-authorization-server`));
    expect(res.status).toBe(200);
    const meta = (await res.json()) as Record<string, unknown>;
    expect(meta.issuer).toBe(APP);
    expect(meta.authorization_endpoint).toBe(`${APP}/api/oauth/authorize`);
    expect(meta.token_endpoint).toBe(`${APP}/api/oauth/token`);
    expect(meta.revocation_endpoint).toBe(`${APP}/api/oauth/revoke`);
    expect(meta.registration_endpoint).toBe(`${APP}/api/oauth/register`);
    expect(meta.code_challenge_methods_supported).toContain("S256");
    expect(meta.scopes_supported).toEqual(["mcp:read", "mcp:deploy", "mcp:exec"]);
  });

  it(
    "registers a client, grants consent, exchanges a PKCE code, reads through v1, " +
      "refuses a deploy with mcp:read, and revokes the token",
    { timeout: 20_000 },
    async () => {
      // 1. Register the client; only the digest of its secret reaches the database.
      const { clientId, clientSecret } = await registerClient({
        userId: user.id,
        name: "Example CLI",
        redirectUris: [REDIRECT_URI],
        scopes: ["mcp:read", "mcp:deploy"],
      });
      expect(clientId).toMatch(/^eggcli_/);
      const clientRow = await ctx.db
        .select()
        .from(schema.oauthClients)
        .where(eq(schema.oauthClients.clientId, clientId))
        .get();
      expect(clientRow).toBeDefined();
      expect(clientRow!.userId).toBe(user.id);
      expect(clientRow!.clientSecretHash).toBe(hashToken(clientSecret));
      expect(JSON.parse(clientRow!.redirectUris)).toEqual([REDIRECT_URI]);

      // 2. Build the authorize URL from the registered client and a fresh S256 challenge.
      const codeVerifier = verifier();
      const challenge = pkceChallenge(codeVerifier);
      expect(challenge).toMatch(/^[A-Za-z0-9_-]{43}$/);
      const state = "client-state-42";
      const authorize = new URL("/api/oauth/authorize", APP);
      authorize.searchParams.set("response_type", "code");
      authorize.searchParams.set("client_id", clientId);
      authorize.searchParams.set("redirect_uri", REDIRECT_URI);
      authorize.searchParams.set("scope", "mcp:read");
      authorize.searchParams.set("state", state);
      authorize.searchParams.set("code_challenge", challenge);
      authorize.searchParams.set("code_challenge_method", "S256");

      // 3. A signed-in visitor is sent to consent, which shows the client, its host,
      //    the exact redirect URI and every requested scope.
      const authorizeRes = await authorizeGet(new NextRequest(authorize.toString()));
      expect(authorizeRes.status).toBe(303);
      const consent = new URL(authorizeRes.headers.get("location")!);
      expect(consent.pathname).toBe("/oauth/consent");
      for (const [key, value] of authorize.searchParams) {
        expect(consent.searchParams.get(key)).toBe(value);
      }
      const element = await OAuthConsentPage({
        searchParams: Promise.resolve(Object.fromEntries(consent.searchParams)),
      });
      const shown = stringsIn(element).join(" ");
      expect(shown).toContain("Example CLI");
      expect(shown).toContain(new URL(REDIRECT_URI).host);
      expect(shown).toContain(REDIRECT_URI);
      expect(shown).toContain("mcp:read");

      // 4. Consent approval creates a single-use, 10-minute code.
      const form = new URLSearchParams(consent.searchParams);
      form.set("decision", "approve");
      const grantRes = await authorizePost(
        new NextRequest(`${APP}/api/oauth/authorize`, {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: form.toString(),
        }),
        undefined
      );
      expect(grantRes.status).toBe(303);
      const redirected = new URL(grantRes.headers.get("location")!);
      expect(`${redirected.origin}${redirected.pathname}`).toBe(REDIRECT_URI);
      expect(redirected.searchParams.get("state")).toBe(state);
      const code = redirected.searchParams.get("code");
      expect(code).toBeTruthy();
      const grant = await ctx.db
        .select()
        .from(schema.oauthGrants)
        .where(eq(schema.oauthGrants.codeHash, hashToken(code!)))
        .get();
      expect(grant).toBeDefined();
      expect(grant!.userId).toBe(user.id);
      expect(grant!.usedAt).toBeNull();
      expect(grant!.expiresAt.getTime()).toBeLessThanOrEqual(Date.now() + CODE_TTL_MS);

      // 5. Exchange the code with the matching PKCE verifier for a one-day token.
      const token = await exchangeCode({
        code: code!,
        clientId,
        clientSecret,
        redirectUri: REDIRECT_URI,
        codeVerifier,
      });
      expect(token.access_token.startsWith(ACCESS_TOKEN_PREFIX)).toBe(true);
      expect(token.token_type).toBe("Bearer");
      expect(token.expires_in).toBe(TOKEN_EXPIRES_IN);
      expect(token.scope).toBe("mcp:read");
      const tokenRow = await ctx.db
        .select()
        .from(schema.oauthTokens)
        .where(eq(schema.oauthTokens.tokenHash, hashToken(token.access_token)))
        .get();
      expect(tokenRow).toBeDefined();
      expect(tokenRow!.userId).toBe(user.id);
      expect(tokenRow!.clientId).toBe(clientId);
      expect(JSON.parse(tokenRow!.scopes)).toEqual(["mcp:read"]);
      expect(tokenRow!.expiresAt.getTime() - Date.now()).toBeGreaterThan(TOKEN_TTL_MS - 60_000);
      expect(await principalForOAuthToken(token.access_token)).toMatchObject({
        userId: user.id,
        tokenId: tokenRow!.id,
        clientId,
        scopes: ["mcp:read"],
      });

      // A code is single-use: the same exchange cannot mint a second token.
      expect(
        await failure(
          exchangeCode({ code: code!, clientId, redirectUri: REDIRECT_URI, codeVerifier })
        )
      ).toBeInstanceOf(Error);

      // 6. The read-only OAuth token works through the real v1 HTTP dispatcher.
      const read = await callV1("list_projects", "/projects", token.access_token);
      expect(read.status).toBe(200);
      expect((await read.json()).projects).toEqual(expect.any(Array));
      expect((await authenticate(apiRequest(token.access_token, "/projects"))).userId).toBe(user.id);

      // 7. mcp:read never maps to a write scope: the deploy is refused and nothing runs.
      const deploy = await callV1(
        "deploy_branch",
        `/projects/${projectId}/deployments`,
        token.access_token,
        { projectId },
        { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }
      );
      expect(deploy.status).toBe(403);
      expect((await deploy.json()).error.code).toBe("forbidden");
      const deployments = await ctx.db
        .select()
        .from(schema.deployments)
        .where(eq(schema.deployments.projectId, projectId));
      expect(deployments).toHaveLength(0);

      // 8. Revocation removes the stored token, and the next v1 call is rejected.
      expect(await revokeToken(token.access_token)).toBe(true);
      expect(
        await ctx.db
          .select()
          .from(schema.oauthTokens)
          .where(eq(schema.oauthTokens.tokenHash, hashToken(token.access_token)))
          .get()
      ).toBeUndefined();
      expect(await principalForOAuthToken(token.access_token)).toBeNull();
      const rejected = await callV1("list_projects", "/projects", token.access_token);
      expect(rejected.status).toBe(401);
    }
  );
});

describe("OAuth HTTP endpoints", () => {
  it("registers a client through POST /api/oauth/register", async () => {
    // Dynamic so a stale/broken register route cannot take down the whole file:
    // this endpoint is owned by the register-route agent.
    const mod = await import("@/app/api/oauth/register/route").catch(() => {
      throw new Error("Missing dependency: @/app/api/oauth/register/route");
    });
    const res = await mod.POST(
      new NextRequest(`${APP}/api/oauth/register`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "HTTP CLI", redirectUris: [REDIRECT_URI], scopes: ["mcp:read"] }),
      }),
      undefined
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.client_id).toMatch(/^eggcli_/);
    expect(body.client_secret).toEqual(expect.any(String));
    expect(body.redirect_uris).toEqual([REDIRECT_URI]);
    expect(body.scopes).toEqual(["mcp:read"]);
  });

  it("exchanges a code through POST /api/oauth/token with PKCE", async () => {
    const { clientId, clientSecret } = await registerClient({
      userId: user.id,
      name: "Token CLI",
      redirectUris: [REDIRECT_URI],
      scopes: ["mcp:read"],
    });
    const verifierValue = verifier();
    const { code } = await createGrant({
      clientId,
      userId: user.id,
      redirectUri: REDIRECT_URI,
      scopes: ["mcp:read"],
      codeChallenge: pkceChallenge(verifierValue),
      codeChallengeMethod: "S256",
    });

    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: REDIRECT_URI,
      code_verifier: verifierValue,
    });
    const res = await postToken(
      new NextRequest(`${APP}/api/oauth/token`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: body.toString(),
      })
    );
    expect(res.status).toBe(200);
    const issued = (await res.json()) as Record<string, unknown>;
    expect(issued.access_token).toMatch(/^egg_oauth_/);
    expect(issued.token_type).toBe("Bearer");
    expect(issued.expires_in).toBe(TOKEN_EXPIRES_IN);
    expect(issued.scope).toBe("mcp:read");
    expect((await principalForOAuthToken(issued.access_token as string))?.userId).toBe(user.id);
  });

  it("revokes through POST /api/oauth/revoke and the token stops working", async () => {
    const { clientId, clientSecret } = await registerClient({
      userId: user.id,
      name: "Revoke CLI",
      redirectUris: [REDIRECT_URI],
      scopes: ["mcp:read"],
    });
    const verifierValue = verifier();
    const { code } = await createGrant({
      clientId,
      userId: user.id,
      redirectUri: REDIRECT_URI,
      scopes: ["mcp:read"],
      codeChallenge: pkceChallenge(verifierValue),
      codeChallengeMethod: "S256",
    });
    const { access_token: secret } = await exchangeCode({
      code,
      clientId,
      clientSecret,
      redirectUri: REDIRECT_URI,
      codeVerifier: verifierValue,
    });

    const body = new URLSearchParams({
      token: secret,
      token_type_hint: "access_token",
      client_id: clientId,
      client_secret: clientSecret,
    });
    const res = await postRevoke(
      new NextRequest(`${APP}/api/oauth/revoke`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: body.toString(),
      })
    );
    expect(res.status).toBe(200);
    expect(
      await ctx.db.select().from(schema.oauthTokens).where(eq(schema.oauthTokens.tokenHash, hashToken(secret))).get()
    ).toBeUndefined();
    expect(await callV1("list_projects", "/projects", secret)).toMatchObject({ status: 401 });

    // Revoking an unknown token is a successful no-op (RFC 7009).
    const again = await postRevoke(
      new NextRequest(`${APP}/api/oauth/revoke`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token: secret, client_id: clientId, client_secret: clientSecret }).toString(),
      })
    );
    expect(again.status).toBe(200);
  });
});
