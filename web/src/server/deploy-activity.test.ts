import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { deployActivity } from "@/server/deploy-activity";
import { upsertUser } from "@/server/auth/session";
import { getDb, schema } from "@/server/db";
import { createProject } from "@/server/projects";
import { createServer } from "@/server/servers";
import { useFreshDb } from "@/server/test/db";

let ctx: Awaited<ReturnType<typeof useFreshDb>>;
let userId: string;
let otherId: string;
let serverId: string;
let otherServerId: string;
let n = 0;
const now = new Date("2026-11-04T12:00:00Z");

async function newProject(owner: string, server: string) {
  n += 1;
  const p = await createProject(owner, {
    serverId: server,
    repoUrl: "https://github.com/sam/app.git",
    runtime: "node" as const,
    port: 6000 + n,
    name: `Deploy ${n}`,
    slug: `deploy-${n}`,
  });
  return p.id;
}

async function addDeploys(projectId: string, rows: { at: string; state: "ready" | "error" }[]) {
  const db = await getDb();
  for (const r of rows) {
    await db.insert(schema.deployments).values({
      id: randomUUID(),
      projectId,
      env: "production",
      source: "manual",
      branch: "main",
      port: 6000,
      releaseId: randomUUID(),
      state: r.state,
      createdAt: new Date(r.at),
    });
  }
}

beforeAll(async () => {
  ctx = await useFreshDb();
  userId = (await upsertUser({ id: "dp1", name: "Deploy", email: null, slackId: null })).id;
  otherId = (await upsertUser({ id: "dp2", name: "Other", email: null, slackId: null })).id;
  serverId = (await createServer(userId, "deploy-r")).id;
  otherServerId = (await createServer(otherId, "deploy-o")).id;
});
afterAll(async () => {
  await ctx.cleanup();
});

describe("deployActivity", () => {
  it("returns every day in range with zeros, and no busiest day when there are none", async () => {
    const result = await deployActivity(userId, { days: 3 }, now);
    expect(result.days).toBe(3);
    expect(result.daily).toEqual([
      { day: "2026-11-02", total: 0, failed: 0 },
      { day: "2026-11-03", total: 0, failed: 0 },
      { day: "2026-11-04", total: 0, failed: 0 },
    ]);
    expect(result.total).toBe(0);
    expect(result.busiestDay).toBeNull();
  });

  it("counts deployments and failures per UTC day within the range", async () => {
    const p = await newProject(userId, serverId);
    await addDeploys(p, [
      { at: "2026-10-31T23:00:00Z", state: "ready" }, // before the range
      { at: "2026-11-02T10:00:00Z", state: "ready" },
      { at: "2026-11-03T09:00:00Z", state: "error" },
      { at: "2026-11-03T23:00:00Z", state: "error" },
      { at: "2026-11-03T23:59:59Z", state: "ready" },
      { at: "2026-11-04T11:00:00Z", state: "ready" },
    ]);
    const result = await deployActivity(userId, { projectId: p, days: 3 }, now);
    expect(result.daily).toEqual([
      { day: "2026-11-02", total: 1, failed: 0 },
      { day: "2026-11-03", total: 3, failed: 2 },
      { day: "2026-11-04", total: 1, failed: 0 },
    ]);
    expect(result.total).toBe(5);
    expect(result.busiestDay).toEqual({ day: "2026-11-03", total: 3, failed: 2 });
  });

  it("covers all of the user's projects, or only one when a project id is given", async () => {
    const a = await newProject(userId, serverId);
    const b = await newProject(userId, serverId);
    await addDeploys(a, [{ at: "2026-11-04T01:00:00Z", state: "ready" }]);
    await addDeploys(b, [{ at: "2026-11-04T02:00:00Z", state: "error" }]);
    const all = await deployActivity(userId, { days: 1 }, now);
    expect(all.total).toBeGreaterThanOrEqual(2);
    const onlyA = await deployActivity(userId, { projectId: a, days: 1 }, now);
    expect(onlyA.total).toBe(1);
    expect(onlyA.daily[0].failed).toBe(0);
  });

  it("never counts another user's deployments", async () => {
    const mineBefore = await deployActivity(userId, { days: 1 }, now);
    const theirs = await newProject(otherId, otherServerId);
    await addDeploys(theirs, [{ at: "2026-11-04T03:00:00Z", state: "error" }]);
    const mine = await deployActivity(userId, { days: 1 }, now);
    expect(mine.total).toBe(mineBefore.total);
    expect(mine.daily[0].failed).toBe(mineBefore.daily[0].failed);
    expect((await deployActivity(otherId, { days: 1 }, now)).total).toBeGreaterThanOrEqual(1);
  });

  it("refuses another user's project with a 404", async () => {
    const theirs = await newProject(otherId, otherServerId);
    await expect(deployActivity(userId, { projectId: theirs, days: 3 }, now)).rejects.toMatchObject({ status: 404 });
  });
});
