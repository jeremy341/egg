import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { LIVE_KEEP_MS, RETENTION_PERIOD_MS, campaignsSummary, enableAnalytics, prunePageviews, retentionCode } from "@/server/analytics";
import { featuresForUser, getAnalyticsDefaults, updateFeatures } from "@/server/analytics-config";
import { eventsSummary, recordHit } from "@/server/analytics-events";
import { MIN_COHORT, liveSummary, retentionSummary, returnRate } from "@/server/analytics-retention";
import { errorsSummary, speedSummary, summariseVitals, type VitalRow } from "@/server/analytics-speed";
import { upsertUser } from "@/server/auth/session";
import { getDb, schema } from "@/server/db";
import { updatePreferences } from "@/server/preferences";
import { createProject } from "@/server/projects";
import { createServer } from "@/server/servers";
import { useFreshDb } from "@/server/test/db";

let ctx: Awaited<ReturnType<typeof useFreshDb>>;
let userId: string;
let serverId: string;
let n = 0;
const now = new Date("2026-11-04T12:00:00Z");
const ua = "Mozilla/5.0 Firefox";
let ipCounter = 0;
/** A fresh address each time, so the per-address limits never get in the way. */
const who = () => ({ ip: `10.0.${Math.floor(++ipCounter / 250)}.${ipCounter % 250}`, ua });

async function newProject() {
  n += 1;
  const p = await createProject(userId, {
    serverId,
    repoUrl: "https://github.com/sam/app.git",
    runtime: "node" as const,
    port: 3000 + n,
    name: `App ${n}`,
    slug: `app-${n}`,
  });
  const { key } = await enableAnalytics(userId, p.id);
  return { id: p.id, key };
}
const views = async (projectId: string) =>
  (await getDb()).select().from(schema.pageviews).where(eq(schema.pageviews.projectId, projectId));
const eventRows = async (projectId: string, kind: string) =>
  (await getDb())
    .select()
    .from(schema.analyticsEvents)
    .where(and(eq(schema.analyticsEvents.projectId, projectId), eq(schema.analyticsEvents.kind, kind)));

beforeAll(async () => {
  ctx = await useFreshDb();
  userId = (await upsertUser({ id: "u1", name: "Sam", email: null, slackId: null })).id;
  serverId = (await createServer(userId, "sam-r")).id;
});
afterAll(async () => {
  await ctx.cleanup();
});

describe("every feature starts off", () => {
  it("for a new project with no account defaults", async () => {
    const p = await newProject();
    expect(await featuresForUser(userId, p.id)).toEqual({
      clicks: false,
      time: false,
      funnel: false,
      steps: [],
      referrers: false,
      vitals: false,
      events: false,
      live: false,
      retention: false,
    });
    expect(await (await getDb()).select().from(schema.analyticsSettings).where(eq(schema.analyticsSettings.projectId, p.id))).toEqual([]);
  });

  it("drops what each feature would record while its switch is off, whatever the script sends", async () => {
    const p = await newProject();
    const body = { p: "/a", r: "https://news.example.com/x", us: "s", um: "m", uc: "c", i: "abcdef0123456789abcdef01" };
    expect(await recordHit(p.key, body, who(), now)).toBe(true);
    const [row] = await views(p.id);
    expect(row).toMatchObject({ path: "/a", referrer: null, utmSource: null, utmMedium: null, utmCampaign: null, vid: null });
    expect(await recordHit(p.key, { e: "track", n: "buy", v: "pro" }, who(), now)).toBe(false);
    expect(await recordHit(p.key, { e: "vitals", p: "/", lcp: 1000 }, who(), now)).toBe(false);
    expect(await recordHit(p.key, { e: "err", m: "boom" }, who(), now)).toBe(false);
    expect(await recordHit(p.key, { e: "ping", i: "abcdef0123456789abcdef01" }, who(), now)).toBe(false);
    const db = await getDb();
    expect(await db.select().from(schema.analyticsEvents).where(eq(schema.analyticsEvents.projectId, p.id))).toEqual([]);
    expect(await db.select().from(schema.analyticsVitals).where(eq(schema.analyticsVitals.projectId, p.id))).toEqual([]);
    expect(await db.select().from(schema.analyticsErrors).where(eq(schema.analyticsErrors.projectId, p.id))).toEqual([]);
    expect(await db.select().from(schema.analyticsLive).where(eq(schema.analyticsLive.projectId, p.id))).toEqual([]);
  });
});

describe("account defaults", () => {
  it("are empty (everything off) until the person chooses", async () => {
    expect(await getAnalyticsDefaults(userId)).toEqual({});
  });

  it("start a project's features when analytics is first turned on, and leave existing projects alone", async () => {
    const before = await newProject();
    await updatePreferences(userId, { analyticsDefaults: { clicks: true, vitals: true, retention: true } });
    expect(await getAnalyticsDefaults(userId)).toEqual({ clicks: true, vitals: true, retention: true });
    expect(await featuresForUser(userId, before.id)).toMatchObject({ clicks: false, vitals: false, retention: false });

    const after = await newProject();
    expect(await featuresForUser(userId, after.id)).toMatchObject({
      clicks: true,
      vitals: true,
      retention: true,
      time: false,
      referrers: false,
      events: false,
      live: false,
    });
  });

  it("do not overwrite the settings a project already has when analytics is turned off and on", async () => {
    const p = await newProject();
    await updateFeatures(userId, p.id, { clicks: false, vitals: false, retention: false });
    const { disableAnalytics } = await import("@/server/analytics");
    await disableAnalytics(userId, p.id);
    await enableAnalytics(userId, p.id);
    expect(await featuresForUser(userId, p.id)).toMatchObject({ clicks: false, vitals: false, retention: false });
  });

  it("let a funnel start on without steps, and still allow other changes", async () => {
    await updatePreferences(userId, { analyticsDefaults: { funnel: true } });
    const p = await newProject();
    expect((await featuresForUser(userId, p.id)).funnel).toBe(false);
    await expect(updateFeatures(userId, p.id, { clicks: true })).resolves.toMatchObject({ clicks: true });
    await expect(updateFeatures(userId, p.id, { funnel: true })).rejects.toThrow(/at least 2 steps/);
    await updatePreferences(userId, { analyticsDefaults: { clicks: false, vitals: false, retention: false, funnel: false } });
    expect(await getAnalyticsDefaults(userId)).toEqual({});
  });

  it("reject a switch that is not one of the known ones, and a value that is not true or false", async () => {
    await expect(updatePreferences(userId, { analyticsDefaults: { telepathy: true } })).rejects.toThrow();
    await expect(updatePreferences(userId, { analyticsDefaults: { clicks: "yes" } })).rejects.toThrow();
    expect(await getAnalyticsDefaults(userId)).toEqual({});
  });
});

describe("referrers and campaigns", () => {
  it("store the referring host and the cut, whitelisted campaign values when the switch is on", async () => {
    const p = await newProject();
    await updateFeatures(userId, p.id, { referrers: true });
    const body = {
      p: "/pricing?x=1",
      r: "www.news.example.com",
      us: "  newsletter ",
      um: "email",
      uc: "c".repeat(200),
      ut: "term-is-not-stored",
    };
    expect(await recordHit(p.key, body, who(), now)).toBe(true);
    const [row] = await views(p.id);
    expect(row).toMatchObject({ path: "/pricing", referrer: "www.news.example.com", utmSource: "newsletter", utmMedium: "email" });
    expect(row.utmCampaign).toHaveLength(80);
    expect(JSON.stringify(row)).not.toContain("term-is-not-stored");
  });

  it("store nulls for a page view that has none", async () => {
    const p = await newProject();
    await updateFeatures(userId, p.id, { referrers: true });
    await recordHit(p.key, { p: "/" }, who(), now);
    expect((await views(p.id))[0]).toMatchObject({ referrer: null, utmSource: null, utmMedium: null, utmCampaign: null, vid: null });
  });

  it("add up by campaign for the owner, with source and medium", async () => {
    const p = await newProject();
    await updateFeatures(userId, p.id, { referrers: true });
    for (let i = 0; i < 3; i++) await recordHit(p.key, { p: "/", uc: "spring", us: "news", um: "email" }, who(), now);
    await recordHit(p.key, { p: "/", uc: "launch", us: "x", um: "social" }, who(), now);
    await recordHit(p.key, { p: "/" }, who(), now);
    const s = await campaignsSummary(userId, p.id, 30, new Date("2026-11-05T00:00:00Z"));
    expect(s.rows).toEqual([
      { campaign: "spring", source: "news", medium: "email", views: 3 },
      { campaign: "launch", source: "x", medium: "social", views: 1 },
    ]);
  });
});

describe("retention code", () => {
  const base = { projectId: "p1", browserId: "abcdef0123456789abcdef01", at: now };

  it("is an HMAC: 32 hex characters, the same for the same input, and never the raw id", () => {
    const a = retentionCode(base);
    expect(a).toMatch(/^[a-f0-9]{32}$/);
    expect(retentionCode({ ...base })).toBe(a);
    expect(a).not.toContain(base.browserId);
  });

  it("differs by project and by browser id", () => {
    const a = retentionCode(base);
    expect(retentionCode({ ...base, projectId: "p2" })).not.toBe(a);
    expect(retentionCode({ ...base, browserId: "abcdef0123456789abcdef02" })).not.toBe(a);
  });

  it("stays the same inside a 90 day period and changes in the next one", () => {
    const start = Math.floor(now.getTime() / RETENTION_PERIOD_MS) * RETENTION_PERIOD_MS;
    const a = retentionCode({ ...base, at: new Date(start) });
    expect(retentionCode({ ...base, at: new Date(start + RETENTION_PERIOD_MS - 1) })).toBe(a);
    expect(retentionCode({ ...base, at: new Date(start + RETENTION_PERIOD_MS) })).not.toBe(a);
  });

  it("is stored for a page view with the switch on, and the raw id is stored nowhere", async () => {
    const p = await newProject();
    await updateFeatures(userId, p.id, { retention: true });
    const id = "Abcdef0123456789abcdef0123";
    await recordHit(p.key, { p: "/", i: id }, who(), now);
    await recordHit(p.key, { p: "/", i: "short" }, who(), now);
    await recordHit(p.key, { p: "/", i: "has spaces and symbols!!!!" }, who(), now);
    const rows = await views(p.id);
    expect(rows[0].vid).toBe(retentionCode({ projectId: p.id, browserId: id, at: now }));
    expect(rows[1].vid).toBeNull();
    expect(rows[2].vid).toBeNull();
    expect(JSON.stringify(rows)).not.toContain(id);
  });

  it("is deleted when the switch is turned off", async () => {
    const p = await newProject();
    await updateFeatures(userId, p.id, { retention: true, live: true });
    await recordHit(p.key, { p: "/", i: "abcdef0123456789abcdef01" }, who(), now);
    await recordHit(p.key, { e: "ping", i: "abcdef0123456789abcdef01" }, who(), now);
    expect((await views(p.id))[0].vid).not.toBeNull();
    await updateFeatures(userId, p.id, { retention: false });
    expect((await views(p.id))[0].vid).toBeNull();
    const live = await (await getDb()).select().from(schema.analyticsLive).where(eq(schema.analyticsLive.projectId, p.id));
    expect(live).toEqual([]);
  });
});

describe("returning visitors", () => {
  const DAY = 86_400_000;
  const t = now.getTime();
  /** `count` visitors first seen `daysAgo` days ago, of whom `back` came again `later` days after. */
  const cohort = (prefix: string, count: number, daysAgo: number, back: number, later: number) =>
    Array.from({ length: count }, (_, i) => {
      const first = t - daysAgo * DAY;
      return [
        { vid: `${prefix}${i}`, at: first },
        ...(i < back ? [{ vid: `${prefix}${i}`, at: first + later * DAY }] : []),
      ];
    }).flat();

  it("counts the visitors first seen 7 to 14 days ago who came back within 7 days", () => {
    const r = returnRate(cohort("a", 40, 10, 10, 3), t, 14, 7, 7);
    expect(r).toEqual({ cohort: 40, returned: 10, percent: 25, enough: true });
  });

  it("does not count a return after the horizon, on the same day, or from before the cohort window", () => {
    const visits = [
      ...cohort("late", 20, 12, 20, 8),
      ...cohort("same", 20, 12, 20, 0.2),
      // First seen long ago, so not new in the window.
      { vid: "old", at: t - 60 * DAY },
      { vid: "old", at: t - 10 * DAY },
    ];
    const r = returnRate(visits, t, 14, 7, 7);
    expect(r.cohort).toBe(40);
    expect(r.returned).toBe(0);
  });

  it("counts a return on the next day however short the gap", () => {
    const first = Math.floor((t - 10 * DAY) / DAY) * DAY + DAY - 1000;
    const visits = Array.from({ length: 20 }, (_, i) => [
      { vid: `n${i}`, at: first },
      { vid: `n${i}`, at: first + 2000 },
    ]).flat();
    expect(returnRate(visits, t, 14, 7, 7).returned).toBe(20);
  });

  it("uses the 30 day window for the monthly figure", () => {
    const r = returnRate(cohort("m", 50, 33, 20, 20), t, 37, 30, 30);
    expect(r).toEqual({ cohort: 50, returned: 20, percent: 40, enough: true });
  });

  it("says there is not enough data under 20 visitors, and gives a percentage at 20", () => {
    expect(MIN_COHORT).toBe(20);
    const small = returnRate(cohort("s", 19, 10, 19, 2), t, 14, 7, 7);
    expect(small).toEqual({ cohort: 19, returned: 19, percent: null, enough: false });
    const ok = returnRate(cohort("s", 20, 10, 19, 2), t, 14, 7, 7);
    expect(ok).toMatchObject({ cohort: 20, returned: 19, percent: 95, enough: true });
  });

  it("never rounds a share up to 100 or down to 0 while some but not all came back", () => {
    expect(returnRate(cohort("x", 1000, 10, 999, 1), t, 14, 7, 7).percent).toBe(99);
    expect(returnRate(cohort("y", 1000, 10, 1, 1), t, 14, 7, 7).percent).toBe(1);
  });

  it("reads from the stored page views for the owner", async () => {
    const p = await newProject();
    const db = await getDb();
    const rows = [
      ...cohort("v", 30, 10, 12, 2),
      // Seen this week; first-time visitors, so they are in no cohort yet.
      ...cohort("w", 5, 2, 0, 0),
    ].map((v) => ({
      projectId: p.id,
      at: new Date(v.at),
      path: "/",
      visitor: "daily",
      vid: v.vid,
    }));
    await db.insert(schema.pageviews).values(rows);
    // A visitor with no code is not counted.
    await db.insert(schema.pageviews).values({ projectId: p.id, at: new Date(t - 1000), path: "/", visitor: "daily" });
    const s = await retentionSummary(userId, p.id, now);
    expect(s.visitorsThisWeek).toBe(5);
    expect(s.week).toEqual({ cohort: 30, returned: 12, percent: 40, enough: true });
    expect(s.month.enough).toBe(false);
  });

  it("belongs to the project's owner only", async () => {
    const p = await newProject();
    const other = (await upsertUser({ id: "u9", name: "Alex", email: null, slackId: null })).id;
    await expect(retentionSummary(other, p.id, now)).rejects.toThrow();
    await expect(liveSummary(other, p.id, now)).rejects.toThrow();
  });
});

describe("the live view", () => {
  const MIN = 60_000;

  it("counts page views from the last 5 minutes and, with retention on, the distinct visitors", async () => {
    const p = await newProject();
    await updateFeatures(userId, p.id, { retention: true, live: true });
    await recordHit(p.key, { p: "/", i: "aaaaaaaaaaaaaaaaaaaaaaaa" }, who(), new Date(now.getTime() - 6 * MIN));
    await recordHit(p.key, { p: "/", i: "bbbbbbbbbbbbbbbbbbbbbbbb" }, who(), new Date(now.getTime() - 4 * MIN));
    await recordHit(p.key, { p: "/x", i: "bbbbbbbbbbbbbbbbbbbbbbbb" }, who(), new Date(now.getTime() - 1 * MIN));
    // A visitor who read for a while and only sent a heartbeat.
    await recordHit(p.key, { e: "ping", i: "cccccccccccccccccccccccc" }, who(), new Date(now.getTime() - 30_000));
    // A heartbeat from an hour ago is outside the window.
    await recordHit(p.key, { e: "ping", i: "dddddddddddddddddddddddd" }, who(), new Date(now.getTime() - 20 * MIN));
    const s = await liveSummary(userId, p.id, now);
    expect(s).toEqual({ windowMinutes: 5, views: 2, visitors: 2 });
  });

  it("shows only page views when retention is off", async () => {
    const p = await newProject();
    await updateFeatures(userId, p.id, { live: true });
    await recordHit(p.key, { p: "/", i: "aaaaaaaaaaaaaaaaaaaaaaaa" }, who(), new Date(now.getTime() - MIN));
    const s = await liveSummary(userId, p.id, now);
    expect(s).toEqual({ windowMinutes: 5, views: 1, visitors: null });
  });

  it("takes a heartbeat only with both live view and retention on", async () => {
    const p = await newProject();
    await updateFeatures(userId, p.id, { live: true });
    expect(await recordHit(p.key, { e: "ping", i: "aaaaaaaaaaaaaaaaaaaaaaaa" }, who(), now)).toBe(false);
    await updateFeatures(userId, p.id, { retention: true });
    expect(await recordHit(p.key, { e: "ping", i: "aaaaaaaaaaaaaaaaaaaaaaaa" }, who(), now)).toBe(true);
    expect(await recordHit(p.key, { e: "ping", i: "not an id" }, who(), now)).toBe(false);
  });

  it("deletes heartbeats after an hour and keeps newer ones", async () => {
    const p = await newProject();
    await updateFeatures(userId, p.id, { retention: true, live: true });
    await recordHit(p.key, { e: "ping", i: "aaaaaaaaaaaaaaaaaaaaaaaa" }, who(), new Date(now.getTime() - LIVE_KEEP_MS - 1000));
    await recordHit(p.key, { e: "ping", i: "bbbbbbbbbbbbbbbbbbbbbbbb" }, who(), new Date(now.getTime() - LIVE_KEEP_MS + 60_000));
    await prunePageviews(now);
    const rows = await (await getDb()).select().from(schema.analyticsLive).where(eq(schema.analyticsLive.projectId, p.id));
    expect(rows).toHaveLength(1);
    expect(rows[0].vid).toBe(retentionCode({ projectId: p.id, browserId: "bbbbbbbbbbbbbbbbbbbbbbbb", at: new Date(now.getTime() - LIVE_KEEP_MS + 60_000) }));
  });
});

describe("speed", () => {
  const rows = (values: number[], metric: keyof VitalRow = "lcp"): VitalRow[] =>
    values.map((v) => ({ lcp: null, cls: null, inp: null, fcp: null, ttfb: null, [metric]: v }));
  const steps = (n: number, step: number) => Array.from({ length: n }, (_, i) => (i + 1) * step);

  it("takes the median and the 75th percentile of known values and labels the 75th", () => {
    // 100, 200 ... 5000: median (2500 + 2600) / 2, 75th percentile is the 38th value.
    const s = summariseVitals(rows(steps(50, 100)));
    const lcp = s.metrics.find((m) => m.metric === "lcp");
    expect(lcp).toMatchObject({ samples: 50, median: 2550, p75: 3800, rating: "needs-work", ratingLabel: "Needs work", unit: "ms" });
  });

  it("labels good, needs work and poor from the thresholds", () => {
    const rate = (metric: keyof VitalRow, v: number) =>
      summariseVitals(rows(Array(50).fill(v), metric)).metrics.find((m) => m.metric === metric)?.ratingLabel;
    expect(rate("lcp", 2000)).toBe("Good");
    expect(rate("lcp", 5000)).toBe("Poor");
    expect(rate("cls", 0.05)).toBe("Good");
    expect(rate("cls", 0.3)).toBe("Poor");
    expect(rate("inp", 300)).toBe("Needs work");
    expect(rate("ttfb", 900)).toBe("Needs work");
    expect(summariseVitals(rows(Array(50).fill(0.05), "cls")).metrics.find((m) => m.metric === "cls")?.unit).toBe("score");
  });

  it("withholds the figures and the label below 50 samples, and counts only the reports that include a metric", () => {
    const s = summariseVitals([...rows(steps(49, 100)), ...rows(steps(100, 10), "fcp")]);
    expect(s.reports).toBe(149);
    expect(s.metrics.find((m) => m.metric === "lcp")).toMatchObject({ samples: 49, median: null, p75: null, rating: null, ratingLabel: null });
    expect(s.metrics.find((m) => m.metric === "fcp")).toMatchObject({ samples: 100, median: 505, p75: 750, rating: "good" });
  });

  it("stores a summary per page view with rounded numbers and the cleaned path, and reads it back for the owner", async () => {
    const p = await newProject();
    await updateFeatures(userId, p.id, { vitals: true });
    expect(await recordHit(p.key, { e: "vitals", p: "/a?x=1", lcp: 1234.6, cls: 0.12345, ttfb: 90 }, who(), now)).toBe(true);
    expect(await recordHit(p.key, { e: "vitals", p: "/a" }, who(), now)).toBe(false);
    expect(await recordHit(p.key, { e: "vitals", p: "/a", lcp: "slow", cls: -1 }, who(), now)).toBe(false);
    const [row] = await (await getDb()).select().from(schema.analyticsVitals).where(eq(schema.analyticsVitals.projectId, p.id));
    expect(row).toMatchObject({ path: "/a", lcp: 1235, cls: 0.123, inp: null, fcp: null, ttfb: 90 });
    const s = await speedSummary(userId, p.id, 30, new Date("2026-11-05T00:00:00Z"));
    expect(s.reports).toBe(1);
    expect(s.metrics.find((m) => m.metric === "lcp")).toMatchObject({ samples: 1, median: null });
  });
});

describe("errors", () => {
  it("stores the cut message, the file name and the line, with no address and no visitor", async () => {
    const p = await newProject();
    await updateFeatures(userId, p.id, { vitals: true });
    const body = { e: "err", m: "m".repeat(400), f: "app.js", l: 12 };
    expect(await recordHit(p.key, body, who(), now)).toBe(true);
    expect(await recordHit(p.key, { e: "err", m: "   " }, who(), now)).toBe(false);
    const [row] = await (await getDb()).select().from(schema.analyticsErrors).where(eq(schema.analyticsErrors.projectId, p.id));
    expect(row.message).toHaveLength(200);
    expect(row).toMatchObject({ file: "app.js", line: 12 });
    expect(Object.keys(row).sort()).toEqual(["at", "file", "id", "line", "message", "projectId"]);
  });

  it("counts the same error together and gives the last time it was seen", async () => {
    const p = await newProject();
    await updateFeatures(userId, p.id, { vitals: true });
    const at = (m: number) => new Date(now.getTime() + m * 60_000);
    for (const [i, m] of [0, 5, 9].entries()) await recordHit(p.key, { e: "err", m: "x is undefined", f: "a.js", l: 3 }, who(), at(m + i * 0));
    await recordHit(p.key, { e: "err", m: "other", f: "b.js", l: 1 }, who(), at(20));
    const s = await errorsSummary(userId, p.id, 30, at(60));
    expect(s.total).toBe(4);
    expect(s.rows[0]).toMatchObject({ message: "x is undefined", file: "a.js", line: 3, count: 3 });
    expect(s.rows[0].lastSeen.getTime()).toBe(at(9).getTime());
    expect(s.rows[1]).toMatchObject({ message: "other", count: 1 });
  });
});

describe("custom events", () => {
  it("store the name, the value and the day, and nothing that names a visitor", async () => {
    const p = await newProject();
    await updateFeatures(userId, p.id, { events: true });
    expect(await recordHit(p.key, { e: "track", n: "buy", v: "pro" }, who(), now)).toBe(true);
    const [row] = await eventRows(p.id, "track");
    expect(row).toMatchObject({ projectId: p.id, day: "2026-11-04", kind: "track", label: "buy", value: "pro", bucket: null, visitor: null, at: null });
  });

  it("keep the event but drop a value that breaks the rule, and drop an event whose name breaks it", async () => {
    const p = await newProject();
    await updateFeatures(userId, p.id, { events: true });
    expect(await recordHit(p.key, { e: "track", n: "buy", v: "sam@example.com" }, who(), now)).toBe(true);
    expect(await recordHit(p.key, { e: "track", n: "buy", v: "v".repeat(41) }, who(), now)).toBe(true);
    expect(await recordHit(p.key, { e: "track", n: "buy" }, who(), now)).toBe(true);
    expect(await recordHit(p.key, { e: "track", n: "<script>" }, who(), now)).toBe(false);
    expect(await recordHit(p.key, { e: "track", n: "x".repeat(41) }, who(), now)).toBe(false);
    expect((await eventRows(p.id, "track")).map((r) => r.value)).toEqual([null, null, null]);
  });

  it("add up by name and value for the owner, most frequent first, inside the range", async () => {
    const p = await newProject();
    await updateFeatures(userId, p.id, { events: true });
    for (const v of ["pro", "pro", "pro", "free"]) await recordHit(p.key, { e: "track", n: "plan", v }, who(), now);
    await recordHit(p.key, { e: "track", n: "share" }, who(), now);
    await recordHit(p.key, { e: "track", n: "plan", v: "old" }, who(), new Date("2026-09-01T00:00:00Z"));
    const s = await eventsSummary(userId, p.id, 30, new Date("2026-11-05T00:00:00Z"));
    expect(s.total).toBe(5);
    expect(s.rows).toEqual([
      { name: "plan", value: "pro", count: 3 },
      { name: "plan", value: "free", count: 1 },
      { name: "share", value: null, count: 1 },
    ]);
  });

  it("do not stop a funnel goal of the same name from counting", async () => {
    const p = await newProject();
    await updateFeatures(userId, p.id, {
      events: true,
      funnel: true,
      steps: [
        { kind: "page", value: "/" },
        { kind: "track", value: "buy" },
      ],
    });
    expect(await recordHit(p.key, { e: "goal", n: "buy" }, who(), now)).toBe(true);
    expect(await recordHit(p.key, { e: "track", n: "buy", v: "pro" }, who(), now)).toBe(true);
    expect((await eventRows(p.id, "goal")).length).toBe(1);
    expect((await eventRows(p.id, "track")).length).toBe(1);
  });
});
