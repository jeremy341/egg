import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApiToken, SCOPES, type Scope } from "@/server/api-tokens";
import { authenticate } from "@/server/api-v1-http";
import { upsertUser } from "@/server/auth/session";
import { newId, randomToken, sha256Hex } from "@/server/crypto";
import { getDb, schema } from "@/server/db";
import { HttpError } from "@/server/http";
import { ACCESS_TOKEN_PREFIX } from "@/server/oauth";
import { useFreshDb } from "@/server/test/db";

/**
 * Focused coverage of the API authentication boundary for OAuth tokens: the
 * hash lookup, expiry check and the mapping of hierarchical MCP scopes onto the
 * scopes the API already enforces. Tokens are inserted directly so these tests
 * do not depend on the authorize/consent/token endpoints.
 */

let ctx: Awaited<ReturnType<typeof useFreshDb>>;
let db: Awaited<ReturnType<typeof getDb>>;
let userId: string;
let personal: string;
const now = Date.now();

beforeAll(async () => {
  ctx = await useFreshDb();
  db = await getDb();
  const user = await upsertUser({ id: "oauth-auth-1", name: "Sam", email: null, slackId: null });
  userId = user.id;
  personal = (await createApiToken(userId, { name: "classic", scopes: ["projects:read"] })).secret;
});
afterAll(async () => ctx.cleanup());

const req = (token: string) =>
  new Request("http://localhost:3000/api/v1/me", { headers: { authorization: `Bearer ${token}` } });
const failure = async (p: Promise<unknown>) => (await p.then(() => null, (e: unknown) => e)) as HttpError | null;

/** Store only the hash, exactly as the OAuth token endpoint does. */
async function issue(scopes: readonly string[], expiresAt: number): Promise<string> {
  const secret = `${ACCESS_TOKEN_PREFIX}${randomToken(32)}`;
  await db.insert(schema.oauthTokens).values({
    id: newId(),
    clientId: "eggcli_test",
    userId,
    tokenHash: sha256Hex(secret),
    scopes: JSON.stringify(scopes),
    expiresAt: new Date(expiresAt),
    createdAt: new Date(now - 60_000),
  });
  return secret;
}

const READ_SCOPES = SCOPES.filter((s) => s.endsWith(":read"));
const isRead = (s: Scope) => s.endsWith(":read");

describe("authenticate: OAuth access tokens", () => {
  it("accepts a valid egg_oauth_ token and maps mcp:read to read-only API scopes", async () => {
    const secret = await issue(["mcp:read"], now + 60_000);
    const p = await authenticate(req(secret));
    expect(p.userId).toBe(userId);
    expect(typeof p.tokenId).toBe("string");
    expect(new Set(p.scopes)).toEqual(new Set(READ_SCOPES));
    expect(p.scopes.every(isRead)).toBe(true);
  });

  it("maps mcp:deploy to reads plus ordinary writes, but no shell or file changes", async () => {
    const p = await authenticate(req(await issue(["mcp:deploy"], now + 60_000)));
    expect(p.scopes).toContain("deployments:write");
    expect(p.scopes).toContain("projects:write");
    expect(p.scopes).toContain("env:write");
    expect(p.scopes).toContain("files:read");
    expect(p.scopes).not.toContain("terminal:use");
    expect(p.scopes).not.toContain("files:write");
  });

  it("maps mcp:exec to every API scope, including the dangerous ones", async () => {
    const p = await authenticate(req(await issue(["mcp:exec"], now + 60_000)));
    expect(new Set(p.scopes)).toEqual(new Set(SCOPES));
    expect(p.scopes).toContain("terminal:use");
    expect(p.scopes).toContain("files:write");
  });

  it("honours the strongest scope when several are present", async () => {
    const p = await authenticate(req(await issue(["mcp:read", "mcp:exec"], now + 60_000)));
    expect(p.scopes).toContain("projects:read");
    expect(p.scopes).toContain("terminal:use");
  });

  it("grants nothing for an unrecognised scope list", async () => {
    const p = await authenticate(req(await issue(["mcp:anything"], now + 60_000)));
    expect(p.scopes).toEqual([]);
  });

  it("rejects an expired token with the same 401 as a bad token", async () => {
    const secret = await issue(["mcp:read"], now - 1);
    const err = await failure(authenticate(req(secret)));
    expect(err?.status).toBe(401);
    expect(err?.code).toBe("unauthorized");
    expect(err?.headers?.["WWW-Authenticate"]).toBe("Bearer");
  });

  it("rejects an unknown token whose hash is not in oauthTokens", async () => {
    const err = await failure(authenticate(req(`${ACCESS_TOKEN_PREFIX}${randomToken(32)}`)));
    expect(err?.status).toBe(401);
    expect(err?.code).toBe("unauthorized");
  });

  it("keeps existing egg_ personal tokens working with their own scopes", async () => {
    await expect(authenticate(req(personal))).resolves.toMatchObject({ userId, scopes: ["projects:read"] });
  });
});
