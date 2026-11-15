import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { upsertUser } from "@/server/auth/session";
import { analyticsSummary } from "@/server/analytics";
import { enableAnalytics } from "@/server/analytics";
import { updateFeatures } from "@/server/analytics-config";
import { eventsSummary } from "@/server/analytics-events";
import { retentionSummary } from "@/server/analytics-retention";
import { errorsSummary, speedSummary } from "@/server/analytics-speed";
import { schema } from "@/server/db";
import { createProject } from "@/server/projects";
import { rateLimiter } from "@/server/rate-limit";
import { createServer } from "@/server/servers";
import { useFreshDb } from "@/server/test/db";

// The route is real. Only who is signed in is replaced.
vi.mock("@/server/auth/current", () => ({ getCurrentUser: vi.fn(), requireUser: vi.fn() }));

import { getCurrentUser } from "@/server/auth/current";
import { GET } from "@/app/api/projects/[id]/analytics/export/route";

let ctx: Awaited<ReturnType<typeof useFreshDb>>;
let me: { id: string };
let other: { id: string };
let projectId: string;
let theirProjectId: string;
let key: string;

type Handler = (req: NextRequest, c: { params: Promise<Record<string, string>> }) => Promise<Response>;
const call = (query: string, id = projectId) =>
  (GET as Handler)(new NextRequest(`http://localhost:3000/api/projects/${id}/analytics/export?${query}`), {
    params: Promise.resolve({ id }),
  });
const signIn = (user: { id: string } | null) =>
  vi.mocked(getCurrentUser).mockResolvedValue(user ? ({ id: user.id, name: "Sam" } as never) : null);
const lines = (csv: string) => csv.split("\r\n").filter(Boolean);
const cells = (line: string) => [...line.matchAll(/"((?:[^"]|"")*)"/g)].map((m) => m[1].replace(/""/g, '"'));
const json = async (q: string) => JSON.parse(await (await call(`${q}&format=json`)).text());

const minute = 60_000;
const VID = "0123456789abcdef0123456789abcdef";

beforeAll(async () => {
  ctx = await useFreshDb();
  me = await upsertUser({ id: "ax-1", name: "Sam", email: null, slackId: null });
  other = await upsertUser({ id: "ax-2", name: "Kim", email: null, slackId: null });
  const base = { repoUrl: "https://github.com/sam/app.git", runtime: "node" as const };
  const myServer = (await createServer(me.id, "sam-api")).id;
  const theirServer = (await createServer(other.id, "kim-api")).id;
  projectId = (await createProject(me.id, { ...base, serverId: myServer, name: "Standup Bot", slug: "standup-bot", port: 3000 })).id;
  theirProjectId = (await createProject(other.id, { ...base, serverId: theirServer, name: "Theirs", slug: "theirs", port: 3001 })).id;
  key = (await enableAnalytics(me.id, projectId)).key;
  await enableAnalytics(other.id, theirProjectId);

  const now = Date.now();
  const view = (path: string, ago: number, extra: Partial<typeof schema.pageviews.$inferInsert> = {}) => ({
    projectId, at: new Date(now - ago), path, visitor: `day-hash-${path}-${ago}`, ...extra,
  });
  await ctx.db.insert(schema.pageviews).values([
    view("/", 1 * minute, { referrer: "github.com", utmCampaign: "launch", utmSource: "github.com", vid: VID }),
    view("/", 2 * minute, { referrer: "github.com", vid: VID }),
    view("/pricing", 3 * minute, { referrer: "news.ycombinator.com", utmCampaign: "launch", utmSource: "hn", utmMedium: "post" }),
    view("/pricing", 4 * minute),
    view("/docs", 5 * minute),
    // Someone else's project must never appear.
    { projectId: theirProjectId, at: new Date(now - minute), path: "/their-secret-page", visitor: "x" },
  ]);
  await updateFeatures(me.id, projectId, {
    referrers: true,
    campaigns: true,
    utmAllowlist: { source: ["github.com", "hn"], medium: ["post"], campaign: ["launch"] },
    vitals: true,
    events: true,
    retention: true,
  });
  await ctx.db.insert(schema.analyticsVitals).values(
    [1000, 2000, 3000, 4500].map((lcp, i) => ({ projectId, at: new Date(now - (i + 1) * minute), path: "/", lcp, cls: 0.05, inp: null, fcp: 900, ttfb: 300 }))
  );
  await ctx.db.insert(schema.analyticsErrors).values([
    { projectId, at: new Date(now - minute), message: "=HYPERLINK(\"http://evil.example\")", file: "app.js", line: 3 },
    { projectId, at: new Date(now - 2 * minute), message: "=HYPERLINK(\"http://evil.example\")", file: "app.js", line: 3 },
    { projectId, at: new Date(now - 3 * minute), message: "Failed to fetch, \"quoted\"", file: null, line: null },
  ]);
  const day = new Date(now).toISOString().slice(0, 10);
  await ctx.db.insert(schema.analyticsEvents).values([
    { projectId, day, kind: "track", label: "Signed up", value: "pro" },
    { projectId, day, kind: "track", label: "Signed up", value: "free" },
    { projectId, day, kind: "track", label: "Shared", value: null },
  ]);
});

afterAll(async () => {
  await ctx.cleanup();
});

beforeEach(() => {
  rateLimiter().clear();
  vi.mocked(getCurrentUser).mockReset();
  signIn(me);
});

describe("GET /api/projects/[id]/analytics/export", () => {
  it("needs a signed-in user", async () => {
    signIn(null);
    expect((await call("tab=overview")).status).toBe(401);
  });

  it("is 404 for someone else's project", async () => {
    const res = await call("tab=overview", theirProjectId);
    expect(res.status).toBe(404);
    expect(await res.text()).not.toContain("their-secret-page");
  });

  it("is 400 for a tab, card or format it does not know", async () => {
    expect((await call("tab=nope")).status).toBe(400);
    expect((await call("")).status).toBe(400);
    expect((await call("tab=overview&card=lcp")).status).toBe(400);
    expect((await call("tab=overview&format=xlsx")).status).toBe(400);
  });

  it("sets the download headers: attachment, a name with the range, never cached", async () => {
    const res = await call("tab=overview");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(res.headers.get("content-disposition")).toBe('attachment; filename="standup-bot-analytics-overview-30d.csv"');
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    const j = await call("tab=overview&card=pages&format=json");
    expect(j.headers.get("content-type")).toBe("application/json; charset=utf-8");
    expect(j.headers.get("content-disposition")).toBe('attachment; filename="standup-bot-analytics-overview-pages-30d.json"');
  });

  it("overview: the CSV and the JSON hold the numbers of the page views card", async () => {
    const s = await analyticsSummary(me.id, projectId, 30);
    const csv = await (await call("tab=overview")).text();
    expect(csv.includes("\r\n")).toBe(true);
    const rows = lines(csv);
    expect(cells(rows[0])).toEqual(["Day (UTC)", "Page views", "Visitors"]);
    expect(rows).toHaveLength(1 + s.daily.length);
    expect(rows.slice(1).map(cells)).toEqual(s.daily.map((d) => [d.day, String(d.views), String(d.visitors)]));
    const total = rows.slice(1).reduce((n, r) => n + Number(cells(r)[1]), 0);
    expect(total).toBe(s.views);
    expect(total).toBe(5);

    const body = await json("tab=overview");
    expect(body.days).toBe(30);
    expect(body.columns).toEqual(["Day (UTC)", "Page views", "Visitors"]);
    expect(body.rows).toEqual(s.daily.map((d) => ({ "Day (UTC)": d.day, "Page views": d.views, Visitors: d.visitors })));
  });

  it("overview: top pages, referrers and campaigns", async () => {
    const pages = lines(await (await call("tab=overview&card=pages")).text()).slice(1).map(cells);
    expect(pages.sort()).toEqual([["/", "2"], ["/docs", "1"], ["/pricing", "2"]]);
    const refs = (await json("tab=overview&card=referrers")).rows;
    expect(refs).toEqual([{ Referrer: "github.com", "Page views": 2 }, { Referrer: "news.ycombinator.com", "Page views": 1 }]);
    const camps = (await json("tab=overview&card=campaigns")).rows;
    expect(camps).toEqual(expect.arrayContaining([{ Campaign: "launch", Source: "hn", Medium: "post", "Page views": 1 }]));
    expect(camps).toHaveLength(2);
  });

  it("speed: each measurement exports its median, 75th percentile, bands and daily medians", async () => {
    const s = await speedSummary(me.id, projectId, 30);
    const lcp = s.metrics.find((m) => m.metric === "lcp")!;
    const body = await json("tab=speed&card=lcp");
    expect(body.columns).toEqual(["Section", "Name", "Value", "Unit", "Reports"]);
    const sections = (name: string) => body.rows.filter((r: Record<string, unknown>) => r.Name === name);
    // Four reports are below the minimum, so no figure is shown, as on the card.
    expect(lcp.median).toBeNull();
    expect(sections("Median")[0]).toEqual({ Section: "Summary", Name: "Median", Value: null, Unit: "ms", Reports: 4 });
    expect(body.rows.filter((r: Record<string, unknown>) => r.Section === "Band")).toEqual(
      lcp.bands.map((b) => ({ Section: "Band", Name: b.label, Value: b.percent, Unit: "%", Reports: b.reports })),
    );
    expect(lcp.bands.map((b) => b.reports)).toEqual([2, 1, 1]);
    const csv = lines(await (await call("tab=speed&card=lcp")).text());
    expect(cells(csv[0])).toEqual(["Section", "Name", "Value", "Unit", "Reports"]);
    expect(csv.map(cells).find((r) => r[1] === "Good")).toEqual(["Band", "Good", "", "%", "2"]);
    expect((await call("tab=speed&card=cls")).headers.get("content-disposition")).toContain("analytics-speed-cls-30d.csv");
  });

  it("speed: errors per day and top errors", async () => {
    const s = await errorsSummary(me.id, projectId, 30);
    const daily = (await json("tab=speed&card=errors-daily")).rows;
    expect(daily).toEqual(s.daily.map((d) => ({ "Day (UTC)": d.day, Errors: d.count })));
    expect(daily.reduce((n: number, r: { Errors: number }) => n + r.Errors, 0)).toBe(3);
    const top = (await json("tab=speed&card=errors")).rows;
    expect(top.map((r: Record<string, unknown>) => [r.Message, r.Times])).toEqual(s.rows.map((r) => [r.message, r.count]));
    expect(top[0].Times).toBe(2);
    expect(top[0]["Last seen (UTC)"]).toBe(s.rows[0].lastSeen.toISOString());
  });

  it("neutralises a formula in a cell and keeps quotes and commas in their cell", async () => {
    const csv = await (await call("tab=speed&card=errors")).text();
    expect(csv).toContain(`"'=HYPERLINK(""http://evil.example"")"`);
    expect(csv).not.toMatch(/(^|,)"=/m);
    expect(csv).toContain(`"Failed to fetch, ""quoted"""`);
    // JSON keeps the text as it is.
    expect((await json("tab=speed&card=errors")).rows[0].Message).toBe('=HYPERLINK("http://evil.example")');
  });

  it("events: by name and value, by name, and per day", async () => {
    const s = await eventsSummary(me.id, projectId, 30);
    expect((await json("tab=events")).rows).toEqual(s.rows.map((r) => ({ Name: r.name, Value: r.value, Count: r.count })));
    expect((await json("tab=events&card=events-by-name")).rows).toEqual([
      { Name: "Signed up", Count: 2 },
      { Name: "Shared", Count: 1 },
    ]);
    const daily = (await json("tab=events&card=events-daily")).rows;
    expect(daily).toHaveLength(30);
    expect(daily.reduce((n: number, r: { Events: number }) => n + r.Events, 0)).toBe(3);
  });

  it("visitors: the retention figures and new against returning per day", async () => {
    const s = await retentionSummary(me.id, projectId);
    const ret = (await json("tab=visitors")).rows;
    expect(ret[0]).toEqual({ Measure: "Visitors in the last 7 days", Visitors: s.visitorsThisWeek, "Came back": null, "Return rate (%)": null });
    expect(ret[1].Visitors).toBe(s.week.cohort);
    expect(ret[2]["Return rate (%)"]).toBe(s.month.percent);
    const daily = (await json("tab=visitors&card=returning-daily")).rows;
    expect(daily).toEqual(s.daily.map((d) => ({ "Day (UTC)": d.day, "New visitors": d.newVisitors, "Returning visitors": d.returning })));
    // One visitor with a retention id, seen today: new, not returning.
    expect(daily.at(-1)).toMatchObject({ "New visitors": 1, "Returning visitors": 0 });
  });

  it("never holds a user id, the project key, the project id or a visitor code, in either format", async () => {
    const cards = ["overview", "overview&card=pages", "overview&card=referrers", "overview&card=campaigns", "speed&card=lcp",
      "speed&card=errors", "speed&card=errors-daily", "events", "events&card=events-by-name", "events&card=events-daily",
      "visitors", "visitors&card=returning-daily"];
    for (const c of cards) {
      for (const format of ["csv", "json"]) {
        rateLimiter().clear();
        const res = await call(`tab=${c}&format=${format}`);
        expect(res.status, c).toBe(200);
        const body = await res.text();
        for (const secret of [me.id, other.id, projectId, theirProjectId, key, VID, "day-hash"]) expect(body, `${c} ${format}`).not.toContain(secret);
        expect(body).not.toContain("their-secret-page");
      }
    }
  });

  it("is 404 for a card whose switch is off", async () => {
    await updateFeatures(me.id, projectId, { vitals: false });
    expect((await call("tab=speed&card=lcp")).status).toBe(404);
    expect((await call("tab=speed&card=errors")).status).toBe(404);
    await updateFeatures(me.id, projectId, { vitals: true });
    expect((await call("tab=speed&card=lcp")).status).toBe(200);
  });

  it("exports campaigns only while the Campaigns switch is on, whatever Referrers says", async () => {
    // Referrers on, Campaigns off: the campaign card is not on the page, so it is not exported.
    await updateFeatures(me.id, projectId, { campaigns: false });
    expect((await call("tab=overview&card=campaigns")).status).toBe(404);
    expect((await call("tab=overview&card=referrers")).status).toBe(200);
    // Campaigns on, Referrers off: the campaign card is exported.
    await updateFeatures(me.id, projectId, { campaigns: true, referrers: false });
    expect((await call("tab=overview&card=campaigns")).status).toBe(200);
    await updateFeatures(me.id, projectId, { referrers: true });
  });

  it("is rate limited per user", async () => {
    const codes: number[] = [];
    for (let i = 0; i < 11; i++) codes.push((await call("tab=overview")).status);
    expect(codes.slice(0, 10).every((c) => c === 200)).toBe(true);
    expect(codes[10]).toBe(429);
  });
});
