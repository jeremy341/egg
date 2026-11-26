import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { upsertUser } from "@/server/auth/session";
import { randomToken } from "@/server/crypto";
import {
  createGrant,
  exchangeCode,
  exchangeRefreshToken,
  pkceChallenge,
  registerClient,
  revokeToken,
} from "@/server/oauth";
import { rateLimiter } from "@/server/rate-limit";
import { useFreshDb } from "@/server/test/db";
import { POST } from "@/app/api/mcp/route";

/**
 * /api/mcp with OAuth access tokens. A token from the authorization-code flow
 * must authenticate, list only what its scope allows, and be refused for a
 * deploy tool when it holds only mcp:read. Personal-token behaviour is covered
 * in route.test.ts.
 */

const REDIRECT = "http://localhost:8123/callback";
const NOW = new Date();

let ctx: Awaited<ReturnType<typeof useFreshDb>>;
let userId: string;
let clientId: string;

/** Sign a client in with the given scopes and return its access and refresh tokens. */
async function oauthTokens(scopes: string[], now = NOW) {
  const verifier = randomToken(48);
  const grant = await createGrant(
    { clientId, userId, redirectUri: REDIRECT, scopes, codeChallenge: pkceChallenge(verifier), codeChallengeMethod: "S256" },
    now
  );
  return exchangeCode({ code: grant.code, clientId, redirectUri: REDIRECT, codeVerifier: verifier }, now);
}

const rpc = (method: string, params?: unknown) => ({ jsonrpc: "2.0", id: 1, method, params });
const send = (body: unknown, secret: string | null) =>
  POST(
    new NextRequest("http://localhost:3000/api/mcp", {
      method: "POST",
      headers: { "content-type": "application/json", ...(secret ? { authorization: `Bearer ${secret}` } : {}) },
      body: JSON.stringify(body),
    }),
    undefined
  );
const call = (secret: string, name: string, args: unknown) => send(rpc("tools/call", { name, arguments: args }), secret);
const resultText = (body: { result: { content: { text: string }[] } }) => body.result.content[0].text;

beforeAll(async () => {
  ctx = await useFreshDb();
  userId = (await upsertUser({ id: "mcp-oauth-user", name: "Sam", email: null, slackId: null })).id;
  clientId = (
    await registerClient({ userId, name: "MCP client", redirectUris: [REDIRECT], scopes: ["mcp:read", "mcp:deploy"] })
  ).clientId;
});
afterAll(async () => ctx.cleanup());
beforeEach(() => rateLimiter().clear());

describe("MCP with an OAuth access token", () => {
  it("authenticates an OAuth token and runs a read tool", async () => {
    const { access_token } = await oauthTokens(["mcp:read"]);
    const res = await call(access_token, "list_projects", {});
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.result.isError).toBe(false);
  });

  it("lists only the tools the token's scope allows", async () => {
    const read = await oauthTokens(["mcp:read"]);
    const deploy = await oauthTokens(["mcp:deploy"]);
    const names = async (secret: string) =>
      ((await (await send(rpc("tools/list"), secret)).json()).result.tools as { name: string }[]).map((t) => t.name);

    const readNames = await names(read.access_token);
    expect(readNames).toContain("list_projects");
    expect(readNames).not.toContain("deploy_branch");

    const deployNames = await names(deploy.access_token);
    expect(deployNames).toContain("deploy_branch");
  });

  it("refuses a deploy tool to a read-scoped token before doing any work", async () => {
    const { access_token } = await oauthTokens(["mcp:read"]);
    const body = await (await call(access_token, "deploy_branch", { projectId: "no-such-project", branch: "main" })).json();
    expect(body.result.isError).toBe(true);
    expect(resultText(body)).toContain("deployments:write");
  });

  it("lets a deploy-scoped token past the scope gate for the same tool", async () => {
    const { access_token } = await oauthTokens(["mcp:deploy"]);
    const body = await (await call(access_token, "deploy_branch", { projectId: "no-such-project", branch: "main" })).json();
    // The project does not exist, so the call fails on ownership, not on scope.
    expect(body.result.isError).toBe(true);
    expect(resultText(body)).not.toContain("deployments:write");
  });

  it("accepts the access token from a refresh rotation", async () => {
    const first = await oauthTokens(["mcp:read"]);
    const rotated = await exchangeRefreshToken({ refreshToken: first.refresh_token, clientId });
    const body = await (await call(rotated.access_token, "list_projects", {})).json();
    expect(body.result.isError).toBe(false);
  });

  it("refuses a revoked OAuth token with 401 and the protected-resource pointer", async () => {
    const { access_token } = await oauthTokens(["mcp:read"]);
    expect(await revokeToken(access_token)).toBe(true);
    const res = await call(access_token, "list_projects", {});
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toMatch(/resource_metadata=".*oauth-protected-resource\/api\/mcp"/);
  });

  it("refuses an OAuth token past its one-day life with 401", async () => {
    const past = new Date(NOW.getTime() - 2 * 24 * 60 * 60 * 1000);
    const stale = await oauthTokens(["mcp:read"], past);
    const res = await call(stale.access_token, "list_projects", {});
    expect(res.status).toBe(401);
  });
});
