import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { sql } from "drizzle-orm";
import { createApiToken, type Scope } from "@/server/api-tokens";
import { upsertUser } from "@/server/auth/session";
import { schema } from "@/server/db";
import { rateLimiter } from "@/server/rate-limit";
import { useFreshDb } from "@/server/test/db";

// Never touch the network from a route test: the send itself is replaced.
vi.mock("@/server/webhook-net", async (orig) => ({
  ...(await orig<typeof import("@/server/webhook-net")>()),
  safePost: vi.fn(async () => ({ status: 200 })),
}));

import { GET as listRoute, POST as createRoute } from "@/app/api/v1/webhooks/route";
import { DELETE as deleteRoute, GET as getRoute, PATCH as patchRoute } from "@/app/api/v1/webhooks/[webhookId]/route";
import { POST as rotateRoute } from "@/app/api/v1/webhooks/[webhookId]/rotate/route";
import { POST as testRoute } from "@/app/api/v1/webhooks/[webhookId]/test/route";

let ctx: Awaited<ReturnType<typeof useFreshDb>>;
let samKey: string;
let kimKey: string;
let readOnlyKey: string;
let noWebhookKey: string;

const ORIGIN = "http://localhost:3000";
function call(path: string, method: string, key: string | null, body?: unknown) {
  return new NextRequest(`${ORIGIN}${path}`, {
    method,
    headers: { "content-type": "application/json", ...(key ? { authorization: `Bearer ${key}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
const idCtx = (webhookId: string) => ({ params: Promise.resolve({ webhookId }) });
const noCtx = { params: Promise.resolve({}) };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const bodyOf = async (res: Response) => (await res.json()) as Record<string, any>;

async function key(userId: string, scopes: Scope[]) {
  return (await createApiToken(userId, { name: "t", scopes, expiresInDays: 30 })).secret;
}

beforeAll(async () => {
  ctx = await useFreshDb();
  const sam = (await upsertUser({ id: "wr1", name: "Sam", email: null, slackId: null })).id;
  const kim = (await upsertUser({ id: "wr2", name: "Kim", email: null, slackId: null })).id;
  samKey = await key(sam, ["webhooks:read", "webhooks:write"]);
  kimKey = await key(kim, ["webhooks:read", "webhooks:write"]);
  readOnlyKey = await key(sam, ["webhooks:read"]);
  noWebhookKey = await key(sam, ["projects:read"]);
});
afterAll(async () => {
  await ctx.cleanup();
});
beforeEach(async () => {
  rateLimiter().clear();
  await ctx.db.delete(schema.webhooks);
});

const make = async (k = samKey) => {
  const res = await createRoute(call("/api/v1/webhooks", "POST", k, { url: "https://hooks.example.com/in" }), noCtx);
  return { res, body: await bodyOf(res) };
};

describe("webhook routes", () => {
  it("need a bearer token and the right scope", async () => {
    expect((await listRoute(call("/api/v1/webhooks", "GET", null), noCtx)).status).toBe(401);
    expect((await listRoute(call("/api/v1/webhooks", "GET", noWebhookKey), noCtx)).status).toBe(403);
    const denied = await createRoute(call("/api/v1/webhooks", "POST", readOnlyKey, { url: "https://a.example.com/" }), noCtx);
    expect(denied.status).toBe(403);
    expect((await listRoute(call("/api/v1/webhooks", "GET", readOnlyKey), noCtx)).status).toBe(200);

    const id = (await make()).body.webhook.id as string;
    expect((await patchRoute(call(`/api/v1/webhooks/${id}`, "PATCH", readOnlyKey, { active: false }), idCtx(id))).status).toBe(403);
    expect((await deleteRoute(call(`/api/v1/webhooks/${id}`, "DELETE", readOnlyKey), idCtx(id))).status).toBe(403);
    expect((await rotateRoute(call(`/api/v1/webhooks/${id}/rotate`, "POST", readOnlyKey), idCtx(id))).status).toBe(403);
    expect((await testRoute(call(`/api/v1/webhooks/${id}/test`, "POST", readOnlyKey), idCtx(id))).status).toBe(403);
  });

  it("returns the secret once, uncached, and never again", async () => {
    const { res, body } = await make();
    expect(res.status).toBe(201);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(body.secret).toMatch(/^whsec_/);
    const id = body.webhook.id as string;
    const list = await (await listRoute(call("/api/v1/webhooks", "GET", samKey), noCtx)).text();
    const one = await (await getRoute(call(`/api/v1/webhooks/${id}`, "GET", samKey), idCtx(id))).text();
    expect(list + one).not.toContain(body.secret);
    const rotated = await bodyOf(await rotateRoute(call(`/api/v1/webhooks/${id}/rotate`, "POST", samKey), idCtx(id)));
    expect(rotated.secret).toMatch(/^whsec_/);
    expect(rotated.secret).not.toBe(body.secret);
  });

  it("treats another user's webhook as not found", async () => {
    const id = (await make()).body.webhook.id as string;
    expect(await bodyOf(await listRoute(call("/api/v1/webhooks", "GET", kimKey), noCtx))).toEqual({ webhooks: [] });
    const attempts = [
      getRoute(call(`/api/v1/webhooks/${id}`, "GET", kimKey), idCtx(id)),
      patchRoute(call(`/api/v1/webhooks/${id}`, "PATCH", kimKey, { active: false }), idCtx(id)),
      deleteRoute(call(`/api/v1/webhooks/${id}`, "DELETE", kimKey), idCtx(id)),
      rotateRoute(call(`/api/v1/webhooks/${id}/rotate`, "POST", kimKey), idCtx(id)),
      testRoute(call(`/api/v1/webhooks/${id}/test`, "POST", kimKey), idCtx(id)),
    ];
    for (const res of await Promise.all(attempts)) expect(res.status).toBe(404);
    expect((await getRoute(call(`/api/v1/webhooks/${id}`, "GET", samKey), idCtx(id))).status).toBe(200);
  });

  it("rejects bad URLs, unknown fields and bad JSON with 400", async () => {
    const bads = [{ url: "http://a.example.com" }, { url: "https://10.0.0.1/" }, { url: "https://a.example.com/", nope: 1 }, {}];
    for (const bad of bads) {
      expect((await createRoute(call("/api/v1/webhooks", "POST", samKey, bad), noCtx)).status).toBe(400);
    }
    const garbage = new NextRequest(`${ORIGIN}/api/v1/webhooks`, {
      method: "POST",
      headers: { authorization: `Bearer ${samKey}` },
      body: "{not json",
    });
    expect((await createRoute(garbage, noCtx)).status).toBe(400);
  });

  it("updates and deletes", async () => {
    const id = (await make()).body.webhook.id as string;
    const patched = await bodyOf(await patchRoute(call(`/api/v1/webhooks/${id}`, "PATCH", samKey, { active: false }), idCtx(id)));
    expect(patched.webhook.active).toBe(false);
    expect((await deleteRoute(call(`/api/v1/webhooks/${id}`, "DELETE", samKey), idCtx(id))).status).toBe(200);
    expect((await getRoute(call(`/api/v1/webhooks/${id}`, "GET", samKey), idCtx(id))).status).toBe(404);
  });

  it("sends a test message and lists the delivery", async () => {
    const id = (await make()).body.webhook.id as string;
    const sent = await bodyOf(await testRoute(call(`/api/v1/webhooks/${id}/test`, "POST", samKey), idCtx(id)));
    expect(sent.delivery).toMatchObject({ status: "success", attempts: 1, event: "webhook.test" });
    const one = await bodyOf(await getRoute(call(`/api/v1/webhooks/${id}`, "GET", samKey), idCtx(id)));
    expect(one.deliveries).toHaveLength(1);
  });

  it("uses the existing rate limiter, with the small bucket for test sends", async () => {
    const id = (await make()).body.webhook.id as string;
    let limited = 0;
    for (let i = 0; i < 12; i++) {
      const res = await testRoute(call(`/api/v1/webhooks/${id}/test`, "POST", samKey), idCtx(id));
      if (res.status === 429) {
        limited++;
        expect(res.headers.get("retry-after")).toBeTruthy();
      }
    }
    expect(limited).toBe(2);
  });
});
