import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { upsertUser } from "@/server/auth/session";
import { schema } from "@/server/db";
import { createProject, deployBranch } from "@/server/projects";
import { createServer } from "@/server/servers";
import { claimNextJob } from "@/server/jobs";
import { useFreshDb } from "@/server/test/db";
import { recoverBuild } from "@/server/operator-recovery";
import { withBuildLock } from "@/server/deploy/build-lock";

let ctx: Awaited<ReturnType<typeof useFreshDb>>;
let admin: string;
beforeAll(async () => {
  ctx = await useFreshDb();
  admin = (await upsertUser({ id: "recovery-admin", name: "Admin", email: null, slackId: null })).id;
  process.env.SECURITY_REPORT_ADMIN_ID = admin;
});
afterAll(async () => { delete process.env.SECURITY_REPORT_ADMIN_ID; await ctx.cleanup(); });

async function setup(name: string) {
  const server = await createServer(admin, name);
  const project = await createProject(admin, { serverId: server.id, name, repoUrl: "https://github.com/example/app", runtime: "node", port: 3000 });
  const dep = await deployBranch(admin, project.id);
  const job = (await claimNextJob(name))!;
  const stale = new Date(Date.now() - 120_000);
  await ctx.db.update(schema.jobs).set({ lockedAt: stale }).where(eq(schema.jobs.id, job.id));
  await ctx.db.update(schema.deployments).set({ state: "building" }).where(eq(schema.deployments.id, dep.id));
  await ctx.db.update(schema.servers).set({ buildLockHolder: dep.id, buildLockAt: stale }).where(eq(schema.servers.id, server.id));
  return { server, dep, job, stale };
}

describe("operator recovery", () => {
  it("fences the stale worker before verifying remote scopes, then releases the verified guard", async () => {
    const { server, dep, job, stale } = await setup("recover-one");
    const script = vi.fn(async (_script: string) => {
      expect(_script).toContain("systemctl show");
      const locked = await ctx.db.select().from(schema.jobs).where(eq(schema.jobs.id, job.id)).get();
      expect(locked!.lockedBy).not.toBe(job.lockedBy);
      return { code: 0, stdout: "", stderr: "" };
    });
    await recoverBuild(admin, server.id, { confirm: true, holder: dep.id, lockAt: stale.toISOString(), workerStoppedConfirmed: true, workerId: job.lockedBy! }, async () => ({ script, close() {} }) as never);
    expect((await ctx.db.select().from(schema.jobs).where(eq(schema.jobs.id, job.id)).get())!.state).toBe("failed");
    expect((await ctx.db.select().from(schema.servers).where(eq(schema.servers.id, server.id)).get())!.buildLockHolder).toBeNull();
  });
  it("retains the job and lock guard when scope verification fails", async () => {
    const { server, dep, job, stale } = await setup("recover-two");
    await expect(recoverBuild(admin, server.id, { confirm: true, holder: dep.id, lockAt: stale.toISOString(), workerStoppedConfirmed: true, workerId: job.lockedBy! }, async () => ({ script: async () => ({ code: 1 }), close() {} }) as never)).rejects.toThrow();
    expect((await ctx.db.select().from(schema.jobs).where(eq(schema.jobs.id, job.id)).get())!.state).toBe("running");
    expect((await ctx.db.select().from(schema.servers).where(eq(schema.servers.id, server.id)).get())!.buildLockHolder).toBeTruthy();
  });
  it("never automatically takes over an abandoned recovery guard", async () => {
    const { server } = await setup("recover-three");
    await ctx.db.update(schema.servers).set({ buildLockHolder: "recovery:abandoned", buildLockAt: new Date(0) }).where(eq(schema.servers.id, server.id));
    const verify = vi.fn(async () => {});
    await expect(withBuildLock(server.id, "next", { verifyStale: verify }, async () => {})).rejects.toThrow(/recovery/i);
    expect(verify).not.toHaveBeenCalled();
  });
  it("a retry after a failed recovery adopts the stale recovery fence and clears it", async () => {
    const { server, dep, job, stale } = await setup("recover-five");
    // First attempt fails remote verification: the guard remains in place.
    await expect(recoverBuild(admin, server.id, { confirm: true, holder: dep.id, lockAt: stale.toISOString(), workerStoppedConfirmed: true, workerId: job.lockedBy! }, async () => ({ script: async () => ({ code: 1, stdout: "", stderr: "" }), close() {} }) as never)).rejects.toThrow();
    const fenced = (await ctx.db.select().from(schema.servers).where(eq(schema.servers.id, server.id)).get())!.buildLockHolder!;
    expect(fenced.startsWith("recovery:")).toBe(true);
    // Time passes; the operator retries, passing the fence inspect now shows.
    const later = new Date(Date.now() - 120_000);
    await ctx.db.update(schema.servers).set({ buildLockAt: later }).where(eq(schema.servers.id, server.id));
    await ctx.db.update(schema.jobs).set({ lockedAt: later }).where(eq(schema.jobs.id, job.id));
    await recoverBuild(admin, server.id, { confirm: true, holder: fenced, lockAt: later.toISOString(), workerStoppedConfirmed: true, workerId: job.lockedBy! }, async () => ({ script: async () => ({ code: 0, stdout: "", stderr: "" }), close() {} }) as never);
    expect((await ctx.db.select().from(schema.jobs).where(eq(schema.jobs.id, job.id)).get())!.state).toBe("failed");
    expect((await ctx.db.select().from(schema.servers).where(eq(schema.servers.id, server.id)).get())!.buildLockHolder).toBeNull();
  });
  it("recovers a crash mid-activation: lock released, deployment deploying, then marked errored", async () => {
    const { server, dep, job, stale } = await setup("recover-six");
    await ctx.db.update(schema.deployments).set({ state: "deploying", activationStartedAt: new Date() }).where(eq(schema.deployments.id, dep.id));
    await ctx.db.update(schema.servers).set({ buildLockHolder: null, buildLockAt: null }).where(eq(schema.servers.id, server.id));
    await recoverBuild(admin, server.id, { confirm: true, holder: dep.id, lockAt: stale.toISOString(), workerStoppedConfirmed: true, workerId: job.lockedBy! }, async () => ({ script: async () => ({ code: 0, stdout: "", stderr: "" }), close() {} }) as never);
    const freed = await ctx.db.select().from(schema.jobs).where(eq(schema.jobs.id, job.id)).get();
    expect(freed!.state).toBe("failed");
    const deployment = await ctx.db.select().from(schema.deployments).where(eq(schema.deployments.id, dep.id)).get();
    expect(deployment!.state).toBe("error");
    const serverRow = await ctx.db.select().from(schema.servers).where(eq(schema.servers.id, server.id)).get();
    expect(serverRow!.buildLockHolder).toBeNull();
    await release(server.id);
  });
  it("recovers after the user canceled the crashed deployment without flipping the canceled state", async () => {
    const { server, dep, job, stale } = await setup("recover-seven");
    await ctx.db.update(schema.deployments).set({ state: "canceled" }).where(eq(schema.deployments.id, dep.id));
    await recoverBuild(admin, server.id, { confirm: true, holder: dep.id, lockAt: stale.toISOString(), workerStoppedConfirmed: true, workerId: job.lockedBy! }, async () => ({ script: async () => ({ code: 0, stdout: "", stderr: "" }), close() {} }) as never);
    expect((await ctx.db.select().from(schema.jobs).where(eq(schema.jobs.id, job.id)).get())!.state).toBe("failed");
    expect((await ctx.db.select().from(schema.deployments).where(eq(schema.deployments.id, dep.id)).get())!.state).toBe("canceled");
    expect((await ctx.db.select().from(schema.servers).where(eq(schema.servers.id, server.id)).get())!.buildLockHolder).toBeNull();
    await release(server.id);
  });
  it("recovers a crash between the claim and the first state write", async () => {
    const { server, dep, job, stale } = await setup("recover-eight");
    await ctx.db.update(schema.deployments).set({ state: "queued" }).where(eq(schema.deployments.id, dep.id));
    await ctx.db.update(schema.servers).set({ buildLockHolder: null, buildLockAt: null }).where(eq(schema.servers.id, server.id));
    await recoverBuild(admin, server.id, { confirm: true, holder: dep.id, lockAt: stale.toISOString(), workerStoppedConfirmed: true, workerId: job.lockedBy! }, async () => ({ script: async () => ({ code: 0, stdout: "", stderr: "" }), close() {} }) as never);
    expect((await ctx.db.select().from(schema.jobs).where(eq(schema.jobs.id, job.id)).get())!.state).toBe("failed");
    expect((await ctx.db.select().from(schema.deployments).where(eq(schema.deployments.id, dep.id)).get())!.state).toBe("error");
    // The queue guard is free again: a fresh deploy of the same project can be claimed.
    const project = await ctx.db.select().from(schema.projects).where(eq(schema.projects.serverId, server.id)).get();
    await deployBranch(admin, project!.id);
    expect(await claimNextJob("fresh-worker")).toBeTruthy();
    await release(server.id);
  });
  it("fences the free lock during activation recovery and sweeps the deployment's own containers", async () => {
    const { server, dep, job, stale } = await setup("recover-nine");
    await ctx.db.update(schema.deployments).set({ state: "deploying", activationStartedAt: new Date() }).where(eq(schema.deployments.id, dep.id));
    await ctx.db.update(schema.servers).set({ buildLockHolder: null, buildLockAt: null }).where(eq(schema.servers.id, server.id));
    let holderDuringSweep: string | null | undefined;
    let sweepScript = "";
    await recoverBuild(admin, server.id, { confirm: true, holder: dep.id, lockAt: stale.toISOString(), workerStoppedConfirmed: true, workerId: job.lockedBy! }, async () => ({
      script: async (text: string) => {
        sweepScript = text;
        holderDuringSweep = (await ctx.db.select().from(schema.servers).where(eq(schema.servers.id, server.id)).get())!.buildLockHolder;
        return { code: 0, stdout: "", stderr: "" };
      },
      close() {},
    } as never));
    // The freed build lock is fenced for the sweep, so a concurrent build is
    // refused instead of having its scope killed.
    expect(holderDuringSweep ?? "").toMatch(/^recovery:/);
    // And the sweep stops the deployment's own activation artifacts too.
    expect(sweepScript).toContain("systemctl stop");
    expect(sweepScript).toContain("docker rm -f");
    expect(sweepScript).toContain("docker compose -p");
    expect((await ctx.db.select().from(schema.servers).where(eq(schema.servers.id, server.id)).get())!.buildLockHolder).toBeNull();
    await release(server.id);
  });
  // Sets free the per-user server cap so later setups can create one.
  async function release(serverId: string) {
    await ctx.db.delete(schema.projects).where(eq(schema.projects.serverId, serverId));
    await ctx.db.delete(schema.servers).where(eq(schema.servers.id, serverId));
  }

  it("requires an administrator and an explicit matching worker attestation", async () => {
    const { server, dep, job, stale } = await setup("recover-four");
    const connect = vi.fn();
    const input = { confirm: true, holder: dep.id, lockAt: stale.toISOString(), workerStoppedConfirmed: true, workerId: job.lockedBy! };
    await expect(recoverBuild("other-user", server.id, input, connect)).rejects.toMatchObject({ status: 403 });
    await expect(recoverBuild(admin, server.id, { ...input, workerStoppedConfirmed: false }, connect)).rejects.toThrow();
    await expect(recoverBuild(admin, server.id, { ...input, workerId: "different" }, connect)).rejects.toThrow();
    expect(connect).not.toHaveBeenCalled();
  });
});

