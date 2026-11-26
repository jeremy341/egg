import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { upsertUser } from "@/server/auth/session";
import { schema } from "@/server/db";
import { createProject, enqueueDeployment } from "@/server/projects";
import { createServer } from "@/server/servers";
import { useFreshDb } from "@/server/test/db";
import { cancelCleanup, getCleanupStatus, requestAccountCleanup, requestProjectCleanup, retryCleanup, runCleanupOnce } from "@/server/cleanup";
import type { NestSession } from "@/server/ssh/connection";

let ctx: Awaited<ReturnType<typeof useFreshDb>>;
let userId: string;
let server: Awaited<ReturnType<typeof createServer>>;
let project: Awaited<ReturnType<typeof createProject>>;

beforeEach(async () => {
  ctx = await useFreshDb();
  userId = (await upsertUser({ id: "cleanup-user", name: "Cleanup User", email: null, slackId: null })).id;
  server = await createServer(userId, "cleanup-nest");
  project = await createProject(userId, {
    serverId: server.id,
    repoUrl: "https://github.com/example/cleanup",
    runtime: "node",
    name: "Cleanup app",
    slug: "cleanup-app",
    port: 3000,
  });
});
afterEach(async () => ctx.cleanup());

describe("durable cleanup requests", () => {
  it("does not start before the persisted drain deadline and can cancel before execution", async () => {
    const job = await requestProjectCleanup(userId, project.id);
    const connect = vi.fn();
    expect(await runCleanupOnce({ connect, closeTerminals: async () => {}, unitDir: "/tmp/units" }, new Date(job.requestedAt))).toBeNull();
    expect(connect).not.toHaveBeenCalled();
    await cancelCleanup(userId, job.id);
    await expect(enqueueDeployment(project, { env: "production", source: "manual", branch: "after-cancel" })).resolves.toBeTruthy();
  });
  it("cancels queued work, waits five minutes, and blocks new deployments", async () => {
    const queued = await enqueueDeployment(project, { env: "production", source: "manual", branch: "main" });
    const job = await requestProjectCleanup(userId, project.id);
    const status = await getCleanupStatus(userId, job.id);
    expect(status).toMatchObject({ state: "draining", step: "draining" });
    expect(status.notBefore.getTime() - status.requestedAt.getTime()).toBe(5 * 60_000);
    const deployment = await ctx.db.select().from(schema.deployments).where(eq(schema.deployments.id, queued.id)).get();
    expect(deployment?.state).toBe("canceled");
    await expect(enqueueDeployment(project, { env: "production", source: "manual", branch: "again" })).rejects.toMatchObject({ status: 409 });
  });

  it("preserves the project and failed target status when remote cleanup fails, then allows retry", async () => {
    const job = await requestProjectCleanup(userId, project.id);
    await ctx.db.update(schema.cleanupJobs).set({ notBefore: new Date(Date.now() - 1000) }).where(eq(schema.cleanupJobs.id, job.id));
    const failedSession = {
      script: vi.fn(async (script: string) => script.includes("PROBE")
        ? { code: 0, stdout: "uid=1\nhome=/home/cleanup\nsystemd_state=running\n", stderr: "" }
        : { code: 44, stdout: "", stderr: "stop failed" }),
      close: vi.fn(),
    } as unknown as NestSession;
    await runCleanupOnce({ connect: async () => failedSession, closeTerminals: async () => {}, unitDir: "/tmp/units" });
    const status = await getCleanupStatus(userId, job.id);
    expect(status.state).toBe("failed");
    expect(status.items[0]).toMatchObject({ state: "failed" });
    expect(await ctx.db.select().from(schema.projects).where(eq(schema.projects.id, project.id)).get()).toBeTruthy();
    await retryCleanup(userId, job.id);
    expect((await getCleanupStatus(userId, job.id)).state).toBe("draining");
  });

  it("does not delete a user's data or call GitHub uninstall on failed account cleanup", async () => {
    const job = await requestAccountCleanup(userId, "Cleanup User", "Cleanup User");
    await ctx.db.update(schema.cleanupJobs).set({ notBefore: new Date(Date.now() - 1000) }).where(eq(schema.cleanupJobs.id, job.id));
    const failedSession = {
      script: vi.fn(async () => ({ code: 44, stdout: "", stderr: "stop failed" })),
      close: vi.fn(),
    } as unknown as NestSession;
    await runCleanupOnce({ connect: async () => failedSession, closeTerminals: async () => {}, unitDir: "/tmp/units" });
    expect((await getCleanupStatus(userId, job.id)).state).toBe("failed");
    expect(await ctx.db.select().from(schema.users).where(eq(schema.users.id, userId)).get()).toBeTruthy();
    expect(await ctx.db.select().from(schema.projects).where(eq(schema.projects.id, project.id)).get()).toBeTruthy();
  });

  it("keeps a live deployment blocking cleanup after the drain", async () => {
    const deployment = await enqueueDeployment(project, { env: "production", source: "manual", branch: "live" });
    await ctx.db.update(schema.jobs).set({ state: "running", lockedBy: "worker" }).where(eq(schema.jobs.deploymentId, deployment.id));
    const job = await requestProjectCleanup(userId, project.id);
    const connect = vi.fn();
    await runCleanupOnce({ connect, closeTerminals: async () => {}, unitDir: "/tmp/units" }, new Date(job.notBefore.getTime() + 1));
    expect(connect).not.toHaveBeenCalled();
    expect((await getCleanupStatus(userId, job.id)).step).toBe("waiting_for_deployments");
  });

  it("requires explicit verified-idle recovery for an interrupted executor", async () => {
    const job = await requestProjectCleanup(userId, project.id);
    await ctx.db.update(schema.cleanupJobs).set({ state: "running", leaseOwner: "lost-worker", leaseUntil: new Date(Date.now() - 1000) }).where(eq(schema.cleanupJobs.id, job.id));
    await expect(retryCleanup(userId, job.id)).rejects.toMatchObject({ status: 409 });
    const recovered = await retryCleanup(userId, job.id, true);
    expect(recovered.state).toBe("draining");
  });

  it("deletes project records only after the verified remote step completes", async () => {
    const job = await requestProjectCleanup(userId, project.id);
    const scripts: string[] = [];
    const session = { script: async (script: string) => { scripts.push(script); return { code: 0, stdout: script.includes('echo "uid=') ? "uid=1\nhome=/home/cleanup\n" : "EGG_CLEANUP_WARNING: Shared data preserved\n", stderr: "" }; }, close: vi.fn() } as unknown as NestSession;
    await runCleanupOnce({ connect: async () => session, closeTerminals: async () => {}, unitDir: "/tmp/units" }, new Date(job.notBefore.getTime() + 1));
    expect((await getCleanupStatus(userId, job.id)).state).toBe("done");
    expect(await ctx.db.select().from(schema.projects).where(eq(schema.projects.id, project.id)).get()).toBeUndefined();
    expect(scripts[1]).toContain(".egg-managed");
    expect(scripts[1]).not.toContain('"$d/shared"');
  });
  it("keeps account records after partial success and retries only unfinished targets", async () => {
    const second = await createProject(userId, { serverId: server.id, repoUrl: "https://github.com/a/c", runtime: "node", name: "Second", slug: "cleanup-two", port: 3001 });
    const job = await requestAccountCleanup(userId, "Cleanup User", "Cleanup User");
    let failSecond = true;
    const removed: string[] = [];
    const session = { script: async (script: string) => {
      if (script.includes('echo "uid=')) return { code: 0, stdout: "uid=1\nhome=/home/cleanup\n", stderr: "" };
      if (script.includes("cleanup-two") && failSecond) return { code: 45, stdout: "", stderr: "service stop failed" };
      removed.push(script.includes("cleanup-two") ? "second" : "first");
      return { code: 0, stdout: "", stderr: "" };
    }, close: vi.fn() } as unknown as NestSession;
    const deps = { connect: async () => session, closeTerminals: async () => {}, unitDir: "/tmp/units" };
    await runCleanupOnce(deps, new Date(job.notBefore.getTime() + 1));
    const failed = await getCleanupStatus(userId, job.id);
    expect(failed.state).toBe("failed");
    expect(failed.items.find((item) => item.projectId === project.id)?.state).toBe("done");
    expect(failed.items.find((item) => item.projectId === second.id)?.state).toBe("failed");
    expect(await ctx.db.select().from(schema.users).where(eq(schema.users.id, userId)).get()).toBeTruthy();
    const retry = await retryCleanup(userId, job.id);
    failSecond = false;
    await runCleanupOnce(deps, new Date(retry.notBefore.getTime() + 1));
    expect(removed).toEqual(["first", "second"]);
    expect(await ctx.db.select().from(schema.users).where(eq(schema.users.id, userId)).get()).toBeUndefined();
  });
});
