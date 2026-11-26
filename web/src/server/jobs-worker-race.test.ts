import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { upsertUser } from "@/server/auth/session";
import { createProject, deployBranch } from "@/server/projects";
import { createServer } from "@/server/servers";
import { schema } from "@/server/db";
import { claimNextJob, startWorker } from "@/server/jobs";
import { useFreshDb } from "@/server/test/db";

let ctx: Awaited<ReturnType<typeof useFreshDb>>;
let userId: string;
let serverId: string;
let projectCounter = 0;

const base = {
  repoUrl: "https://github.com/example/demo",
  runtime: "node" as const,
  startCommand: "node server.js",
};

beforeAll(async () => {
  ctx = await useFreshDb();
  userId = (await upsertUser({ id: "worker-race-user", name: "Worker", email: null, slackId: null })).id;
  serverId = (await createServer(userId, "worker-race-server")).id;
});

afterAll(async () => {
  await ctx.cleanup();
});

async function queueProjects(count: number) {
  const deployments = [];
  for (let index = 0; index < count; index++) {
    projectCounter++;
    const project = await createProject(userId, {
      ...base,
      serverId,
      name: `Worker Race ${projectCounter}`,
      port: 3100 + projectCounter,
    });
    deployments.push(await deployBranch(userId, project.id));
  }
  return deployments;
}

describe("worker tick races", () => {
  it("does not exceed its concurrency while claims are pending", async () => {
    await queueProjects(3);
    let claimCalls = 0;
    let releaseClaims!: () => void;
    const claimsReleased = new Promise<void>((resolve) => {
      releaseClaims = resolve;
    });
    const worker = startWorker({
      workerId: "race-worker",
      concurrency: 1,
      pollMs: 1,
      monitorMs: 0,
      statusMs: 0,
      workerOps: {
        claimNextJob: async (workerId) => {
          const job = await claimNextJob(workerId);
          if (job) {
            claimCalls++;
            await claimsReleased;
          }
          return job;
        },
        processJob: async () => {},
      },
    });

    try {
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(claimCalls).toBe(1);
    } finally {
      releaseClaims();
      await worker.stop();
      await ctx.db.update(schema.jobs).set({ state: "done" });
    }
  });

  it("waits for a claim already in progress before stopping", async () => {
    const [deployment] = await queueProjects(1);
    let releaseClaim!: () => void;
    const claimGate = new Promise<void>((resolve) => {
      releaseClaim = resolve;
    });
    let releaseProcess!: () => void;
    const processGate = new Promise<void>((resolve) => {
      releaseProcess = resolve;
    });
    let markClaimed!: () => void;
    const claimed = new Promise<void>((resolve) => {
      markClaimed = resolve;
    });
    let markProcessing!: () => void;
    const processing = new Promise<void>((resolve) => {
      markProcessing = resolve;
    });
    const worker = startWorker({
      workerId: "stopping-worker",
      pollMs: 60_000,
      monitorMs: 0,
      statusMs: 0,
      workerOps: {
        claimNextJob: async (workerId) => {
          const job = await claimNextJob(workerId);
          if (job) {
            markClaimed();
            await claimGate;
          }
          return job;
        },
        processJob: async (job) => {
          markProcessing();
          await processGate;
          await ctx.db.update(schema.jobs).set({ state: "done" }).where(eq(schema.jobs.id, job.id));
        },
      },
    });

    let stopResolved = false;
    const stopping = worker.stop().then(() => {
      stopResolved = true;
    });
    try {
      await claimed;
      expect(stopResolved).toBe(false);
      releaseClaim();
      await processing;
      expect(stopResolved).toBe(false);
    } finally {
      releaseClaim();
      releaseProcess();
      await stopping;
    }

    const job = await ctx.db.select().from(schema.jobs).where(eq(schema.jobs.deploymentId, deployment.id)).get();
    expect(job?.state).toBe("done");
  });
});
