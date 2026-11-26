import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { cleanLabel, clicksSummary, optedOut, recordHit, summariseTime, timeSummary } from "@/server/analytics-events";
import { PROJECT_WRITE_LIMIT, enableAnalytics, recordPageview, prunePageviews, UNKNOWN_IP } from "@/server/analytics";
import { updateFeatures } from "@/server/analytics-config";
import { upsertUser } from "@/server/auth/session";
import { getDb, schema } from "@/server/db";
import { createProject } from "@/server/projects";
import { createServer } from "@/server/servers";
import { useFreshDb } from "@/server/test/db";

describe("cleanLabel", () => {
  it("accepts only static instrumentation names", () => {
    expect(cleanLabel("  sign-up  ")).toBe("sign-up");
    expect(cleanLabel("https://example.test/users/sam")).toBeNull();
    expect(cleanLabel("x".repeat(100))).toBeNull();
  });
  it("drops empty labels and non-strings", () => {
    expect(cleanLabel("   ")).toBeNull();
    expect(cleanLabel(42)).toBeNull();
    expect(cleanLabel(undefined)).toBeNull();
  });
  it("rejects URL and arbitrary text", () => {
    expect(cleanLabel("https://shop.example/cart?token=abc#x")).toBeNull();
    expect(cleanLabel("/account?id=9")).toBeNull();
  });
  it("drops a label that is an email address", () => {
    expect(cleanLabel("Signed in as sam@example.com")).toBeNull();
  });
});

describe("summariseTime", () => {
  const counts = (a: number, b: number, c: number, d: number) => ({ lt10: a, "10-60": b, "60-300": c, gt300: d });

  it("withholds shares and the median below the minimum sample, and still shows the counts", () => {
    const s = summariseTime(counts(20, 20, 9, 0));
    expect(s).toMatchObject({ total: 49, enough: false, median: null, minimum: 50 });
    expect(s.buckets.map((b) => b.visits)).toEqual([20, 20, 9, 0]);
    expect(s.buckets.every((b) => b.percent === null)).toBe(true);
  });

  it("gives the share of visits in each bucket and the bucket that holds the median", () => {
    const s = summariseTime(counts(10, 30, 50, 10));
    expect(s.enough).toBe(true);
    expect(s.buckets.map((b) => b.percent)).toEqual([10, 30, 50, 10]);
    expect(s.median).toBe("60-300");
  });

  it("names the buckets in plain words", () => {
    expect(summariseTime(counts(0, 0, 0, 0)).buckets.map((b) => b.label)).toEqual([
      "Under 10 seconds",
      "10 to 60 seconds",
      "1 to 5 minutes",
      "Over 5 minutes",
    ]);
  });

  it("takes the lower middle when the visits split exactly in half", () => {
    expect(summariseTime(counts(50, 50, 0, 0)).median).toBe("lt10");
  });

  it("never rounds a small share to 0 or a large one to 100", () => {
    const s = summariseTime(counts(1, 0, 0, 999));
    expect(s.buckets[0].percent).toBe(1);
    expect(s.buckets[3].percent).toBe(99);
  });
});

describe("optedOut", () => {
  it("is true for Do Not Track and Global Privacy Control headers", () => {
    expect(optedOut(new Headers({ dnt: "1" }))).toBe(true);
    expect(optedOut(new Headers({ "sec-gpc": "1" }))).toBe(true);
    expect(optedOut(new Headers({ dnt: "0" }))).toBe(false);
    expect(optedOut(new Headers())).toBe(false);
  });
});

describe("click events", () => {
  let ctx: Awaited<ReturnType<typeof useFreshDb>>;
  let userId: string;
  let projectId: string;
  let key: string;
  const who = (ip = "1.1.1.1") => ({ ip, ua: "Mozilla/5.0 Firefox" });
  const now = new Date("2026-11-04T12:00:00Z");
  const events = async () => (await getDb()).select().from(schema.analyticsEvents);

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

  it("records nothing while the clicks switch is off", async () => {
    expect(await recordHit(key, { e: "click", l: "Buy" }, who(), now)).toBe(false);
    expect(await events()).toEqual([]);
  });

  it("records a short label with a day and the project, and no visitor id", async () => {
    await updateFeatures(userId, projectId, { clicks: true });
    expect(await recordHit(key, { e: "click", l: "  Buy   now  " }, who("2.2.2.2"), now)).toBe(true);
    const rows = await events();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      projectId,
      day: "2026-11-04",
      kind: "click",
      label: "Buy now",
      bucket: null,
      visitor: null,
      at: null,
    });
  });

  it("drops bots, unknown keys, empty labels and unknown event types", async () => {
    const before = (await events()).length;
    expect(await recordHit(key, { e: "click", l: "Buy" }, { ip: "3.3.3.3", ua: "Googlebot/2.1" }, now)).toBe(false);
    expect(await recordHit("nda_nope", { e: "click", l: "Buy" }, who("4.4.4.4"), now)).toBe(false);
    expect(await recordHit(key, { e: "click", l: "   " }, who("5.5.5.5"), now)).toBe(false);
    expect(await recordHit(key, { e: "keypress", l: "a" }, who("6.6.6.6"), now)).toBe(false);
    expect((await events()).length).toBe(before);
  });

  it("limits how fast one address can send events", async () => {
    const sent = [];
    for (let i = 0; i < 60; i++) sent.push(await recordHit(key, { e: "click", l: `b${i}` }, who("7.7.7.7"), now));
    expect(sent.filter(Boolean).length).toBeLessThan(60);
    expect(sent.filter(Boolean).length).toBeGreaterThan(5);
  });

  it("summarises the top clicks for the project's owner", async () => {
    const s = await clicksSummary(userId, projectId, 30, new Date("2026-11-05T09:00:00Z"));
    expect(s.rows[0].clicks).toBe(1);
    expect(s.rows.map((r) => r.label)).toContain("Buy now");
    expect(s.total).toBeGreaterThan(1);
  });

  it("does not count clicks from before the window", async () => {
    const s = await clicksSummary(userId, projectId, 1, new Date("2026-11-06T09:00:00Z"));
    expect(s.rows).toEqual([]);
  });
});

describe("time events", () => {
  let ctx: Awaited<ReturnType<typeof useFreshDb>>;
  let userId: string;
  let projectId: string;
  let key: string;
  const now = new Date("2026-11-04T12:00:00Z");
  const who = (ip: string) => ({ ip, ua: "Mozilla/5.0 Firefox" });

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

  it("records nothing while the time switch is off", async () => {
    expect(await recordHit(key, { e: "time", b: "lt10" }, who("1.1.1.1"), now)).toBe(false);
  });

  it("records only the bucket, a day and the project", async () => {
    await updateFeatures(userId, projectId, { time: true });
    expect(await recordHit(key, { e: "time", b: "10-60" }, who("1.1.1.1"), now)).toBe(true);
    const rows = await (await getDb()).select().from(schema.analyticsEvents);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ projectId, day: "2026-11-04", kind: "time", bucket: "10-60", label: null, visitor: null, at: null });
  });

  it("drops a bucket it does not know and a raw number of seconds", async () => {
    expect(await recordHit(key, { e: "time", b: "forever" }, who("2.2.2.2"), now)).toBe(false);
    expect(await recordHit(key, { e: "time", b: 42 }, who("2.2.2.2"), now)).toBe(false);
    expect(await recordHit(key, { e: "time", s: 42 }, who("2.2.2.2"), now)).toBe(false);
    expect(await (await getDb()).select().from(schema.analyticsEvents)).toHaveLength(1);
  });

  it("counts visits per bucket for the owner, and says when there are too few", async () => {
    const s = await timeSummary(userId, projectId, 30, new Date("2026-11-05T09:00:00Z"));
    expect(s.total).toBe(1);
    expect(s.enough).toBe(false);
    expect(s.buckets.find((b) => b.bucket === "10-60")?.visits).toBe(1);
    expect(s.median).toBeNull();
  });

  it("ages out with the page views after 90 days", async () => {
    const db = await getDb();
    await db.insert(schema.analyticsEvents).values({ projectId, day: "2026-01-01", kind: "time", bucket: "lt10" });
    await prunePageviews(new Date("2026-11-05T00:00:00Z"));
    const days = (await db.select().from(schema.analyticsEvents)).map((r) => r.day);
    expect(days).toEqual(["2026-11-04"]);
  });

  it("leaves out days before the window", async () => {
    const s = await timeSummary(userId, projectId, 1, new Date("2026-11-06T09:00:00Z"));
    expect(s.total).toBe(0);
  });
});

describe("per-project write cap", () => {
  let ctx: Awaited<ReturnType<typeof useFreshDb>>;
  let userId: string;
  let projectId: string;
  let key: string;
  const now = new Date("2026-11-04T12:00:00Z");
  const who = (ip: string) => ({ ip, ua: "Mozilla/5.0 Firefox" });
  const pageviewRows = async () =>
    (await getDb()).select().from(schema.pageviews).where(eq(schema.pageviews.projectId, projectId));
  const clickRows = async () =>
    (await getDb()).select().from(schema.analyticsEvents).where(eq(schema.analyticsEvents.projectId, projectId));

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
    await updateFeatures(userId, projectId, { clicks: true });
  });
  afterAll(async () => {
    await ctx.cleanup();
  });

  it("caps one project's page views in a minute whatever the addresses they come from", async () => {
    let kept = 0;
    for (let i = 0; i < PROJECT_WRITE_LIMIT + 40; i++) {
      // A fresh address for most sends, and the shared unknown one every tenth,
      // as when TRUST_PROXY is off and every visitor counts as one address.
      const sender =
        i % 10 === 9 ? { ip: UNKNOWN_IP, ua: "Mozilla/5.0 Firefox" } : { ip: `9.3.${Math.floor(i / 250)}.${i % 250 + 1}`, ua: "Mozilla/5.0 Firefox" };
      if (await recordPageview(key, { p: "/", pt: 1 }, sender, now)) kept += 1;
    }
    expect(kept).toBe(PROJECT_WRITE_LIMIT);
    expect(await pageviewRows()).toHaveLength(PROJECT_WRITE_LIMIT);
  });

  it("opens the window again in the next minute, for any address", async () => {
    expect(await recordPageview(key, { p: "/", pt: 1 }, who("7.7.7.7"), new Date(now.getTime() + 61_000))).toBe(true);
    expect(await pageviewRows()).toHaveLength(PROJECT_WRITE_LIMIT + 1);
  });

  it("counts events toward the same cap, even with a fresh address for every report", async () => {
    const minute = new Date(now.getTime() + 130_000);
    let kept = 0;
    for (let i = 0; i < PROJECT_WRITE_LIMIT + 10; i++) {
      if (await recordHit(key, { e: "click", l: "Buy" }, who(`9.2.${Math.floor(i / 250)}.${i % 250 + 1}`), minute)) kept += 1;
    }
    expect(kept).toBe(PROJECT_WRITE_LIMIT);
    expect(await clickRows()).toHaveLength(PROJECT_WRITE_LIMIT);
  });
});
