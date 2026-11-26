import { existsSync } from "node:fs";
import path from "node:path";
import { renderToReadableStream } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const daily = [
  { day: "2026-11-01", views: 1200, visitors: 900 },
  { day: "2026-11-02", views: 0, visitors: 0 },
  { day: "2026-11-03", views: 4050, visitors: 3100 },
];
const empty = [] as never[];

// The tab bar is a client component that reads the router, which does not exist in this render.
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
  analyticsSummary: async () => ({
    views: 5250,
    visitors: 4000,
    daily,
    pages: [{ path: "/", views: 5000 }],
    referrers: [{ host: "example.org", views: 12 }],
  }),
  campaignsSummary: async () => null,
  snippet: () => "<script></script>",
}));
vi.mock("@/server/analytics-config", () => ({
  getFeatures: async () => ({
    clicks: false, time: false, funnel: false, referrers: false, vitals: false, events: false, live: false, retention: false,
  }),
}));
vi.mock("@/server/analytics-events", () => ({ clicksSummary: async () => null, eventsSummary: async () => null, timeSummary: async () => null }));
vi.mock("@/server/analytics-funnel", () => ({ funnelSummary: async () => null }));
vi.mock("@/server/analytics-retention", () => ({ liveSummary: async () => null, retentionSummary: async () => empty }));
vi.mock("@/server/analytics-speed", () => ({ speedSummary: async () => null }));
// Client cards that talk to the server on their own. They are not what this test checks.
vi.mock("@/components/analytics-setup", () => ({ AnalyticsSetup: () => null }));
vi.mock("@/components/analytics-features", () => ({ AnalyticsFeatures: () => null }));

async function render(page: (p: { params: Promise<{ slug: string }> }) => React.ReactNode): Promise<string> {
  const stream = await renderToReadableStream(page({ params: Promise.resolve({ slug: "demo" }) }) as never);
  await stream.allReady;
  return new Response(stream).text();
}

const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

describe("the analytics page", async () => {
  const page = (await import("./page")).default;
  const html = await render(page);
  const t = text(html);

  it("is the only version: there is no preview route and no preview banner", () => {
    expect(existsSync(path.resolve(__dirname, "../analytics-bklit"))).toBe(false);
    expect(t).not.toContain("Preview");
    expect(t).not.toContain("Bklit");
  });

  it("shows the totals and the headline numbers", () => {
    for (const s of ["Page views", "5,250", "Visitors", "4,000", "Top pages", "Where visitors came from", "example.org"]) {
      expect(t).toContain(s);
    }
  });

  it("says the highest and the lowest day in words", () => {
    expect(t).toContain("Highest: 3 Nov, 4,050 views. Lowest: 2 Nov, 0 views.");
  });

  it("lists every day with the same numbers in the chart's table", () => {
    for (const row of ["1 Nov 1,200 900", "2 Nov 0 0", "3 Nov 4,050 3,100"]) expect(t).toContain(row);
  });

  it("gives every chart a text label, a summary it is described by, and a table the keyboard can reach", () => {
    const charts = [...html.matchAll(/role="img"[^>]*aria-label="([^"]+)"[^>]*aria-describedby="([^"]+)"/g)];
    expect(charts.length).toBeGreaterThanOrEqual(3);
    for (const [, label, id] of charts) {
      expect(label.length).toBeGreaterThan(10);
      expect(html).toContain(`id="${id}"`);
    }
    expect(html.match(/role="region"/g)!.length).toBeGreaterThanOrEqual(charts.length);
    expect(html).toContain('tabindex="0"');
  });

  it("colours its charts from the theme tokens", () => {
    expect(html).toContain("--chart-line-primary:var(--primary)");
    expect(html).toContain("--chart-grid:var(--border)");
  });
});
