import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { useFreshDb } from "@/server/test/db";
import { schema, type Db } from "@/server/db";
import { upsertUser } from "@/server/auth/session";
import { getCurrentUser } from "@/server/auth/current";
import { GRACE_PERIOD_MS } from "@/server/account-standing";
import { handle, ok } from "@/server/http";
import { callEndpoint } from "@/server/api-v1";
import type { Principal } from "@/server/api-tokens";
import { endpoint } from "@/server/api-v1-kit";
import { createProject, enqueueDeployment, setEnvVar, updateProject, type NewDeployment } from "@/server/projects";
import type { ProjectRow } from "@/server/projects";
import { POST as reportPost } from "@/app/api/security-reports/route";
import { createServer } from "@/server/servers";

vi.mock("@/server/auth/current", () => ({ getCurrentUser: vi.fn(), requireUser: vi.fn() }));

let ctx: Awaited<ReturnType<typeof useFreshDb>>;
let person: Awaited<ReturnType<typeof upsertUser>>;
let graced: Awaited<ReturnType<typeof upsertUser>>;
let blocked: Awaited<ReturnType<typeof upsertUser>>;
let owner: Awaited<ReturnType<typeof upsertUser>>;
let ownedProject: string;

const SUSPENDED_AT = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000);
const PAST_END = new Date(SUSPENDED_AT.getTime() + GRACE_PERIOD_MS);
const FUTURE_END = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000);

async function suspend(db: Db, userId: string, graceEndsAt: Date) {
  await db
    .update(schema.users)
    .set({ status: "suspended", suspendedAt: new Date(graceEndsAt.getTime() - GRACE_PERIOD_MS), graceEndsAt, suspensionReason: "test" })
    .where(eq(schema.users.id, userId));
}

beforeAll(async () => {
  ctx = await useFreshDb();
  person = await upsertUser({ id: "enforce-person", name: "Person", email: null, slackId: null });
  graced = await upsertUser({ id: "enforce-graced", name: "Graced", email: null, slackId: null });
  blocked = await upsertUser({ id: "enforce-blocked", name: "Blocked", email: null, slackId: null });
  // A real project owned by an account that is then blocked, so settings writes reach the guard.
  owner = await upsertUser({ id: "enforce-owner", name: "Owner", email: null, slackId: null });
  const serverId = (await createServer(owner.id, "enforce-owner-server")).id;
  ownedProject = (await createProject(owner.id, {
    repoUrl: "https://github.com/example/demo",
    runtime: "node",
    startCommand: "node server.js",
    serverId,
    name: "Owned Demo",
    port: 3400,
  })).id;
  await suspend(ctx.db, graced.id, FUTURE_END);
  await suspend(ctx.db, blocked.id, PAST_END);
  await suspend(ctx.db, owner.id, PAST_END);
  process.env.SECURITY_REPORT_ADMIN_ID = person.id;
});
afterAll(async () => {
  delete process.env.SECURITY_REPORT_ADMIN_ID;
  await ctx.cleanup();
});
beforeEach(() => {
  vi.mocked(getCurrentUser).mockReset();
});

const refusedAsSuspended = { status: 403, code: "account_suspended" };

describe("suspended accounts: service-level writes", () => {
  it("project create is refused after the grace period", async () => {
    await expect(createProject(blocked.id, {})).rejects.toMatchObject(refusedAsSuspended);
  });

  it("project settings and environment variables are refused after the grace period", async () => {
    await expect(updateProject(owner.id, ownedProject, { name: "x" })).rejects.toMatchObject(refusedAsSuspended);
    await expect(setEnvVar(owner.id, ownedProject, { key: "A", value: "b", target: "all" })).rejects.toMatchObject(refusedAsSuspended);
  });

  it("a deployment (including a webhook-triggered one) is refused after the grace period", async () => {
    const project = { id: "p-blocked", userId: blocked.id, deploymentMode: "native", workloadKind: "web" } as unknown as ProjectRow;
    const input: NewDeployment = { env: "production", source: "manual", branch: "main" };
    await expect(enqueueDeployment(project, input)).rejects.toMatchObject(refusedAsSuspended);
  });

  it("the same writes are not refused during grace (they fail later, on their own validation)", async () => {
    await expect(createProject(graced.id, {})).rejects.not.toMatchObject({ code: "account_suspended" });
  });
});

describe("suspended accounts: browser routes", () => {
  const route = handle(async () => ok({ ran: true }));

  it("refuses a blocked account's write, but lets its read through", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(blocked);
    const write = await route(new NextRequest("http://localhost:3000/api/projects/p1", { method: "PATCH" }), undefined);
    expect(write.status).toBe(403);
    expect((await write.json()).error.code).toBe("account_suspended");
    expect((await route(new NextRequest("http://localhost:3000/api/projects"), undefined)).status).toBe(200);
  });

  it("keeps a graced account's writes open", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(graced);
    expect((await route(new NextRequest("http://localhost:3000/api/projects", { method: "POST" }), undefined)).status).toBe(200);
  });

  it("keeps sign-out open for a blocked account", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(blocked);
    expect((await route(new NextRequest("http://localhost:3000/api/auth/logout", { method: "POST" }), undefined)).status).toBe(200);
  });

  it("refuses a security report submitted from a blocked signed-in account", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(blocked);
    const res = await reportPost(
      new NextRequest("http://localhost:3000/api/security-reports", {
        method: "POST",
        // A session cookie is what makes the route look up the signed-in account.
        headers: { "content-type": "application/json", cookie: "session=test" },
        body: JSON.stringify({ title: "Private issue", details: "Steps to reproduce a private issue.", impact: "Private data.", anonymous: true }),
      }),
      undefined as never,
    );
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("account_suspended");
  });
});

describe("suspended accounts: API writes", () => {
  const principal = (userId: string): Principal => ({ userId, tokenId: "test-token", scopes: ["projects:write", "projects:read"] });
  const write = endpoint({
    id: "test_write",
    method: "POST",
    path: "/test",
    scope: null,
    bucket: "write",
    tag: "Projects",
    summary: "Test",
    description: "Test",
    response: z.object({ ok: z.boolean() }),
    run: async () => ({ ok: true }),
  });
  const read = endpoint({
    id: "test_read",
    method: "GET",
    path: "/test",
    scope: null,
    bucket: "read",
    tag: "Projects",
    summary: "Test",
    description: "Test",
    response: z.object({ ok: z.boolean() }),
    run: async () => ({ ok: true }),
  });

  it("refuses an API write from a blocked account and allows its API read", async () => {
    await expect(callEndpoint(principal(blocked.id), write, {})).rejects.toMatchObject(refusedAsSuspended);
    await expect(callEndpoint(principal(blocked.id), read, {})).resolves.toEqual({ ok: true });
    await expect(callEndpoint(principal(graced.id), write, {})).resolves.toEqual({ ok: true });
  });
});
