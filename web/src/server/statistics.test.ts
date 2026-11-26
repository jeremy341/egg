import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { upsertUser } from "@/server/auth/session";
import { getStatistics, getStatisticsForUser, NO_STATISTICS, updateStatistics } from "@/server/statistics";
import { createProject } from "@/server/projects";
import { createServer } from "@/server/servers";
import { useFreshDb } from "@/server/test/db";

let ctx: Awaited<ReturnType<typeof useFreshDb>>;
let ownerId: string;
let otherId: string;
let projectId: string;

beforeAll(async () => {
  ctx = await useFreshDb();
  ownerId = (await upsertUser({ id: "stats-owner", name: "Sam", email: null, slackId: null })).id;
  otherId = (await upsertUser({ id: "stats-other", name: "Alex", email: null, slackId: null })).id;
  const serverId = (await createServer(ownerId, "stats-owner")).id;
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
});

afterAll(async () => {
  await ctx.cleanup();
});

describe("per-project statistics switches", () => {
  it("are all off for a project that has never been changed", async () => {
    expect(await getStatistics(projectId)).toEqual(NO_STATISTICS);
    expect(await getStatisticsForUser(ownerId, projectId)).toEqual(NO_STATISTICS);
  });

  it("let the owner switch one statistic on without touching the others", async () => {
    const next = await updateStatistics(ownerId, projectId, { deployCount: true });
    expect(next).toEqual({ ...NO_STATISTICS, deployCount: true });
    const again = await updateStatistics(ownerId, projectId, { buildTime: true });
    expect(again).toEqual({ ...NO_STATISTICS, deployCount: true, buildTime: true });
  });

  it("switch a statistic back off", async () => {
    const next = await updateStatistics(ownerId, projectId, { deployCount: false, visitors: true });
    expect(next).toEqual({ ...NO_STATISTICS, buildTime: true, visitors: true });
  });

  it("refuse keys that are not statistics", async () => {
    await expect(updateStatistics(ownerId, projectId, { clicks: true } as never)).rejects.toMatchObject({ status: 400 });
    expect(await getStatistics(projectId)).toEqual({ ...NO_STATISTICS, buildTime: true, visitors: true });
  });

  it("refuse non-string-boolean values", async () => {
    await expect(updateStatistics(ownerId, projectId, { deploySuccess: "yes" } as never)).rejects.toMatchObject({ status: 400 });
  });

  it("cannot be changed by another account", async () => {
    await expect(updateStatistics(otherId, projectId, { deploySuccess: true })).rejects.toMatchObject({ status: 404 });
    expect((await getStatistics(projectId)).deploySuccess).toBe(false);
  });

  it("cannot be read by another account", async () => {
    await expect(getStatisticsForUser(otherId, projectId)).rejects.toMatchObject({ status: 404 });
  });
});
