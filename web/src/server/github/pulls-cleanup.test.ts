import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { upsertUser } from "@/server/auth/session";
import { getDb, schema } from "@/server/db";
import { createProject, deployBranch } from "@/server/projects";
import { createServer } from "@/server/servers";
import { useFreshDb } from "@/server/test/db";
import { closePullRequestPreviews, reconcileClosedPreviews } from "@/server/github/pulls";

const remote = vi.hoisted(() => ({ code: 0, removals: 0 }));
vi.mock("@/server/servers", async (load) => ({
  ...await load<typeof import("@/server/servers")>(),
  withServerSession: async (_server: unknown, fn: (s: unknown) => unknown) => fn({
    script: async () => { remote.removals++; return { code: remote.code, stdout: "", stderr: "stop failed" }; },
  }),
}));
vi.mock("@/server/ssh/probe", () => ({ probeSession: async () => ({ home: "/root" }) }));

describe("closed pull-request preview cleanup", () => {
  let ctx: Awaited<ReturnType<typeof useFreshDb>>;
  let userId: string;
  let projectId: string;
  beforeAll(async () => {
    ctx = await useFreshDb();
    userId = (await upsertUser({ id: "pr-cleanup", name: "Sam", email: null, slackId: null })).id;
    const server = await createServer(userId, "sam-cleanup");
    projectId = (await createProject(userId, { serverId: server.id, name: "App", slug: "cleanup-app", repoUrl: "https://github.com/sam/app.git", runtime: "node", port: 3000 })).id;
  });
  afterAll(async () => ctx.cleanup());
  beforeEach(async () => { await (await getDb()).delete(schema.deployments); remote.removals = 0; remote.code = 0; });

  async function preview(state: "ready" | "canceled") {
    const dep = await deployBranch(userId, projectId, "feature");
    const db = await getDb();
    await db.update(schema.deployments).set({ state, prNumber: 7 }).where(eq(schema.deployments.id, dep.id));
    await db.update(schema.jobs).set({ state: "done" }).where(eq(schema.jobs.deploymentId, dep.id));
    return dep;
  }

  it("retries a canceled preview left behind by an interrupted close", async () => {
    const dep = await preview("canceled");
    expect((await closePullRequestPreviews(projectId, 7)).removed).toBe(1);
    expect(remote.removals).toBe(1);
    expect((await ctx.db.select().from(schema.deployments).where(eq(schema.deployments.id, dep.id)).get())?.cleanedUp).toBe(true);
  });

  it("does not remove a release while its worker still owns a running job", async () => {
    const dep = await preview("ready");
    await ctx.db.update(schema.jobs).set({ state: "running" }).where(eq(schema.jobs.deploymentId, dep.id));
    expect((await closePullRequestPreviews(projectId, 7)).removed).toBe(0);
    expect(remote.removals).toBe(0);
    expect((await ctx.db.select().from(schema.deployments).where(eq(schema.deployments.id, dep.id)).get())?.state).toBe("canceled");
    await ctx.db.update(schema.jobs).set({ state: "done" }).where(eq(schema.jobs.deploymentId, dep.id));
    expect((await closePullRequestPreviews(projectId, 7)).removed).toBe(1);
  });

  it("keeps failed removals pending and succeeds on a later retry", async () => {
    const dep = await preview("ready");
    remote.code = 45;
    expect((await closePullRequestPreviews(projectId, 7)).removed).toBe(0);
    expect((await ctx.db.select().from(schema.deployments).where(eq(schema.deployments.id, dep.id)).get())?.cleanedUp).toBe(false);
    remote.code = 0;
    await reconcileClosedPreviews();
    expect((await ctx.db.select().from(schema.deployments).where(eq(schema.deployments.id, dep.id)).get())?.cleanedUp).toBe(true);
  });

  it("does not cancel a new build after its pull request was reopened", async () => {
    const old = await preview("ready");
    remote.code = 45;
    await closePullRequestPreviews(projectId, 7);
    const fresh = await deployBranch(userId, projectId, "feature");
    await ctx.db.update(schema.deployments).set({ prNumber: 7 }).where(eq(schema.deployments.id, fresh.id));
    remote.code = 0;
    await reconcileClosedPreviews();
    expect((await ctx.db.select().from(schema.deployments).where(eq(schema.deployments.id, fresh.id)).get())?.state).toBe("queued");
    expect((await ctx.db.select().from(schema.deployments).where(eq(schema.deployments.id, old.id)).get())?.cleanedUp).toBe(true);
  });

  it("remembers PR-close cleanup for a preview that was already canceled by its owner", async () => {
    const dep = await preview("canceled");
    await ctx.db.update(schema.deployments).set({ error: "Canceled" }).where(eq(schema.deployments.id, dep.id));
    await ctx.db.update(schema.jobs).set({ state: "running" }).where(eq(schema.jobs.deploymentId, dep.id));
    await closePullRequestPreviews(projectId, 7);
    await ctx.db.update(schema.jobs).set({ state: "done" }).where(eq(schema.jobs.deploymentId, dep.id));
    await reconcileClosedPreviews();
    expect((await ctx.db.select().from(schema.deployments).where(eq(schema.deployments.id, dep.id)).get())?.cleanedUp).toBe(true);
  });
});
