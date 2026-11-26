import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createApiToken, revokeApiToken } from "@/server/api-tokens";
import { upsertUser } from "@/server/auth/session";
import { schema } from "@/server/db";
import { createProject } from "@/server/projects";
import { rateLimiter } from "@/server/rate-limit";
import { createServer } from "@/server/servers";
import { useFreshDb } from "@/server/test/db";
import { buildOpenApi } from "@/server/api-v1-openapi";
import { TOOLS } from "@/server/mcp";

vi.mock("@/server/auth/current", () => ({ getCurrentUser: vi.fn(), requireUser: vi.fn() }));

import { GET as meRoute } from "@/app/api/v1/me/route";

let ctx: Awaited<ReturnType<typeof useFreshDb>>;
let sam: { id: string };
let kim: { id: string };

const get = (secret: string | null) =>
  meRoute(
    new NextRequest("http://localhost:3000/api/v1/me", {
      headers: secret ? { authorization: `Bearer ${secret}` } : {},
    }),
    { params: Promise.resolve({}) }
  );

beforeAll(async () => {
  ctx = await useFreshDb();
  sam = await upsertUser({ id: "m1", name: "Sam", email: "sam-private@example.com", slackId: null });
  kim = await upsertUser({ id: "m2", name: "Kim", email: null, slackId: null });
  const base = { repoUrl: "https://github.com/sam/app.git", runtime: "node" as const };
  const s1 = await createServer(sam.id, "sam-me-1");
  const s2 = await createServer(sam.id, "sam-me-2");
  const k1 = await createServer(kim.id, "kim-me-1");
  await createProject(sam.id, { ...base, serverId: s1.id, name: "A", slug: "a", port: 3000 });
  await createProject(sam.id, { ...base, serverId: s2.id, name: "B", slug: "b", port: 3000 });
  await createProject(sam.id, { ...base, serverId: s2.id, name: "C", slug: "c", port: 3001 });
  await createProject(kim.id, { ...base, serverId: k1.id, name: "K", slug: "k", port: 3000 });
});
afterAll(async () => {
  await ctx.cleanup();
});
beforeEach(async () => {
  await ctx.db.delete(schema.apiTokens);
  rateLimiter().clear();
});

describe("GET /api/v1/me", () => {
  it("answers 401 without a valid token", async () => {
    expect((await get(null)).status).toBe(401);
    expect((await get("egg_nope")).status).toBe(401);
    const { secret, token } = await createApiToken(sam.id, { name: "gone", scopes: ["logs:read"] });
    await revokeApiToken(sam.id, token.id);
    expect((await get(secret)).status).toBe(401);
  });

  it("shows the display name the owner chose, not the Hack Club name", async () => {
    await ctx.db
      .insert(schema.userPreferences)
      .values({ userId: sam.id, displayName: "Sammy", updatedAt: new Date() })
      .onConflictDoUpdate({ target: schema.userPreferences.userId, set: { displayName: "Sammy" } });
    const { secret } = await createApiToken(sam.id, { name: "named", scopes: ["logs:read"] });
    const body = (await (await get(secret)).json()) as { user: { name: string } };
    expect(body.user.name).toBe("Sammy");
    await ctx.db.delete(schema.userPreferences).where(eq(schema.userPreferences.userId, sam.id));
  });

  it("works for a token with any one scope, and says who, which token, what it may do and how much there is", async () => {
    const { secret, token } = await createApiToken(sam.id, { name: "agent", scopes: ["logs:read"], expiresInDays: 30 });
    const res = await get(secret);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({
      user: { name: "Sam" },
      token: { name: "agent", scopes: ["logs:read"], expiresAt: token.expiresAt },
      counts: { servers: 2, projects: 3 },
    });
  });

  it("counts only the token owner's servers and projects", async () => {
    const { secret } = await createApiToken(kim.id, { name: "k", scopes: ["projects:read"] });
    const body = await (await get(secret)).json();
    expect(body.user).toEqual({ name: "Kim" });
    expect(body.counts).toEqual({ servers: 1, projects: 1 });
  });

  it("never returns the email, the secret or any id", async () => {
    const { secret } = await createApiToken(sam.id, { name: "agent", scopes: ["logs:read"] });
    const text = JSON.stringify(await (await get(secret)).json());
    expect(text).not.toContain("sam-private");
    expect(text).not.toContain(secret);
    expect(text).not.toContain(sam.id);
  });

  it("needs no scope in the OpenAPI document or the agent tool list", () => {
    const op = (buildOpenApi().paths as Record<string, Record<string, { security: unknown[]; description: string }>>)["/me"].get;
    expect(op.security).toEqual([{ bearerAuth: [] }]);
    expect(op.description).toMatch(/any valid token/i);
    const tool = TOOLS.find((t) => t.name === "get_me")!;
    expect(tool.annotations.readOnlyHint).toBe(true);
    expect(tool.description).toMatch(/no scope/i);
  });
});
