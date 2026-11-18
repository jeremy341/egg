import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { upsertUser } from "@/server/auth/session";
import { schema } from "@/server/db";
import type { PipelineDeps } from "@/server/deploy/pipeline";
import {
  claimNextJob,
  countOrphanedJobs,
  recoverStaleJobs,
  startWorker,
} from "@/server/jobs";
import { cancelDeployment, createProject, deployBranch, type ProjectRow } from "@/server/projects";
import { connectToServer, createServer, getServerForUser } from "@/server/servers";
import { fakeBuilder, freePort, containerReadyFacts, installFakeContainerBuild, installFakeSystemd, nodeApp } from "@/server/test/fake-nest";
import { useFreshDb } from "@/server/test/db";
import { startMockSsh, type MockSsh } from "@/server/test/mock-ssh";

let ctx: Awaited<ReturnType<typeof useFreshDb>>;
let userId: string;
let serverId: string;
let a: ProjectRow;
let b: ProjectRow;

const base = {
  repoUrl: "https://github.com/example/demo",
  runtime: "node" as const,
  startCommand: "node server.js",
};

beforeAll(async () => {
  ctx = await useFreshDb();
  userId = (await upsertUser({ id: "u1", name: "Sam", email: null, slackId: null })).id;
  serverId = (await createServer(userId, "sam-r")).id;
  a = await createProject(userId, { ...base, serverId, name: "Alpha", port: 3001 });
  b = await createProject(userId, { ...base, serverId, name: "Beta", port: 3002 });
});
afterAll(async () => {
  await ctx.cleanup();
});

describe("queue", () => {
  // Each test records the deployments it queued. afterEach finishes only those jobs, so a test
  // never relies on rows an earlier test left behind, and never touches another test's rows.
  let ownDeploymentIds: string[] = [];
  async function queueDeploy(projectId: string, branchName?: string) {
    const dep = await deployBranch(userId, projectId, branchName);
    ownDeploymentIds.push(dep.id);
    return dep;
  }
  afterEach(async () => {
    const ids = ownDeploymentIds;
    ownDeploymentIds = [];
    if (ids.length > 0) {
      await ctx.db.update(schema.jobs).set({ state: "done" }).where(inArray(schema.jobs.deploymentId, ids));
    }
  });

  it("claims jobs oldest first and never twice", async () => {
    const first = await queueDeploy(a.id);
    const second = await queueDeploy(b.id);
    const [x, y] = await Promise.all([claimNextJob("w1"), claimNextJob("w2")]);
    expect(x).toBeTruthy();
    expect(y).toBeTruthy();
    expect(x!.id).not.toBe(y!.id);
    expect([x!.deploymentId, y!.deploymentId].sort()).toEqual([first.id, second.id].sort());
    expect(await claimNextJob("w3")).toBeNull();
  });

  it("runs one job per project at a time", async () => {
    const one = await queueDeploy(a.id);
    const two = await queueDeploy(a.id);
    const claimed = await claimNextJob("w1");
    expect(claimed?.deploymentId).toBe(one.id);
    // The second Alpha job must wait while the first is running.
    expect(await claimNextJob("w2")).toBeNull();

    await ctx.db.update(schema.jobs).set({ state: "done" }).where(eq(schema.jobs.id, claimed!.id));
    expect((await claimNextJob("w2"))?.deploymentId).toBe(two.id);
  });

  it("does not let concurrent workers claim separate jobs for one project", async () => {
    const one = await queueDeploy(a.id);
    const two = await queueDeploy(a.id);
    const claims = await Promise.all([claimNextJob("race-1"), claimNextJob("race-2")]);
    expect(claims.filter(Boolean)).toHaveLength(1);
    expect(claims.find(Boolean)?.deploymentId).toBe(one.id);
    expect(two.id).not.toBe(one.id);
  });

  it("skips a blocked queue prefix so an idle project's job can run", async () => {
    for (let i = 0; i < 26; i++) await queueDeploy(a.id, `blocked-${i}`);
    const idle = await queueDeploy(b.id, "idle-project");
    const first = await claimNextJob("prefix-blocker");
    expect(first).toBeTruthy();
    const next = await claimNextJob("idle-worker");
    expect(next?.deploymentId).toBe(idle.id);
  });

  it("does not run a canceled deployment", async () => {
    const dep = await queueDeploy(b.id);
    await cancelDeployment(userId, dep.id);
    expect(await claimNextJob("w1")).toBeNull();
    const row = await ctx.db.select().from(schema.deployments).where(eq(schema.deployments.id, dep.id)).get();
    expect(row?.state).toBe("canceled");
  });

  it("keeps jobs from a stopped worker blocking until manual confirmation", async () => {
    const dep = await deployBranch(userId, a.id);
    const job = await claimNextJob("dead-worker");
    expect(job).toBeTruthy();
    await ctx.db
      .update(schema.deployments)
      .set({ state: "building" })
      .where(eq(schema.deployments.id, dep.id));

    expect(await countOrphanedJobs("dead-worker")).toBe(1);
    const row = await ctx.db.select().from(schema.deployments).where(eq(schema.deployments.id, dep.id)).get();
    expect(row?.state).toBe("building");
    expect(await claimNextJob("replacement-worker")).toBeNull();
  });

  it("keeps expired leases blocking until an operator confirms remote work stopped", async () => {
    const dep = await deployBranch(userId, b.id);
    const job = await claimNextJob("slow");
    await ctx.db
      .update(schema.jobs)
      .set({ lockedAt: new Date(Date.now() - 2 * 60 * 60 * 1000) })
      .where(eq(schema.jobs.id, job!.id));
    expect(await recoverStaleJobs()).toBe(1);
    const row = await ctx.db.select().from(schema.deployments).where(eq(schema.deployments.id, dep.id)).get();
    expect(row?.state).toBe("queued");
    expect(await claimNextJob("replacement-worker")).toBeNull();
  });
});

// Ceiling for the deployment to settle, and the per-test timeout that leaves room above it
// for setup (mock host, project creation) and the assertions.
const DEPLOY_SETTLE_CEILING_MS = 90_000;
const WORKER_TEST_TIMEOUT_MS = 120_000;

/** Polls the deployment until it is ready or failed; the error carries the last observed state. */
async function waitForDeploymentSettled(deploymentId: string): Promise<string> {
  const started = Date.now();
  let last = "no row read yet";
  while (Date.now() - started < DEPLOY_SETTLE_CEILING_MS) {
    const row = await ctx.db.select().from(schema.deployments).where(eq(schema.deployments.id, deploymentId)).get();
    last = row ? row.state : "deployment row missing";
    if (last === "ready" || last === "error") return last;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(
    `Timed out after ${DEPLOY_SETTLE_CEILING_MS}ms waiting for deployment ${deploymentId} to become ready or error; last observed state: ${last}`,
  );
}

describe("worker", () => {
  let mock: MockSsh;

  afterAll(async () => {
    await mock?.stop();
  });

  it("picks up a queued deployment and takes it live", async () => {
    // A real mock Nest, authorised for a fresh server's key.
    const srv = await createServer(userId, "sam-w", { host: "127.0.0.1", port: 1 });
    mock = await startMockSsh({ authorizedKeys: [srv.publicKey] });
    installFakeSystemd(mock);
    installFakeContainerBuild(mock);
    await ctx.db.update(schema.servers).set({ port: mock.port, hostKeyFingerprint: mock.hostKeyFingerprint }).where(eq(schema.servers.id, srv.id));
    const refreshed = await getServerForUser(userId, srv.id);

    const project = await createProject(userId, {
      ...base,
      serverId: refreshed.id,
      name: "Worker Demo",
      port: await freePort(),
    });
    const dep = await deployBranch(userId, project.id);

    const deps: PipelineDeps = {
      preflight: () => async () => containerReadyFacts,
      lockPollMs: 50,
      sourceBuild: fakeBuilder(() => nodeApp("worker")),
      connect: connectToServer,
      unitDir: `${mock.home}/units`,
      healthTimeoutSeconds: 8,
    };
    const worker = startWorker({ pollMs: 100, deps, onError: (e) => { throw e; } });

    let state: string;
    try {
      state = await waitForDeploymentSettled(dep.id);
    } finally {
      await worker.stop();
    }

    expect(state).toBe("ready");
    const job = await ctx.db.select().from(schema.jobs).where(eq(schema.jobs.deploymentId, dep.id)).get();
    expect(job?.state).toBe("done");
    // The deploy runs through the mock WSL and SSH stack, whose speed depends on machine load.
    // This test gets its own ceiling because the suite default (20s) is shorter than the wait below.
  }, WORKER_TEST_TIMEOUT_MS);
});
