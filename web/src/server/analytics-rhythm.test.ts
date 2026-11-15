import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hourlyViews } from "@/server/analytics-rhythm";
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
const HOUR = 3_600_000;

async function newProject(owner: string, server: string) {
  n += 1;
  const p = await createProject(owner, {
    serverId: server,
    repoUrl: "https://github.com/sam/app.git",
    runtime: "node" as const,
    port: 5000 + n,
    name: `Rhythm ${n}`,
    slug: `rhythm-${n}`,
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
  userId = (await upsertUser({ id: "rh1", name: "Rhythm", email: null, slackId: null })).id;
  otherId = (await upsertUser({ id: "rh2", name: "Other", email: null, slackId: null })).id;
  serverId = (await createServer(userId, "rhythm-r")).id;
  otherServerId = (await createServer(otherId, "rhythm-o")).id;
});
afterAll(async () => {
  await ctx.cleanup();
});

describe("hourlyViews", () => {
  it("returns one entry per hour, oldest first, ending with the hour of now", async () => {
    const p = await newProject(userId, serverId);
    const result = await hourlyViews(userId, p, 2, now);
    expect(result.days).toBe(2);
    expect(result.hours).toHaveLength(48);
    expect(result.hours.every((h) => h.views === 0)).toBe(true);
    expect(result.hours[47].at).toBe(Date.parse("2026-11-04T12:00:00Z"));
    expect(result.hours[0].at).toBe(Date.parse("2026-11-02T13:00:00Z"));
    for (let i = 1; i < result.hours.length; i++) expect(result.hours[i].at - result.hours[i - 1].at).toBe(HOUR);
  });

  it("counts views per clock hour and respects the range boundaries", async () => {
    const p = await newProject(userId, serverId);
    await addViews(p, [
      "2026-11-03T12:59:59Z", // before the range (the window starts at 13:00 the day before)
      "2026-11-03T13:00:00Z", // first hour of the range
      "2026-11-03T13:30:00Z",
      "2026-11-04T11:15:00Z",
      "2026-11-04T12:00:00Z", // the hour containing now, at now exactly
      "2026-11-04T12:30:00Z", // after now
      "2026-11-04T13:00:00Z", // after now
    ]);
    const { hours } = await hourlyViews(userId, p, 1, now);
    expect(hours).toHaveLength(24);
    expect(hours[0]).toEqual({ at: Date.parse("2026-11-03T13:00:00Z"), views: 2 });
    expect(hours[22]).toEqual({ at: Date.parse("2026-11-04T11:00:00Z"), views: 1 });
    expect(hours[23]).toEqual({ at: Date.parse("2026-11-04T12:00:00Z"), views: 1 });
    expect(hours.reduce((sum, h) => sum + h.views, 0)).toBe(4);
  });

  it("counts only the given project's views", async () => {
    const a = await newProject(userId, serverId);
    const b = await newProject(userId, serverId);
    await addViews(a, ["2026-11-04T10:00:00Z"]);
    await addViews(b, ["2026-11-04T10:00:00Z", "2026-11-04T10:10:00Z"]);
    const { hours } = await hourlyViews(userId, a, 1, now);
    expect(hours.reduce((sum, h) => sum + h.views, 0)).toBe(1);
  });

  it("refuses another user's project with a 404", async () => {
    const theirs = await newProject(otherId, otherServerId);
    await expect(hourlyViews(userId, theirs, 30, now)).rejects.toMatchObject({ status: 404 });
  });
});
