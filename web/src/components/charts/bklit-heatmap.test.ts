import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BklitHeatmap } from "./bklit-heatmap";

const calendar = [
  { day: "2026-11-12", count: 3 },
  { day: "2026-11-13", count: 0 },
  { day: "2026-11-14", count: null },
];
const grid = [
  { weekday: 1, hour: 9, count: 12 },
  { weekday: 6, hour: 23, count: 0 },
];

const html = (props: Parameters<typeof BklitHeatmap>[0]) => renderToStaticMarkup(createElement(BklitHeatmap, props));

describe("BklitHeatmap", () => {
  it("renders the calendar with the theme variables and the Less to More key", () => {
    const out = html({ variant: "calendar", days: calendar });
    expect(out).toContain("--chart-line-primary:var(--primary)");
    expect(out).toContain("Less");
    expect(out).toContain("More");
    // the five levels, all from the theme variables
    for (const v of ["--chart-heat-0", "--chart-scale-02", "--chart-scale-03", "--chart-scale-04", "--chart-scale-05"]) {
      expect(out).toContain(`var(${v})`);
    }
  });

  it("renders the weekday-by-hour grid too", () => {
    const out = html({ variant: "weekday-hour", cells: grid, weekStart: 0 });
    expect(out).toContain("--chart-line-primary:var(--primary)");
    expect(out).toContain("Less");
  });

  it("can leave the key out", () => {
    expect(html({ variant: "calendar", days: calendar, legend: false })).not.toContain("Less");
  });

  it("draws no colour of its own", () => {
    for (const out of [html({ variant: "calendar", days: calendar }), html({ variant: "weekday-hour", cells: grid })]) {
      expect(out).not.toMatch(/#[0-9a-fA-F]{3,8}["s;]/);
      expect(out).not.toMatch(/rgba?\(|hsla?\(/);
    }
  });

  it("draws nothing when there is no day or no cell to draw", () => {
    expect(html({ variant: "calendar", days: [] })).toBe("");
    expect(html({ variant: "calendar", days: [{ day: "not a day", count: 1 }] })).toBe("");
    expect(html({ variant: "weekday-hour", cells: [] })).toBe("");
    expect(html({ variant: "weekday-hour", cells: [{ weekday: 9, hour: 9, count: 1 }] })).toBe("");
  });

  it("keeps a chart that is narrower than its cells scrollable instead of squeezing the cells", () => {
    expect(html({ variant: "weekday-hour", cells: grid })).toContain("overflow-x-auto");
  });
});
