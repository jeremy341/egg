import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { upsertUser } from "@/server/auth/session";
import { getDb, schema } from "@/server/db";
import { accountDailyActivity, projectDailyActivity } from "@/server/heatmap";
import { createProject } from "@/server/projects";
import { createServer } from "@/server/servers";
import { useFreshDb } from "@/server/test/db";

let ctx: Awaited<ReturnType<typeof useFreshDb>>;
let alpha: string;
let beta: string;
let gamma: string;
let ownerId: string;

// 2026-11-24 15:30 UTC
const NOW = Date.UTC(2026, 10, 24, 15, 30);
const D1 = Date.UTC(2026, 10, 10, 9, 0);
const D1_LATE = Date.UTC(2026, 10, 10, 23, 0);
const D2 = Date.UTC(2026, 10, 12, 4, 0);
const TWO_YEARS_AGO = Date.UTC(2024, 10, 1, 4, 0);

let deploySeq = 0;
async function deploy(projectId: string, at: number) {
  deploySeq++;
  const db = await getDb();
  await db.insert(schema.deployments).values({
    id: `hm-dep-${deploySeq}`,
    projectId,
    env: "production",
    state: "ready",
    source: "manual",
    branch: "main",
    port: 3000,
    releaseId: `hm-rel-${deploySeq}`,
    createdAt: new Date(at),
  } as typeof schema.deployments.$inferInsert);
}

async function pr(projectId: string, number: number, action: string, at: number) {
  const db = await getDb();
  await db.insert(schema.pullRequestEvents).values({
    id: `hm-pr-${projectId}-${number}-${action}`,
    projectId,
    action,
    number,
    createdAt: new Date(at),
  });
}

beforeAll(async () => {
  ctx = await useFreshDb();
  const owner = await upsertUser({ id: "heat-owner", name: "Sam", email: null, slackId: null });
  ownerId = owner.id;
  const other = await upsertUser({ id: "heat-other", name: "Alex", email: null, slackId: null });
  const serverA = await createServer(owner.id, "heat-owner");
  const serverB = await createServer(other.id, "heat-other");
  const base = { repoUrl: "https://github.com/sam/app.git", runtime: "node" as const };
  alpha = (await createProject(owner.id, { ...base, serverId: serverA.id, port: 3000, name: "Alpha", slug: "alpha" })).id;
  beta = (await createProject(owner.id, { ...base, serverId: serverA.id, port: 3001, name: "Beta", slug: "beta" })).id;
  gamma = (await createProject(other.id, { ...base, serverId: serverB.id, port: 3000, name: "Gamma", slug: "gamma" })).id;

  await deploy(alpha, D1);
  await deploy(alpha, D1_LATE);
  await deploy(alpha, D2);
  await deploy(alpha, TWO_YEARS_AGO);
  await pr(alpha, 1, "opened", D1);
  await pr(alpha, 1, "closed", D1); // closing is not counted as activity
  await deploy(beta, D1);
  for (let i = 0; i < 5; i++) await deploy(gamma, D1); // someone else's project
});

afterAll(async () => {
  await ctx.cleanup();
});

describe("heatmap data", () => {
  it("counts a project's deploys and opened pull requests per UTC day", async () => {
    const counts = await projectDailyActivity(alpha, NOW);
    expect(counts).toEqual({ "2026-11-10": 3, "2026-11-12": 1 });
  });

  it("leaves out events older than the window", async () => {
    const counts = await projectDailyActivity(alpha, NOW);
    expect(Object.keys(counts)).not.toContain("2024-11-01");
  });

  it("sums every project an account owns, and nothing from other accounts", async () => {
    const counts = await accountDailyActivity(ownerId, NOW);
    expect(counts).toEqual({ "2026-11-10": 4, "2026-11-12": 1 });
  });

  it("returns nothing for a project with no activity", async () => {
    expect(await projectDailyActivity(gamma, NOW)).toEqual({ "2026-11-10": 5 });
    expect(await projectDailyActivity(beta, Date.UTC(2020, 0, 1))).toEqual({});
  });
});

