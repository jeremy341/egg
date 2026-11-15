import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { GET as scriptRoute } from "@/app/api/analytics/script/route";
import { POST as collectRoute } from "@/app/api/collect/[key]/route";
import { enableAnalytics, snippet } from "@/server/analytics";
import { featuresForUser, updateFeatures } from "@/server/analytics-config";
import { upsertUser } from "@/server/auth/session";
import { getDb, schema } from "@/server/db";
import { createProject } from "@/server/projects";
import { createServer } from "@/server/servers";
import { useFreshDb } from "@/server/test/db";

let ctx: Awaited<ReturnType<typeof useFreshDb>>;
let userId: string;
let otherId: string;
let projectId: string;
let key: string;

beforeAll(async () => {
  ctx = await useFreshDb();
  userId = (await upsertUser({ id: "u1", name: "Sam", email: null, slackId: null })).id;
  otherId = (await upsertUser({ id: "u2", name: "Alex", email: null, slackId: null })).id;
  const serverId = (await createServer(userId, "sam-r")).id;
  projectId = (
    await createProject(userId, {
      serverId,
      repoUrl: "https://github.com/sam/app.git",
      runtime: "node" as const,
      port: 3000,
      name: "App",
      slug: "app",
    })
  ).id;
  key = (await enableAnalytics(userId, projectId)).key;
});
afterAll(async () => {
  await ctx.cleanup();
});

const getScript = async (k: string | null) => {
  const res = await scriptRoute(new NextRequest(`http://localhost:3000/api/analytics/script${k ? `?key=${k}` : ""}`));
  return res.text();
};
const collect = (body: unknown, headers: Record<string, string> = {}) =>
  collectRoute(
    new NextRequest(`http://localhost:3000/api/collect/${key}`, {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "user-agent": "Mozilla/5.0 Firefox", "x-forwarded-for": "9.9.9.9", ...headers },
    }),
    { params: Promise.resolve({ key }) }
  );
const events = async () => (await getDb()).select().from(schema.analyticsEvents);
const views = async () => (await getDb()).select().from(schema.pageviews);

describe("analytics settings", () => {
  it("are all off for a new project", async () => {
    expect(await featuresForUser(userId, projectId)).toEqual({ clicks: false, time: false, funnel: false, steps: [] });
  });

  it("change one switch at a time and keep the others", async () => {
    await updateFeatures(userId, projectId, { clicks: true });
    await updateFeatures(userId, projectId, { time: true });
    expect(await featuresForUser(userId, projectId)).toMatchObject({ clicks: true, time: true, funnel: false });
    await updateFeatures(userId, projectId, { clicks: false, time: false });
    expect(await featuresForUser(userId, projectId)).toMatchObject({ clicks: false, time: false });
  });

  it("belong to the project's owner only", async () => {
    await expect(updateFeatures(otherId, projectId, { clicks: true })).rejects.toThrow();
    await expect(featuresForUser(otherId, projectId)).rejects.toThrow();
  });

  it("put the key in the snippet's address so the script can match the project", () => {
    expect(snippet("nda_abc")).toContain("/api/analytics/script?key=nda_abc");
  });
});

describe("the script route", () => {
  it("serves the plain script when every switch is off, for known, unknown and missing keys", async () => {
    const plain = await getScript(key);
    expect(plain).not.toContain('"click"');
    expect(plain).not.toContain("visibilitychange");
    expect(await getScript("nda_unknown")).toBe(plain);
    expect(await getScript(null)).toBe(plain);
  });

  it("adds only the click lines when clicks are on", async () => {
    await updateFeatures(userId, projectId, { clicks: true });
    const s = await getScript(key);
    expect(s).toContain('"click"');
    expect(s).not.toContain("visibilitychange");
    await updateFeatures(userId, projectId, { clicks: false });
  });
});

describe("the collect route", () => {
  it("records a page view for an ordinary request", async () => {
    expect((await collect({ p: "/" })).status).toBe(204);
    expect(await views()).toHaveLength(1);
  });

  it.each([
    ["Do Not Track", { dnt: "1" }],
    ["Global Privacy Control", { "sec-gpc": "1" }],
  ])("records nothing when %s is set, and answers the same", async (_n, headers) => {
    await updateFeatures(userId, projectId, { clicks: true });
    const before = { v: (await views()).length, e: (await events()).length };
    expect((await collect({ p: "/pricing" }, { "x-forwarded-for": "8.8.8.8", ...headers })).status).toBe(204);
    expect((await collect({ e: "click", l: "Buy" }, { "x-forwarded-for": "8.8.8.8", ...headers })).status).toBe(204);
    expect({ v: (await views()).length, e: (await events()).length }).toEqual(before);
  });

  it("does not record a click once the switch is turned off again", async () => {
    await updateFeatures(userId, projectId, { clicks: false });
    const before = (await events()).length;
    await collect({ e: "click", l: "Buy" }, { "x-forwarded-for": "5.5.5.5" });
    expect((await events()).length).toBe(before);
  });
});
