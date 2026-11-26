import { renderToReadableStream } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ANALYTICS_TABS, parseTab } from "@/lib/analytics-tabs";

// The data the page reads, faked once so every render gets the same fixture.
const calls = vi.hoisted(() => {
  const spy = (value: unknown) => vi.fn(async () => value);
  return {
    analyticsSummary: spy({
      views: 5250,
      visitors: 4000,
      daily: [
        { day: "2026-11-01", views: 1200, visitors: 900 },
        { day: "2026-11-03", views: 4050, visitors: 3100 },
      ],
      pages: [{ path: "/", views: 5000 }],
      referrers: [{ host: "example.org", views: 12 }],
    }),
    campaignsSummary: spy({}),
    liveSummary: spy({}),
    retentionSummary: spy({}),
    speedSummary: spy({}),
    errorsSummary: spy({}),
    clicksSummary: spy({}),
    timeSummary: spy({}),
    eventsSummary: spy({}),
    funnelSummary: spy({}),
  };
});
/** The switches the page reads. A test changes them, and beforeEach puts them back. */
const state = vi.hoisted(() => ({ features: {} as Record<string, boolean> }));
const ALL_ON = {
  clicks: true, time: true, funnel: true, referrers: true, campaigns: true, vitals: true, events: true, live: true,
  retention: true, locations: false,
};

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("not found");
  },
  useRouter: () => ({ replace: () => {} }),
  usePathname: () => "/projects/demo/analytics",
}));
vi.mock("@/server/auth/current", () => ({ requireUser: async () => ({ id: "u1" }) }));
vi.mock("@/server/queries", () => ({
  projectViews: async () => [{ id: "p1", slug: "demo", name: "Demo", analyticsKey: "key" }],
}));
vi.mock("@/server/analytics", () => ({
  analyticsSummary: calls.analyticsSummary,
  campaignsSummary: calls.campaignsSummary,
  snippet: () => "<script></script>",
}));
vi.mock("@/server/analytics-config", () => ({
  getFeatures: async () => state.features,
}));
vi.mock("@/server/analytics-events", () => ({
  clicksSummary: calls.clicksSummary,
  eventsSummary: calls.eventsSummary,
  timeSummary: calls.timeSummary,
}));
vi.mock("@/server/analytics-funnel", () => ({ funnelSummary: calls.funnelSummary }));
vi.mock("@/server/analytics-retention", () => ({
  liveSummary: calls.liveSummary,
  retentionSummary: calls.retentionSummary,
}));
vi.mock("@/server/analytics-speed", () => ({ speedSummary: calls.speedSummary, errorsSummary: calls.errorsSummary }));
// Each card says which one it is, so a render shows which tab's content is on the page.
const marker = (name: string) => () => `[${name}]`;
vi.mock("@/components/analytics-live", () => ({ LiveCard: marker("live") }));
// The cards that need real summaries are marked the same way. The chart and the two ranked lists
// stay real, so "Top pages" still comes from the page.
vi.mock("@/components/analytics-bklit-cards", async (importActual) => ({
  ...(await importActual<typeof import("@/components/analytics-bklit-cards")>()),
  CampaignsBklit: marker("campaigns"),
  ErrorsBklit: marker("errors"),
  EventsBklit: marker("events"),
  RetentionBklit: marker("retention"),
  SpeedBklit: marker("speed"),
  ClicksBklit: marker("clicks"),
  FunnelBklit: marker("funnel"),
  TimeBklit: marker("time"),
}));
vi.mock("@/components/analytics-setup", () => ({ AnalyticsSetup: marker("snippet") }));
vi.mock("@/components/analytics-features", () => ({ AnalyticsFeatures: marker("switches") }));

type Page = (p: {
  params: Promise<{ slug: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) => React.ReactNode;

async function render(page: Page, tab?: string | string[]): Promise<string> {
  const searchParams = Promise.resolve(tab === undefined ? {} : { tab });
  const stream = await renderToReadableStream(page({ params: Promise.resolve({ slug: "demo" }), searchParams }) as never);
  await stream.allReady;
  return new Response(stream).text();
}

const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
const tabLabels = (html: string) =>
  [...html.matchAll(/<button[^>]*role="tab"[^>]*>(.*?)<\/button>/g)].map((m) => m[1].replace(/<[^>]+>/g, ""));

// What each tab shows, and what the other tabs show that it must not.
const CONTENT: Record<string, string[]> = {
  overview: ["[live]", "Page views", "5,250", "Top pages", "[campaigns]"],
  speed: ["[speed]", "[errors]"],
  events: ["[funnel]", "[time]", "[clicks]", "[events]"],
  visitors: ["[live]", "[retention]"],
  setup: ["[snippet]", "[switches]"],
};

beforeEach(() => {
  vi.clearAllMocks();
  state.features = { ...ALL_ON };
});

describe("parseTab", () => {
  it("falls back to overview for nothing or something unknown", () => {
    expect(parseTab(undefined)).toBe("overview");
    expect(parseTab("nope")).toBe("overview");
    expect(parseTab("")).toBe("overview");
    expect(parseTab(["speed", "setup"])).toBe("speed");
    expect(parseTab("SPEED")).toBe("overview");
  });
  it("knows every tab", () => {
    for (const t of ANALYTICS_TABS) expect(parseTab(t.value)).toBe(t.value);
  });
});

describe("analytics tabs", async () => {
  const page = (await import("./analytics/page")).default as Page;

  describe("the page", () => {
    it("an unknown ?tab= shows the overview", async () => {
      const html = await render(page, "nope");
      expect(html).toContain("Top pages");
      expect(text(html)).toContain("[live]");
      expect(html).toMatch(/role="tab"[^>]*aria-selected="true"[^>]*>Overview|aria-selected="true"[^>]*role="tab"[^>]*>Overview/);
    });

    for (const [tab, shows] of Object.entries(CONTENT)) {
      it(`?tab=${tab} shows only its own content`, async () => {
        const t = text(await render(page, tab));
        for (const s of shows) expect(t).toContain(s);
        const others = Object.entries(CONTENT)
          .filter(([k]) => k !== tab)
          .flatMap(([, v]) => v)
          .filter((s) => !shows.includes(s));
        for (const s of others) expect(t).not.toContain(s);
      });
    }

    it("the bar is a tablist of tabs with one tabpanel, the selected tab marked", async () => {
      const html = await render(page, "events");
      expect(html).toContain('role="tablist"');
      expect(html.match(/role="tab"/g)).toHaveLength(ANALYTICS_TABS.length);
      expect(html.match(/role="tabpanel"/g)).toHaveLength(1);
      expect(html.match(/aria-selected="true"/g)).toHaveLength(1);
      expect(html).toContain("aria-controls=");
      expect(html).toContain("aria-labelledby=");
    });

    it("reads only the selected tab's data", async () => {
      await render(page, "overview");
      expect(calls.analyticsSummary).toHaveBeenCalled();
      expect(calls.liveSummary).toHaveBeenCalled();
      for (const fn of [
        calls.speedSummary, calls.errorsSummary, calls.eventsSummary, calls.retentionSummary,
        calls.funnelSummary, calls.clicksSummary, calls.timeSummary,
      ]) {
        expect(fn).not.toHaveBeenCalled();
      }

      vi.clearAllMocks();
      await render(page, "speed");
      expect(calls.speedSummary).toHaveBeenCalled();
      expect(calls.errorsSummary).toHaveBeenCalled();
      for (const fn of [calls.analyticsSummary, calls.eventsSummary, calls.retentionSummary, calls.liveSummary]) {
        expect(fn).not.toHaveBeenCalled();
      }

      vi.clearAllMocks();
      await render(page, "setup");
      for (const fn of Object.values(calls)) expect(fn).not.toHaveBeenCalled();
    });
  });

  it("shows the same tab names in the same order on every tab", async () => {
    const want = ANALYTICS_TABS.map((t) => t.label);
    for (const tab of [undefined, "overview", "speed", "events", "visitors", "setup"]) {
      expect(tabLabels(await render(page, tab))).toEqual(want);
    }
    expect(want).toEqual(["Overview", "Speed and errors", "Events", "Visitors", "Setup"]);
  });

  describe("the campaigns card follows the Campaigns switch, not Referrers", () => {
    it("is on the overview, and its data is read, when Campaigns is on", async () => {
      const t = text(await render(page, "overview"));
      expect(t).toContain("[campaigns]");
      expect(calls.campaignsSummary).toHaveBeenCalled();
    });

    it("is left out, and its data is not read, when Campaigns is off but Referrers is on", async () => {
      state.features = { ...ALL_ON, campaigns: false };
      const t = text(await render(page, "overview"));
      expect(t).not.toContain("[campaigns]");
      expect(t).toContain("Where visitors came from");
      expect(calls.campaignsSummary).not.toHaveBeenCalled();
    });

    it("shows when Campaigns is on even with Referrers off", async () => {
      state.features = { ...ALL_ON, referrers: false };
      const t = text(await render(page, "overview"));
      expect(t).toContain("[campaigns]");
      expect(calls.campaignsSummary).toHaveBeenCalled();
    });
  });

  it("the overview shows the totals and carries no preview banner", async () => {
    const t = text(await render(page, "overview"));
    expect(t).not.toContain("Preview");
    for (const s of ["Page views", "5,250", "Visitors", "4,000", "Top pages", "Where visitors came from", "example.org"]) {
      expect(t).toContain(s);
    }
  });
});
