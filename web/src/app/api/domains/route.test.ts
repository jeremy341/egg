import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import { SESSION_COOKIE, createSession, upsertUser } from "@/server/auth/session";
import { addDomain } from "@/server/domains";
import { schema } from "@/server/db";
import { rateLimiter } from "@/server/rate-limit";
import { createServer } from "@/server/servers";
import { useFreshDb } from "@/server/test/db";
import { GET, POST } from "@/app/api/domains/route";
import { DELETE, PATCH } from "@/app/api/domains/[id]/route";
import { POST as VERIFY } from "@/app/api/domains/[id]/verify/route";

let currentCookie = "";
vi.mock("next/server", async (orig) => ({
  ...(await orig<typeof import("next/server")>()),
  connection: async () => undefined,
}));
vi.mock("next/headers", async (orig) => ({
  ...(await orig<typeof import("next/headers")>()),
  cookies: async () => ({
    get: (name: string) => name === "egg_session" && currentCookie ? { value: currentCookie } : undefined,
  }),
}));

const WRITE = { key: "domains:write", limit: 20, windowMs: 60_000 };
const LIST = { key: "domains:list", limit: 60, windowMs: 60_000 };
const CHECK = { key: "domains:verify", limit: 12, windowMs: 60_000 };

let ctx: Awaited<ReturnType<typeof useFreshDb>>;
let userId: string;
let serverId: string;

beforeAll(async () => {
  ctx = await useFreshDb();
  userId = (await upsertUser({ id: "routes-sam", name: "Sam", email: null, slackId: null })).id;
  serverId = (await createServer(userId, "sam-r")).id;
});
afterAll(async () => {
  await ctx.cleanup();
});
beforeEach(async () => {
  rateLimiter().clear();
  currentCookie = "";
  await ctx.db.delete(schema.domains);
  await ctx.db.delete(schema.sessions);
  currentCookie = (await createSession(userId)).token;
});

const req = (path: string, method = "GET", body?: unknown) =>
  new NextRequest(`http://localhost:3000${path}`, {
    method,
    headers: { "content-type": "application/json", cookie: `${SESSION_COOKIE}=${currentCookie}` },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

const fill = (key: string, limit: number, windowMs: number) => {
  for (let i = 0; i < limit; i++) rateLimiter().check(`${key}:${userId}`, limit, windowMs);
};

const add = (domain: string, port = 3000) => addDomain(userId, { serverId, domain, port });

describe("browser domain routes", () => {
  it("requires a signed-in user", async () => {
    currentCookie = "";
    expect((await GET(req("/api/domains"), undefined)).status).toBe(401);
    expect((await POST(req("/api/domains", "POST", { serverId, domain: "a.example.com", port: 3000 }), undefined)).status).toBe(401);
    expect((await VERIFY(req("/api/domains/abc/verify", "POST"), { params: Promise.resolve({ id: "abc" }) })).status).toBe(401);
  });

  it("adds and lists domains for the signed-in user", async () => {
    const created = await POST(req("/api/domains", "POST", { serverId, domain: "site.example.com", port: 3000 }), undefined);
    expect(created.status).toBe(201);
    expect((await created.json()).domain).toMatchObject({ domain: "site.example.com", status: "pending" });
    const list = await GET(req("/api/domains"), undefined);
    expect(list.status).toBe(200);
    expect((await list.json()).domains.map((d: { domain: string }) => d.domain)).toContain("site.example.com");
  });

  it("limits writes per user, not per browser tab", async () => {
    fill(WRITE.key, WRITE.limit, WRITE.windowMs);
    const res = await POST(req("/api/domains", "POST", { serverId, domain: "limited.example.com", port: 3000 }), undefined);
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBeTruthy();
    expect((await res.json()).error.code).toBe("rate_limited");
    expect(await ctx.db.select().from(schema.domains).where(eq(schema.domains.domain, "limited.example.com"))).toHaveLength(0);
  });

  it("shares the write budget with re-pointing and removing a domain", async () => {
    const { domain } = await add("shared.example.com");
    fill(WRITE.key, WRITE.limit, WRITE.windowMs);
    const params = { params: Promise.resolve({ id: domain.id }) };
    expect((await PATCH(req(`/api/domains/${domain.id}`, "PATCH", { port: 4000 }), params)).status).toBe(429);
    expect((await DELETE(req(`/api/domains/${domain.id}`, "DELETE"), params)).status).toBe(429);
  });

  it("limits reads and DNS checks on their own per-user buckets", async () => {
    fill(LIST.key, LIST.limit, LIST.windowMs);
    expect((await GET(req("/api/domains"), undefined)).status).toBe(429);

    const { domain } = await add("checked.example.com");
    fill(CHECK.key, CHECK.limit, CHECK.windowMs);
    const res = await VERIFY(req(`/api/domains/${domain.id}/verify`, "POST"), {
      params: Promise.resolve({ id: domain.id }),
    });
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBeTruthy();
  });

  it("does not spend another user's budget", async () => {
    const other = (await upsertUser({ id: "routes-kim", name: "Kim", email: null, slackId: null })).id;
    const otherServer = (await createServer(other, "kim-r")).id;
    fill(WRITE.key, WRITE.limit, WRITE.windowMs);
    currentCookie = (await createSession(other)).token;
    const res = await POST(req("/api/domains", "POST", { serverId: otherServer, domain: "other.example.com", port: 3000 }), undefined);
    expect(res.status).toBe(201);
  });
});
