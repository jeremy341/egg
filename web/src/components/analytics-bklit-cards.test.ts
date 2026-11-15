import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  AnalyticsChartBklit,
  CampaignsBklit,
  ClicksBklit,
  ErrorsBklit,
  EventsBklit,
  FunnelBklit,
  PagesBklit,
  ReferrersBklit,
  RetentionBklit,
  SpeedBklit,
  TimeBklit,
} from "./analytics-bklit-cards";
import { RETENTION_NOTICE } from "@/lib/analytics-defaults";
import { summariseTime } from "@/server/analytics-events";
import { summariseFunnel } from "@/server/analytics-funnel";
import { summariseVitals, type VitalRow } from "@/server/analytics-speed";

const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
const pid = "p1";

/** The cells of every body row of every table in the markup, as text. */
function tables(html: string): string[][][] {
  return [...html.matchAll(/<table[\s\S]*?<\/table>/g)].map((t) => {
    const body = /<tbody>([\s\S]*?)<\/tbody>/.exec(t[0])?.[1] ?? "";
    return [...body.matchAll(/<tr>([\s\S]*?)<\/tr>/g)].map((r) =>
      [...r[1].matchAll(/<t[hd][^>]*>([^<]*)<\/t[hd]>/g)].map((c) => c[1]),
    );
  });
}

/** Every card needs: a visible title, a one-sentence summary, a data table the keyboard can reach, an Export menu. */
function expectFrame(html: string, title: string) {
  expect(html).toMatch(new RegExp(`<h[23][^>]*>${title}</h[23]>`));
  expect(html).toContain('role="region"');
  expect(html).toContain('tabindex="0"');
  expect(html).toContain("sr-only focus-within:not-sr-only");
}

describe("ranked bar cards", () => {
  const rows = [
    { label: "/pricing", views: 4050 },
    { label: "/", views: 1200 },
    { label: "/docs", views: 7 },
  ];

  it("Top pages: the sentence names the largest page and the table lists every row with the same numbers", () => {
    const html = renderToStaticMarkup(createElement(PagesBklit, { rows, projectId: pid }));
    expectFrame(html, "Top pages");
    expect(text(html)).toContain("Largest: /pricing, 4,050 views.");
    expect(tables(html)[0]).toEqual([
      ["/pricing", "4,050"],
      ["/", "1,200"],
      ["/docs", "7"],
    ]);
    expect(html).toContain('role="img"');
  });

  it("Top pages with no rows says so and draws no chart or table", () => {
    const html = renderToStaticMarkup(createElement(PagesBklit, { rows: [], projectId: pid }));
    expect(text(html)).toContain("No pages yet.");
    expect(html).not.toContain('role="img"');
    expect(html).not.toContain("<table");
    expect(html).not.toContain("Export");
  });

  it("Referrers say when no visit had one", () => {
    const html = renderToStaticMarkup(createElement(ReferrersBklit, { rows: [], projectId: pid }));
    expect(text(html)).toContain("Most visits had no referring site.");
    expect(html).not.toContain('role="img"');
  });

  it("two bars never share a label", () => {
    const html = renderToStaticMarkup(
      createElement(CampaignsBklit, {
        summary: { days: 30, rows: [
          { campaign: "launch", source: "twitter.com", medium: "social", views: 9 },
          { campaign: "launch", source: null, medium: null, views: 3 },
        ] },
        projectId: pid,
      }),
    );
    expect(tables(html)[0]).toEqual([
      ["launch (twitter.com / social)", "9"],
      ["launch", "3"],
    ]);
  });

  it("Clicks and Time on page give the total and the median in words", () => {
    const clicks = renderToStaticMarkup(
      createElement(ClicksBklit, { summary: { days: 30, total: 29, rows: [{ label: "Start", clicks: 20 }, { label: "Docs", clicks: 9 }] }, projectId: pid }),
    );
    expect(text(clicks)).toContain("29 clicks in the last 30 days. Largest: Start, 20 clicks.");
    expect(tables(clicks)[0]).toEqual([["Start", "20"], ["Docs", "9"]]);

    const time = renderToStaticMarkup(
      createElement(TimeBklit, {
        summary: {
          days: 30, total: 60, minimum: 50, enough: true, median: "10-60",
          buckets: [
            { bucket: "lt10", label: "Under 10 seconds", visits: 20, percent: 33 },
            { bucket: "10-60", label: "10 to 60 seconds", visits: 30, percent: 50 },
            { bucket: "60-300", label: "1 to 5 minutes", visits: 10, percent: 17 },
            { bucket: "gt300", label: "Over 5 minutes", visits: 0, percent: 0 },
          ],
        },
        projectId: pid,
      }),
    );
    expect(text(time)).toContain("60 visits in the last 30 days. Median: 10 to 60 seconds.");
    expect(tables(time)[0][1]).toEqual(["10 to 60 seconds", "50%", "30"]);
  });

  it("Funnel shows each step and its drop-off", () => {
    const html = renderToStaticMarkup(
      createElement(FunnelBklit, {
        summary: {
          days: 30, minimum: 20, enough: true, started: 100, completed: 40, conversionPercent: 40,
          steps: [
            { kind: "page", value: "/pricing", visitors: 100, dropped: null, dropPercent: null },
            { kind: "track", value: "Signed up", visitors: 40, dropped: 60, dropPercent: 60 },
          ],
        },
        projectId: pid,
      }),
    );
    expect(text(html)).toContain("Of 100 visitors who started, 40 reached the last step (40%).");
    expect(tables(html)[0]).toEqual([
      ["1. /pricing", "First step", "100"],
      ["2. Signed up", "60 visitors dropped off (60%)", "40"],
    ]);
  });
});

describe("small samples and empty cards", () => {
  const steps = [
    { kind: "page" as const, value: "/pricing" },
    { kind: "track" as const, value: "signup" },
  ];

  it("Time on page gives shares and a median once there are enough visits", () => {
    const summary = { ...summariseTime({ lt10: 10, "10-60": 30, "60-300": 50, gt300: 10 }), days: 30 };
    const html = renderToStaticMarkup(createElement(TimeBklit, { summary, projectId: pid }));
    expect(text(html)).toContain("Median: 1 to 5 minutes.");
    expect(tables(html)[0][2]).toEqual(["1 to 5 minutes", "50%", "50"]);
  });

  it("Time on page says not enough data, and how many visits it needs, instead of shares below the minimum", () => {
    const summary = { ...summariseTime({ lt10: 3, "10-60": 2, "60-300": 0, gt300: 0 }), days: 30 };
    const html = renderToStaticMarkup(createElement(TimeBklit, { summary, projectId: pid }));
    expect(text(html)).toContain(`Median: not enough data, it needs at least ${summary.minimum} visits.`);
    for (const row of tables(html)[0]) expect(row[1]).toBe("Not enough data");
    expect(text(html)).not.toMatch(/\d%/);
  });

  it("Time on page with no visits explains the empty card and draws nothing", () => {
    const summary = { ...summariseTime({ lt10: 0, "10-60": 0, "60-300": 0, gt300: 0 }), days: 30 };
    const html = renderToStaticMarkup(createElement(TimeBklit, { summary, projectId: pid }));
    expect(text(html)).toContain("No times recorded yet.");
    expect(html).not.toContain('role="img"');
    expect(html).not.toContain("<table");
  });

  it("Funnel shows counts but no percentages below the minimum sample", () => {
    const summary = summariseFunnel(steps, [30, 10]);
    const html = renderToStaticMarkup(createElement(FunnelBklit, { summary, projectId: pid }));
    expect(text(html)).toContain(`30 visitors started. Percentages appear once ${summary.minimum} visitors have reached the step before.`);
    expect(tables(html)[0]).toEqual([
      ["1. /pricing", "First step", "30"],
      ["2. signup", "20 visitors dropped off", "10"],
    ]);
    expect(text(html)).not.toContain("%)");
  });

  it("Funnel with nobody at the first step says so", () => {
    const html = renderToStaticMarkup(createElement(FunnelBklit, { summary: summariseFunnel(steps, [0, 0]), projectId: pid }));
    expect(text(html)).toContain("No visitors have reached the first step yet.");
  });

  it("Clicks with none explains the empty card", () => {
    const html = renderToStaticMarkup(createElement(ClicksBklit, { summary: { days: 30, total: 0, rows: [] }, projectId: pid }));
    expect(text(html)).toContain("No clicks recorded yet.");
    expect(html).not.toContain('role="img"');
  });
});

describe("footnotes", () => {
  it("Campaigns say where the values come from, once there is a campaign", () => {
    const html = renderToStaticMarkup(
      createElement(CampaignsBklit, {
        summary: { days: 30, rows: [{ campaign: "launch", source: null, medium: null, views: 3 }] },
        projectId: pid,
      }),
    );
    expect(text(html)).toContain("From the utm_source, utm_medium and utm_campaign values in the address. Only values on the Campaigns allowlist are recorded. The last 30 days.");
    const none = renderToStaticMarkup(createElement(CampaignsBklit, { summary: { days: 30, rows: [] }, projectId: pid }));
    expect(text(none)).not.toContain("Only values on the Campaigns allowlist are recorded. The last");
    expect(text(none)).toContain("No campaigns yet. Only values on the Campaigns allowlist in Setup are recorded");
  });

  it("Returning visitors carry the retention notice word for word", () => {
    const html = renderToStaticMarkup(
      createElement(RetentionBklit, {
        summary: {
          visitorsThisWeek: 0,
          minimum: 20,
          week: { cohort: 0, returned: 0, percent: null, enough: false },
          month: { cohort: 0, returned: 0, percent: null, enough: false },
          daily: [],
        },
        projectId: pid,
      }),
    );
    expect(text(html)).toContain(RETENTION_NOTICE.replace("'", "&#x27;"));
    expect(text(html)).toContain("The code stored for a visitor changes every 90 days");
  });
});

describe("daily area cards", () => {
  const errors = {
    days: 30,
    total: 7,
    rows: [{ message: "TypeError: x is undefined", file: "app.js", line: 10, count: 5, lastSeen: new Date("2026-11-03T10:00:00Z") }],
    daily: [
      { day: "2026-11-01", count: 0 },
      { day: "2026-11-02", count: 2 },
      { day: "2026-11-03", count: 5 },
    ],
  };

  it("Errors: per-day sentence and table match, and the top errors list the same counts", () => {
    const html = renderToStaticMarkup(createElement(ErrorsBklit, { summary: errors, projectId: pid }));
    expectFrame(html, "Errors per day");
    expectFrame(html, "Top errors");
    expect(text(html)).toContain("Highest: 3 Nov, 5 errors. Lowest: 1 Nov, 0 errors.");
    const [perDay, top] = tables(html);
    expect(perDay).toEqual([["1 Nov", "0"], ["2 Nov", "2"], ["3 Nov", "5"]]);
    expect(top).toEqual([["TypeError: x is undefined", "app.js, line 10", "3 Nov, 10:00", "5"]]);
    expect(html).toContain("Last seen (UTC)");
    expect(text(html)).toContain("7 errors in the last 30 days");
  });

  it("Errors with none says so in both cards and draws nothing", () => {
    const html = renderToStaticMarkup(
      createElement(ErrorsBklit, {
        summary: { days: 30, total: 0, rows: [], daily: errors.daily.map((d) => ({ ...d, count: 0 })) },
        projectId: pid,
      }),
    );
    expect(text(html).match(/No JavaScript errors reported in the last 30 days\./g)).toHaveLength(2);
    expect(html).not.toContain('role="img"');
    expect(html).not.toContain("<table");
  });

  const events = {
    days: 30,
    total: 6,
    rows: [{ name: "Signed up", value: "pro", count: 4 }, { name: "Shared", value: null, count: 2 }],
    byName: [{ name: "Signed up", count: 4 }, { name: "Shared", count: 2 }],
    daily: [{ day: "2026-11-01", count: 1 }, { day: "2026-11-02", count: 5 }],
  };

  it("Events: by name, by name and value, and per day", () => {
    const html = renderToStaticMarkup(createElement(EventsBklit, { summary: events, projectId: pid }));
    expect(text(html)).toContain("6 events in the last 30 days. Largest: Signed up, 4 events.");
    expect(text(html)).toContain("Highest: 2 Nov, 5 events. Lowest: 1 Nov, 1 event.");
    expect(tables(html)).toEqual([
      [["Signed up", "4"], ["Shared", "2"]],
      [["Signed up: pro", "4"], ["Shared", "2"]],
      [["1 Nov", "1"], ["2 Nov", "5"]],
    ]);
  });

  it("Events with none says so", () => {
    const html = renderToStaticMarkup(
      createElement(EventsBklit, { summary: { days: 30, total: 0, rows: [], byName: [], daily: events.daily.map((d) => ({ ...d, count: 0 })) }, projectId: pid }),
    );
    expect(text(html)).toContain("No events yet.");
    expect(text(html)).toContain("No events in the last 30 days.");
    expect(html).not.toContain('role="img"');
  });
});

describe("Speed", () => {
  // 120 reports over four days, 30 a day, so every day has enough for a median.
  const rows: VitalRow[] = Array.from({ length: 120 }, (_, i) => ({
    at: new Date(Date.UTC(2026, 10, 1 + (i % 4), 12)),
    lcp: i < 60 ? 2000 : i < 100 ? 3000 : 5000, // 60 good, 40 needs work, 20 poor
    cls: 0.05,
    inp: null,
    fcp: 1000,
    ttfb: 500,
  }));
  const summary = summariseVitals(rows);

  it("each measurement shows the median and 75th percentile as labelled numbers", () => {
    const html = renderToStaticMarkup(createElement(SpeedBklit, { summary, projectId: pid }));
    const lcp = summary.metrics[0];
    expect(lcp.median).toBe(2500);
    expect(text(html)).toContain("Largest Contentful Paint (LCP)");
    expect(text(html)).toContain("Median 2.50 s");
    expect(text(html)).toContain("75th percentile 3.00 s");
    expect(text(html)).toContain("Needs work");
    for (const m of summary.metrics) expect(text(html)).toContain(`${m.name} (${m.metric.toUpperCase()})`);
  });

  it("the band histogram has the same counts and shares as the input", () => {
    const html = renderToStaticMarkup(createElement(SpeedBklit, { summary, projectId: pid }));
    expect(text(html)).toContain("Most reports are Good: 60 of 120 reports (50%).");
    const [bands] = tables(html);
    expect(bands).toEqual([
      ["Good", "up to 2.50 s", "60", "50%"],
      ["Needs work", "over 2.50 s, up to 4.00 s", "40", "33%"],
      ["Poor", "over 4.00 s", "20", "17%"],
    ]);
  });

  it("the median line has a row for each day with enough reports", () => {
    const html = renderToStaticMarkup(createElement(SpeedBklit, { summary, projectId: pid }));
    const medians = tables(html)[1];
    expect(medians).toHaveLength(4);
    expect(medians[0]).toEqual(["1 Nov", expect.stringMatching(/ s$/), "30"]);
    expect(summary.metrics[0].daily.map((d) => d.reports)).toEqual([30, 30, 30, 30]);
  });

  it("a measurement nobody reported says so, and a thin day-by-day line is explained", () => {
    const thin = summariseVitals(rows.slice(0, 20).map((r, i) => ({ ...r, at: new Date(Date.UTC(2026, 10, 1 + i)) })));
    const html = renderToStaticMarkup(createElement(SpeedBklit, { summary: thin, projectId: pid }));
    expect(text(html)).toContain("Not enough reports per day to draw a line. A day needs at least 10 reports.");
    expect(text(html)).toContain("Not enough data");
    // INP was never reported, so its histogram is an empty message.
    expect(text(html)).toContain("No reports of this measurement yet.");
  });

  it("with no reports at all, says so and draws nothing", () => {
    const html = renderToStaticMarkup(createElement(SpeedBklit, { summary: summariseVitals([]), projectId: pid }));
    expect(text(html)).toContain("No speed measurements yet.");
    expect(html).not.toContain('role="img"');
  });
});

describe("Retention", () => {
  const base = {
    visitorsThisWeek: 262,
    minimum: 20,
    week: { cohort: 53, returned: 44, percent: 83, enough: true },
    month: { cohort: 0, returned: 0, percent: null, enough: false },
    daily: [
      { day: "2026-11-01", newVisitors: 5, returning: 20 },
      { day: "2026-11-02", newVisitors: 10, returning: 30 },
    ],
  };

  it("cohort bars name the size of each cohort and the rate", () => {
    const html = renderToStaticMarkup(createElement(RetentionBklit, { summary: base, projectId: pid }));
    expect(text(html)).toContain("262 visitors in the last 7 days.");
    expect(text(html)).toContain("Back within 7 days: 83% of 53 visitors came back.");
    expect(text(html)).toContain("Back within 30 days: not enough visitors (0 of the 20 needed).");
    expect(tables(html)[0]).toEqual([
      ["Back within 7 days", "53", "44", "83%"],
      ["Back within 30 days", "0", "0", "Not enough data"],
    ]);
  });

  it("new against returning per day has the same numbers", () => {
    const html = renderToStaticMarkup(createElement(RetentionBklit, { summary: base, projectId: pid }));
    expect(tables(html)[1]).toEqual([["1 Nov", "5", "20"], ["2 Nov", "10", "30"]]);
    expect(text(html)).toContain("Highest: 2 Nov, 40 visitors. Lowest: 1 Nov, 25 visitors. New: 15. Returning: 50.");
    expect(text(html)).toContain("New visitors");
    expect(text(html)).toContain("Returning visitors");
  });

  it("with no cohort big enough and no visitors, says so instead of drawing", () => {
    const html = renderToStaticMarkup(
      createElement(RetentionBklit, {
        summary: {
          ...base,
          week: { cohort: 3, returned: 1, percent: null, enough: false },
          daily: base.daily.map((d) => ({ ...d, newVisitors: 0, returning: 0 })),
        },
        projectId: pid,
      }),
    );
    expect(text(html)).toContain("Not enough visitors yet for a return rate.");
    expect(text(html)).toContain("No visitors with a retention id in the last 30 days.");
    expect(html).not.toContain('role="img"');
    expect(html).not.toContain("<table");
  });
});

describe("Page views and visitors", () => {
  it("has an Export menu that names the card when it knows the project", () => {
    const html = renderToStaticMarkup(createElement(AnalyticsChartBklit, { daily: [{ day: "2026-11-01", views: 1, visitors: 1 }], projectId: pid }));
    expect(html).toContain('aria-label="Export Page views per day"');
    expectFrame(html, "Page views per day");
  });
});
