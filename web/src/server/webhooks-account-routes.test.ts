import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { sql } from "drizzle-orm";
import { upsertUser } from "@/server/auth/session";
import { schema } from "@/server/db";
import { rateLimiter } from "@/server/rate-limit";
import { useFreshDb } from "@/server/test/db";

vi.mock("@/server/auth/current", () => ({ getCurrentUser: vi.fn(), requireUser: vi.fn() }));
// Never touch the network from a route test.
vi.mock("@/server/webhook-net", async (orig) => ({
  ...(await orig<typeof import("@/server/webhook-net")>()),
  safePost: vi.fn(async () => ({ status: 200 })),
}));

import { getCurrentUser } from "@/server/auth/current";
import { GET as listRoute, POST as createRoute } from "@/app/api/account/webhooks/route";
import { DELETE as deleteRoute, PATCH as patchRoute, POST as actionRoute } from "@/app/api/account/webhooks/[id]/route";

let ctx: Awaited<ReturnType<typeof useFreshDb>>;
let sam: { id: string };
let kim: { id: string };

const ORIGIN = "http://localhost:3000";
const req = (path: string, method: string, body?: unknown, headers: Record<string, string> = {}) =>
  new NextRequest(`${ORIGIN}${path}`, {
    method,
    headers: { "content-type": "application/json", origin: ORIGIN, ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const idCtx = (id: string) => ({ params: Promise.resolve({ id }) });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const bodyOf = async (res: Response) => (await res.json()) as Record<string, any>;

beforeAll(async () => {
  ctx = await useFreshDb();
  sam = await upsertUser({ id: "wa1", name: "Sam", email: null, slackId: null });
  kim = await upsertUser({ id: "wa2", name: "Kim", email: null, slackId: null });
});
afterAll(async () => {
  await ctx.cleanup();
});
beforeEach(async () => {
  rateLimiter().clear();
  await ctx.db.delete(schema.webhooks);
  vi.mocked(getCurrentUser).mockResolvedValue(sam as never);
});

describe("account webhook routes", () => {
  it("answer 401 when signed out", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(null);
    expect((await listRoute(req("/api/account/webhooks", "GET"), undefined)).status).toBe(401);
    expect((await createRoute(req("/api/account/webhooks", "POST", { url: "https://a.example.com/" }), undefined)).status).toBe(401);
    expect((await deleteRoute(req("/api/account/webhooks/x", "DELETE"), idCtx("x"))).status).toBe(401);
  });

  it("block cross-site writes", async () => {
    const res = await createRoute(
      req("/api/account/webhooks", "POST", { url: "https://a.example.com/" }, { origin: "https://evil.example.com" }),
      undefined
    );
    expect(res.status).toBe(403);
    expect(await ctx.db.select().from(schema.webhooks)).toHaveLength(0);
  });

  it("create (secret once), list with deliveries, test, rotate, pause and delete", async () => {
    const made = await createRoute(req("/api/account/webhooks", "POST", { url: "https://hooks.example.com/in" }), undefined);
    expect(made.status).toBe(201);
    expect(made.headers.get("cache-control")).toBe("no-store");
    const { webhook, secret } = await bodyOf(made);
    expect(secret).toMatch(/^whsec_/);

    const tested = await bodyOf(await actionRoute(req(`/api/account/webhooks/${webhook.id}`, "POST", { action: "test" }), idCtx(webhook.id)));
    expect(tested.delivery).toMatchObject({ status: "success", event: "webhook.test" });

    const listText = await (await listRoute(req("/api/account/webhooks", "GET"), undefined)).text();
    expect(listText).not.toContain(secret);
    expect(JSON.parse(listText).webhooks[0].deliveries).toHaveLength(1);

    const rotated = await bodyOf(await actionRoute(req(`/api/account/webhooks/${webhook.id}`, "POST", { action: "rotate" }), idCtx(webhook.id)));
    expect(rotated.secret).toMatch(/^whsec_/);
    expect(rotated.secret).not.toBe(secret);

    const paused = await bodyOf(await patchRoute(req(`/api/account/webhooks/${webhook.id}`, "PATCH", { active: false }), idCtx(webhook.id)));
    expect(paused.webhook.active).toBe(false);

    expect((await actionRoute(req(`/api/account/webhooks/${webhook.id}`, "POST", { action: "nope" }), idCtx(webhook.id))).status).toBe(400);
    expect((await deleteRoute(req(`/api/account/webhooks/${webhook.id}`, "DELETE"), idCtx(webhook.id))).status).toBe(200);
    expect(await ctx.db.select().from(schema.webhooks)).toHaveLength(0);
  });

  it("keep one user's webhooks from another", async () => {
    const { webhook } = await bodyOf(await createRoute(req("/api/account/webhooks", "POST", { url: "https://hooks.example.com/in" }), undefined));
    vi.mocked(getCurrentUser).mockResolvedValue(kim as never);
    expect((await bodyOf(await listRoute(req("/api/account/webhooks", "GET"), undefined))).webhooks).toEqual([]);
    expect((await patchRoute(req(`/api/account/webhooks/${webhook.id}`, "PATCH", { active: false }), idCtx(webhook.id))).status).toBe(404);
    expect((await deleteRoute(req(`/api/account/webhooks/${webhook.id}`, "DELETE"), idCtx(webhook.id))).status).toBe(404);
    expect((await actionRoute(req(`/api/account/webhooks/${webhook.id}`, "POST", { action: "rotate" }), idCtx(webhook.id))).status).toBe(404);
    expect((await actionRoute(req(`/api/account/webhooks/${webhook.id}`, "POST", { action: "test" }), idCtx(webhook.id))).status).toBe(404);
  });

  it("rate limit test sends", async () => {
    const { webhook } = await bodyOf(await createRoute(req("/api/account/webhooks", "POST", { url: "https://hooks.example.com/in" }), undefined));
    const statuses: number[] = [];
    for (let i = 0; i < 12; i++) {
      statuses.push((await actionRoute(req(`/api/account/webhooks/${webhook.id}`, "POST", { action: "test" }), idCtx(webhook.id))).status);
    }
    expect(statuses.filter((s) => s === 429)).toHaveLength(2);
  });
});
