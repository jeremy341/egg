import { NextRequest } from "next/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@/server/db";
import { useFreshDb } from "@/server/test/db";
import { upsertUser } from "@/server/auth/session";
import { createServer } from "@/server/servers";
import { createProject } from "@/server/projects";
import { requestProjectCleanup } from "@/server/cleanup";
vi.mock("@/server/auth/current", () => ({ getCurrentUser: vi.fn() }));
import { getCurrentUser } from "@/server/auth/current";
import { POST as request } from "@/app/api/projects/[id]/cleanup/route";
import { GET as status, PATCH as retry, DELETE as cancel } from "@/app/api/cleanup/[id]/route";

let db: Awaited<ReturnType<typeof useFreshDb>>;
let owner: Awaited<ReturnType<typeof upsertUser>>;
let other: Awaited<ReturnType<typeof upsertUser>>;
let project: Awaited<ReturnType<typeof createProject>>;
let job: Awaited<ReturnType<typeof requestProjectCleanup>>;
const req = (method: string, body?: unknown, origin = "http://localhost:3000") => new NextRequest("http://localhost:3000/api/cleanup/test", { method, headers: { origin, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
const ctx = () => ({ params: Promise.resolve({ id: job.id }) });
beforeAll(async () => {
  db = await useFreshDb();
  owner = await upsertUser({ id: "cleanup-owner", name: "Owner", email: null, slackId: null });
  other = await upsertUser({ id: "cleanup-other", name: "Other", email: null, slackId: null });
  const server = await createServer(owner.id, "cleanup-routes");
  project = await createProject(owner.id, { serverId: server.id, repoUrl: "https://github.com/a/b", runtime: "node", name: "App", slug: "app", port: 3000 });
  job = await requestProjectCleanup(owner.id, project.id);
});
afterAll(async () => db.cleanup());
beforeEach(() => { vi.mocked(getCurrentUser).mockResolvedValue(null); });

describe("cleanup route authorization and confirmation", () => {
  it("requires sign-in for status and retry", async () => {
    expect((await status(req("GET"), ctx())).status).toBe(401);
    expect((await retry(req("PATCH", {}), ctx())).status).toBe(401);
  });
  it("does not expose or mutate another account's cleanup", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(other);
    expect((await status(req("GET"), ctx())).status).toBe(404);
    expect((await retry(req("PATCH", {}), ctx())).status).toBe(404);
    expect((await cancel(req("DELETE"), ctx())).status).toBe(409);
  });
  it("rejects cross-origin cleanup writes", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(owner);
    expect((await cancel(req("DELETE", undefined, "https://attacker.test"), ctx())).status).toBe(403);
  });
  it("requires the exact project confirmation and validates retry input", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(owner);
    expect((await request(req("POST", { confirm: "wrong" }), { params: Promise.resolve({ id: project.id }) })).status).toBe(400);
    expect((await retry(req("PATCH", { confirmIdle: "yes" }), ctx())).status).toBe(400);
  });

  it("shows the cancel button for a failed cleanup and lets the owner drop it", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(owner);
    await db.db.update(schema.cleanupJobs).set({ state: "failed", attempts: 1 }).where(eq(schema.cleanupJobs.id, job.id));
    const statusRes = await status(req("GET"), ctx());
    expect(statusRes.status).toBe(200);
    expect((await statusRes.json()).cleanup.canCancel).toBe(true);
    expect((await cancel(req("DELETE"), ctx())).status).toBe(200);
    expect(await db.db.select().from(schema.cleanupJobs).where(eq(schema.cleanupJobs.id, job.id)).get()).toBeUndefined();
  });
});
