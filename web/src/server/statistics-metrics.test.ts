import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { upsertUser } from "@/server/auth/session";
import { getDb, schema } from "@/server/db";
import { createProject } from "@/server/projects";
import { createServer } from "@/server/servers";
import { projectStatisticsMetrics } from "@/server/statistics-metrics";
import { updateStatistics } from "@/server/statistics";
import { useFreshDb } from "@/server/test/db";

let ctx: Awaited<ReturnType<typeof useFreshDb>>;
let ownerId: string;
let otherId: string;
let projectId: string;

// 2026-11-24 15:30 UTC
const NOW = new Date(Date.UTC(2026, 10, 24, 15, 30));
const at = (day: number, hour: number) => Date.UTC(2026, 10, day, hour);

let seq = 0;
async function deploy(state: "ready" | "error" | "canceled", createdAt: number, buildMs: number | null) {
  seq++;
  const db = await getDb();
  await db.insert(schema.deployments).values({
    id: `sm-dep-${seq}`,
    projectId,
    env: "production",
    state,
    source: "manual",
    branch: "main",
    port: 3000,
    releaseId: `sm-rel-${seq}`,
    createdAt: new Date(createdAt),
    startedAt: buildMs === null ? null : new Date(createdAt),
    finishedAt: buildMs === null ? null : new Date(createdAt + buildMs),
  } as typeof schema.deployments.$inferInsert);
}

async function view(day: number, hour: number, visitor: string) {
  const db = await getDb();
  await db.insert(schema.pageviews).values({
    projectId,
    at: new Date(at(day, hour)),
    path: "/",
    visitor,
  } as typeof schema.pageviews.$inferInsert);
}

beforeAll(async () => {
  ctx = await useFreshDb();
  ownerId = (await upsertUser({ id: "smm-owner", name: "Sam", email: null, slackId: null })).id;
  otherId = (await upsertUser({ id: "smm-other", name: "Alex", email: null, slackId: null })).id;
  const serverId = (await createServer(ownerId, "smm-owner")).id;
  projectId = (
    await createProject(ownerId, {
      serverId,
      repoUrl: "https://github.com/sam/app.git",
      runtime: "node",
      port: 3000,
      name: "App",
      slug: "app",
    })
  ).id;

  await deploy("ready", at(24, 9), 30_000);
  await deploy("error", at(24, 10), 10_000);
  await deploy("canceled", at(24, 11), null);
  await deploy("ready", at(20, 9), 60_000);
  await deploy("ready", at(2, 9), 1_000); // outside a 7-day range
  await view(24, 8, "v-a");
  await view(24, 9, "v-a");
  await view(24, 10, "v-b");
  await view(20, 8, "v-c");
});

afterAll(async () => {
  await ctx.cleanup();
});

describe("project statistics metrics", () => {
  it("omits every series while all switches are off", async () => {
    const out = await projectStatisticsMetrics(ownerId, projectId, { range: "7d", days: 7 }, NOW);
    expect(out.series).toEqual({});
    expect(out.from).toBe("2026-11-18");
    expect(out.to).toBe("2026-11-24");
  });

  it("returns only the switched-on statistics, computed from the deploy rows", async () => {
    await updateStatistics(ownerId, projectId, { deployCount: true, deploySuccess: true });
    const out = await projectStatisticsMetrics(ownerId, projectId, { range: "7d", days: 7 }, NOW);
    expect(Object.keys(out.series).sort()).toEqual(["deployCount", "deploySuccess"]);
    expect(out.series.deployCount!.at(-1)).toEqual({ date: "2026-11-24", count: 3 });
    expect(out.series.deployCount!.reduce((n, d) => n + d.count, 0)).toBe(4);
    // Nov 24: one ready and one error finished, the canceled one does not count.
    expect(out.series.deploySuccess!.at(-1)).toEqual({ date: "2026-11-24", percent: 50, finished: 2, succeeded: 1 });
    expect(out.series.deploySuccess![2]).toEqual({ date: "2026-11-20", percent: 100, finished: 1, succeeded: 1 });
  });

  it("includes build time only when its switch is on", async () => {
    await updateStatistics(ownerId, projectId, { buildTime: true });
    const out = await projectStatisticsMetrics(ownerId, projectId, { range: "7d", days: 7 }, NOW);
    expect(out.series.buildTime!.at(-1)).toEqual({ date: "2026-11-24", averageMs: 20_000, builds: 2 });
  });

  it("leaves visitors out while its switch is off, and counts distinct visitors per day when on", async () => {
    let out = await projectStatisticsMetrics(ownerId, projectId, { range: "7d", days: 7 }, NOW);
    expect(out.series).not.toHaveProperty("visitors");

    await updateStatistics(ownerId, projectId, { visitors: true });
    out = await projectStatisticsMetrics(ownerId, projectId, { range: "7d", days: 7 }, NOW);
    expect(out.series.visitors!.at(-1)).toEqual({ date: "2026-11-24", visitors: 2 });
    expect(out.series.visitors![2]).toEqual({ date: "2026-11-20", visitors: 1 });
  });

  it("applies the requested range", async () => {
    const out = await projectStatisticsMetrics(ownerId, projectId, { range: "90d", days: 90 }, NOW);
    expect(out.series.deployCount).toHaveLength(90);
    expect(out.series.deployCount!.reduce((n, d) => n + d.count, 0)).toBe(5);
  });

  it("refuses an account that cannot view the project", async () => {
    await expect(projectStatisticsMetrics(otherId, projectId, { range: "7d", days: 7 }, NOW)).rejects.toMatchObject({ status: 404 });
  });
});
