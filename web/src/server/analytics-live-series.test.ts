import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { liveSeries } from "@/server/analytics-live-series";
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
    port: 7000 + n,
    name: `Live ${n}`,
    slug: `live-${n}`,
  });
  return p.id;
}

async function addViews(projectId: string, ats: string[]) {
  const db = await getDb();
  for (const [i, at] of ats.entries()) {
    await db.insert(schema.pageviews).values({ projectId, at: new Date(at), path: "/", visitor: `v${i}` });
  }
}

beforeAll(async () => {
  ctx = await useFreshDb();
  userId = (await upsertUser({ id: "lv1", name: "Live", email: null, slackId: null })).id;
  otherId = (await upsertUser({ id: "lv2", name: "Other", email: null, slackId: null })).id;
  serverId = (await createServer(userId, "live-r")).id;
  otherServerId = (await createServer(otherId, "live-o")).id;
});
afterAll(async () => {
  await ctx.cleanup();
});

describe("liveSeries", () => {
  it("returns one zero point per minute, oldest first, ending with the minute of now", async () => {
    const p = await newProject(userId, serverId);
    const result = await liveSeries(userId, p, 3, now);
    expect(result.minutes).toBe(3);
    expect(result.points).toEqual([
      { at: Date.parse("2026-11-04T11:58:00Z"), views: 0 },
      { at: Date.parse("2026-11-04T11:59:00Z"), views: 0 },
      { at: Date.parse("2026-11-04T12:00:00Z"), views: 0 },
    ]);
  });

  it("counts views per minute and respects the range boundaries", async () => {
    const p = await newProject(userId, serverId);
    await addViews(p, [
      "2026-11-04T11:57:59Z", // before the range
      "2026-11-04T11:58:00Z", // first minute
      "2026-11-04T11:58:30Z",
      "2026-11-04T11:59:10Z",
      "2026-11-04T12:00:00Z", // the minute containing now
      "2026-11-04T12:00:30Z", // after now
    ]);
    const { points } = await liveSeries(userId, p, 3, now);
    expect(points.map((x) => x.views)).toEqual([2, 1, 1]);
    expect(points.reduce((sum, x) => sum + x.views, 0)).toBe(4);
  });

  it("clamps the window to 1 to 60 minutes", async () => {
    const p = await newProject(userId, serverId);
    expect((await liveSeries(userId, p, 500, now)).points).toHaveLength(60);
    const low = await liveSeries(userId, p, 0, now);
    expect(low.points).toHaveLength(1);
    expect(low.minutes).toBe(1);
  });

  it("counts only the given project's views", async () => {
    const a = await newProject(userId, serverId);
    const b = await newProject(userId, serverId);
    await addViews(a, ["2026-11-04T11:59:00Z"]);
    await addViews(b, ["2026-11-04T11:59:00Z", "2026-11-04T11:59:05Z"]);
    const { points } = await liveSeries(userId, a, 2, now);
    expect(points.reduce((sum, x) => sum + x.views, 0)).toBe(1);
  });

  it("refuses another user's project with a 404", async () => {
    const theirs = await newProject(otherId, otherServerId);
    await expect(liveSeries(userId, theirs, 30, now)).rejects.toMatchObject({ status: 404 });
  });
});
