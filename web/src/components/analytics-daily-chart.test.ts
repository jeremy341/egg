import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AnalyticsChartBklit } from "./analytics-bklit-cards";

const daily = [
  { day: "2026-11-01", views: 1200, visitors: 900 },
  { day: "2026-11-02", views: 0, visitors: 0 },
  { day: "2026-11-03", views: 4050, visitors: 3100 },
  { day: "2026-11-04", views: 7, visitors: 6 },
];

const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
/** The text of every body row of the first table. */
const rowsOf = (html: string) => {
  const body = /<tbody>([\s\S]*?)<\/tbody>/.exec(html)?.[1] ?? "";
  return [...body.matchAll(/<tr>([\s\S]*?)<\/tr>/g)].map((r) => [...r[1].matchAll(/<t[hd][^>]*>([^<]*)<\/t[hd]>/g)].map((c) => c[1]));
};

describe("AnalyticsChartBklit", () => {
  const html = renderToStaticMarkup(createElement(AnalyticsChartBklit, { daily }));

  it("has a visible title", () => {
    expect(html).toMatch(/<h2[^>]*>Page views per day<\/h2>/);
  });

  it("labels the chart for screen readers and describes it with the summary", () => {
    expect(html).toMatch(/role="img"[^>]*aria-label="Area chart of page views and line chart of visitors for each of the last 4 days, 1 Nov to 4 Nov\."/);
    expect(html).toMatch(/aria-describedby="([^"]+)"/);
    const id = /aria-describedby="([^"]+)"/.exec(html)![1];
    expect(html).toContain(`id="${id}"`);
  });

  it("states the highest and the lowest day in words", () => {
    expect(text(html)).toContain("Highest: 3 Nov, 4,050 views. Lowest: 2 Nov, 0 views.");
  });

  it("gives keyboard and screen reader users every number in a table", () => {
    expect(html).toContain("<caption");
    expect(html).toContain('class="sr-only focus-within:not-sr-only');
    expect(html).toContain('tabindex="0"');
    expect(rowsOf(html)).toEqual([
      ["1 Nov", "1,200", "900"],
      ["2 Nov", "0", "0"],
      ["3 Nov", "4,050", "3,100"],
      ["4 Nov", "7", "6"],
    ]);
  });

  it("names the busiest day with its number, and says which series the line is", () => {
    expect(text(html)).toContain("Highest: 3 Nov, 4,050 views");
    expect(text(html)).toContain("The line is visitors.");
    expect(text(html)).toContain("Page views");
    expect(text(html)).toContain("Visitors");
  });

  it("uses the Egg tokens for colour, set on the chart wrapper", () => {
    expect(html).toContain("--chart-line-primary:var(--primary)");
    expect(html).toContain("--chart-grid:var(--border)");
    expect(html).toContain("--chart-tooltip-background:var(--card)");
  });

  it("with no days, draws no chart and an empty table", () => {
    const empty = renderToStaticMarkup(createElement(AnalyticsChartBklit, { daily: [] }));
    expect(empty).not.toContain('role="img"');
    expect(text(empty)).toContain("No days to show.");
    expect(empty).not.toContain("<tbody>");
  });

  it("with one day, draws no line but keeps the text and the table", () => {
    const one = renderToStaticMarkup(
      createElement(AnalyticsChartBklit, { daily: [{ day: "2026-11-04", views: 1, visitors: 1 }] }),
    );
    expect(one).not.toContain('role="img"');
    expect(text(one)).toContain("4 Nov: 1 view.");
    expect(rowsOf(one)).toEqual([["4 Nov", "1", "1"]]);
  });
});
