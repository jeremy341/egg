import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { countFunnel, funnelSummary, summariseFunnel, type FunnelEvent } from "@/server/analytics-funnel";
import { enableAnalytics, recordPageview } from "@/server/analytics";
import { parseSteps, updateFeatures, type FunnelStep } from "@/server/analytics-config";
import { recordHit } from "@/server/analytics-events";
import { upsertUser } from "@/server/auth/session";
import { getDb, schema } from "@/server/db";
import { createProject } from "@/server/projects";
import { createServer } from "@/server/servers";
import { useFreshDb } from "@/server/test/db";

const steps: FunnelStep[] = [
  { kind: "page", value: "/pricing" },
  { kind: "track", value: "signup" },
  { kind: "page", value: "/welcome" },
];
const page = (visitor: string, value: string, at: number): FunnelEvent => ({ visitor, kind: "page", value, at });
const track = (visitor: string, value: string, at: number): FunnelEvent => ({ visitor, kind: "track", value, at });

describe("countFunnel", () => {
  it("counts each visitor once at every step they reached, in order", () => {
    const events = [
      page("a", "/pricing", 1),
      track("a", "signup", 2),
      page("a", "/welcome", 3),
      page("b", "/pricing", 1),
      track("b", "signup", 2),
      page("c", "/pricing", 1),
    ];
    expect(countFunnel(steps, events)).toEqual([3, 2, 1]);
  });

  it("counts a visitor who repeats a step once", () => {
    const events = [page("a", "/pricing", 1), page("a", "/pricing", 2), page("a", "/pricing", 3)];
    expect(countFunnel(steps, events)).toEqual([1, 0, 0]);
  });

  it("does not count a later step for someone who skipped an earlier one", () => {
    expect(countFunnel(steps, [page("a", "/welcome", 1), track("a", "signup", 2)])).toEqual([0, 0, 0]);
  });

  it("does not count steps done in the wrong order", () => {
    expect(countFunnel(steps, [track("a", "signup", 1), page("a", "/pricing", 2)])).toEqual([1, 0, 0]);
  });

  it("lets a visitor go on after wandering elsewhere in between", () => {
    const events = [page("a", "/pricing", 1), page("a", "/about", 2), track("a", "signup", 3), page("a", "/welcome", 9)];
    expect(countFunnel(steps, events.filter((e) => e.value !== "/about"))).toEqual([1, 1, 1]);
  });

  it("works whatever order the events arrive in", () => {
    const events = [page("a", "/welcome", 3), track("a", "signup", 2), page("a", "/pricing", 1)];
    expect(countFunnel(steps, events)).toEqual([1, 1, 1]);
  });

  it("keeps two steps of the same kind and value apart by position", () => {
    const twice: FunnelStep[] = [
      { kind: "page", value: "/a" },
      { kind: "page", value: "/b" },
      { kind: "page", value: "/a" },
    ];
    expect(countFunnel(twice, [page("v", "/a", 1), page("v", "/b", 2)])).toEqual([1, 1, 0]);
    expect(countFunnel(twice, [page("v", "/a", 1), page("v", "/b", 2), page("v", "/a", 3)])).toEqual([1, 1, 1]);
  });
});

describe("summariseFunnel", () => {
  it("shows counts and drop-off percentages when the step before has enough visitors", () => {
    const s = summariseFunnel(steps, [200, 100, 25]);
    expect(s.enough).toBe(true);
    expect(s.steps.map((x) => x.visitors)).toEqual([200, 100, 25]);
    expect(s.steps[0]).toMatchObject({ dropped: null, dropPercent: null });
    expect(s.steps[1]).toMatchObject({ dropped: 100, dropPercent: 50 });
    expect(s.steps[2]).toMatchObject({ dropped: 75, dropPercent: 75 });
    expect(s.conversionPercent).toBe(13);
  });

  it("shows no percentage under the minimum sample, only counts", () => {
    const s = summariseFunnel(steps, [49, 20, 5]);
    expect(s.enough).toBe(false);
    expect(s.steps.map((x) => x.dropPercent)).toEqual([null, null, null]);
    expect(s.steps[1].dropped).toBe(29);
    expect(s.conversionPercent).toBeNull();
  });

  it("holds back a drop-off whose step before has fewer visitors than the minimum", () => {
    const s = summariseFunnel(steps, [500, 40, 10]);
    expect(s.steps[1].dropPercent).toBe(92);
    expect(s.steps[2].dropPercent).toBeNull();
    expect(s.steps[2].dropped).toBe(30);
  });

  it("never rounds a drop-off to 0 or 100 while some visitors stayed or left", () => {
    const s = summariseFunnel(steps, [10_000, 9_999, 1]);
    expect(s.steps[1].dropPercent).toBe(1);
    expect(s.steps[2].dropPercent).toBe(99);
  });

  it("reports an empty funnel as having no visitors", () => {
    const s = summariseFunnel(steps, [0, 0, 0]);
    expect(s).toMatchObject({ started: 0, completed: 0, enough: false });
  });
});

describe("funnel collection and summary", () => {
  let ctx: Awaited<ReturnType<typeof useFreshDb>>;
  let userId: string;
  let projectId: string;
  let key: string;
  const day = new Date("2026-11-04T12:00:00Z");
  const at = (s: number) => new Date(day.getTime() + s * 1000);
  const person = (n: number) => ({ ip: `10.0.0.${n}`, ua: "Mozilla/5.0 Firefox" });

  beforeAll(async () => {
    ctx = await useFreshDb();
    userId = (await upsertUser({ id: "u1", name: "Sam", email: null, slackId: null })).id;
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

  it("needs at least two steps to turn on, and checks each step", async () => {
    await expect(updateFeatures(userId, projectId, { funnel: true })).rejects.toThrow(/at least 2 steps/);
    await expect(updateFeatures(userId, projectId, { steps: [{ kind: "page", value: "pricing" }] })).rejects.toThrow(/starts with/);
    await expect(updateFeatures(userId, projectId, { steps: [{ kind: "track", value: '"><script>' }] })).rejects.toThrow(/letters/);
    await expect(
      updateFeatures(userId, projectId, { steps: Array.from({ length: 7 }, (_, i) => ({ kind: "page" as const, value: `/p${i}` })) })
    ).rejects.toThrow(/at most 6/);
  });

  it("ignores a goal while the funnel is off, or for a name that is not a step", async () => {
    expect(await recordHit(key, { e: "goal", n: "signup" }, person(1), day)).toBe(false);
    await updateFeatures(userId, projectId, {
      funnel: true,
      steps: [
        { kind: "page", value: "/pricing?utm=x" },
        { kind: "track", value: "signup" },
        { kind: "page", value: "/welcome/" },
      ],
    });
    expect(await recordHit(key, { e: "goal", n: "newsletter" }, person(1), day)).toBe(false);
    expect(await (await getDb()).select().from(schema.analyticsEvents)).toEqual([]);
  });

  it("stores the page steps as clean paths", async () => {
    const row = (await (await getDb()).select().from(schema.analyticsSettings))[0];
    const stored = parseSteps(row.funnelSteps);
    expect(stored.map((s) => s.value)).toEqual(["/pricing", "signup", "/welcome"]);
  });

  it("records a goal with the daily visitor hash, and the same hash a page view gets", async () => {
    expect(await recordHit(key, { e: "goal", n: "signup" }, person(1), at(10))).toBe(true);
    const goal = (await (await getDb()).select().from(schema.analyticsEvents))[0];
    const view = await recordPageview(key, { p: "/pricing" }, person(1), at(0));
    expect(view).toBe(true);
    const pv = (await (await getDb()).select().from(schema.pageviews))[0];
    expect(goal).toMatchObject({ kind: "goal", label: "signup", day: "2026-11-04" });
    expect(goal.visitor).toBe(pv.visitor);
    expect(goal.visitor).toMatch(/^[0-9a-f]{16}$/);
  });

  it("counts visitors per step from page views and goals, in order, once per day", async () => {
    // Visitor 2 goes all the way. Visitor 3 clicks signup without seeing pricing first. Visitor 4 stops at pricing.
    await recordPageview(key, { p: "/pricing" }, person(2), at(100));
    await recordPageview(key, { p: "/pricing" }, person(2), at(110));
    await recordHit(key, { e: "goal", n: "signup" }, person(2), at(120));
    await recordPageview(key, { p: "/welcome" }, person(2), at(130));
    await recordHit(key, { e: "goal", n: "signup" }, person(3), at(140));
    await recordPageview(key, { p: "/welcome" }, person(3), at(150));
    await recordPageview(key, { p: "/pricing" }, person(4), at(160));
    // The same visitor the next day is a new visitor, as page view counts already are.
    await recordPageview(key, { p: "/pricing" }, person(4), new Date(at(160).getTime() + 86_400_000));

    const s = await funnelSummary(userId, projectId, 30, new Date("2026-11-06T09:00:00Z"));
    // Visitor 1 reached pricing and signup; 2 reached all three; 3 reached none in order; 4 reached pricing on two days.
    expect(s.steps.map((x) => x.visitors)).toEqual([4, 2, 1]);
    expect(s.enough).toBe(false);
    expect(s.steps.map((x) => x.dropPercent)).toEqual([null, null, null]);
  });

  it("does not show a funnel to another user", async () => {
    const other = (await upsertUser({ id: "u2", name: "Alex", email: null, slackId: null })).id;
    await expect(funnelSummary(other, projectId)).rejects.toThrow();
  });

  it("returns no steps, and says so, while the funnel is off", async () => {
    await updateFeatures(userId, projectId, { funnel: false });
    const s = await funnelSummary(userId, projectId, 30, new Date("2026-11-06T09:00:00Z"));
    expect(s.steps).toEqual([]);
  });
});
