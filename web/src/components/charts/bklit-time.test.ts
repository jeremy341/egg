import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ProjectResources } from "@/components/project-resources";
import { ResourceChart } from "@/components/resource-chart";
import { ResourceTrend } from "@/components/resource-trend";
import { gapThreshold, hourly, readingStats, readings, withGaps, type TimePoint } from "./bklit-time";

const MIN = 60_000;
const T0 = Date.UTC(2026, 10, 4, 12, 0);
const every5 = (values: (number | null)[], from = T0): TimePoint[] => values.map((value, i) => ({ at: from + i * 5 * MIN, value }));

const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

describe("readings", () => {
  it("keeps the samples that have a value, in order, and drops none of them", () => {
    const points = every5([0.2, null, 0.4, 0.3]);
    expect(readings(points).map((p) => p.value)).toEqual([0.2, 0.4, 0.3]);
    expect(readings(points).map((p) => p.at)).toEqual([T0, T0 + 10 * MIN, T0 + 15 * MIN]);
  });
});

describe("withGaps", () => {
  it("adds nothing when readings are evenly spaced", () => {
    const rows = withGaps(every5([0.1, 0.2, 0.3, 0.4]));
    expect(rows).toHaveLength(4);
    expect(rows.every((r) => r.value !== null)).toBe(true);
  });

  it("brackets a gap with two empty rows that mark the stretch, and leaves every reading as it was", () => {
    const before = every5([0.1, 0.2, 0.3]);
    const after = every5([0.5, 0.6], T0 + 10 * 5 * MIN);
    const rows = withGaps([...before, ...after]);
    expect(rows.map((r) => r.value)).toEqual([0.1, 0.2, 0.3, null, null, 0.5, 0.6]);
    expect(rows.map((r) => r.band)).toEqual([null, null, null, 1, 1, null, null]);
    expect(rows[3].at).toBeGreaterThan(before[2].at);
    expect(rows[4].at).toBeLessThan(after[0].at);
    expect(rows.filter((r) => r.value !== null)).toEqual([...before, ...after].map((p) => ({ ...p, band: null })));
  });

  it("does not call a single missed reading a gap: the line breaks only past three times the usual spacing", () => {
    // 5, 5, 10 (one missed), 5: the 10 is under 3 x 5 and under the 15 minute floor.
    const points: TimePoint[] = [0, 5, 10, 20, 25].map((m, i) => ({ at: T0 + m * MIN, value: i / 10 }));
    expect(gapThreshold(readings(points))).toBe(15 * MIN);
    expect(withGaps(points)).toHaveLength(5);
  });

  it("is empty for no readings and a single row for one", () => {
    expect(withGaps([])).toEqual([]);
    expect(withGaps(every5([null, null]))).toEqual([]);
    expect(withGaps(every5([0.4]))).toEqual([{ at: T0, value: 0.4, band: null }]);
  });
});

describe("readingStats and hourly", () => {
  it("gives the lowest, the average, the peak and the newest reading", () => {
    expect(readingStats(readings(every5([0.2, 0.6, 0.4])))).toEqual({ low: 0.2, average: (0.2 + 0.6 + 0.4) / 3, peak: 0.6, latest: 0.4 });
    expect(readingStats([])).toBeNull();
  });

  it("groups readings by clock hour, counts them, and has no row for an hour with none", () => {
    const points = [...every5([0.1, 0.3]), ...every5([0.9], T0 + 180 * MIN)];
    const rows = hourly(readings(points));
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ at: T0, low: 0.1, peak: 0.3, readings: 2 });
    expect(rows[1]).toMatchObject({ at: T0 + 180 * MIN, low: 0.9, peak: 0.9, readings: 1 });
    expect(rows.reduce((n, r) => n + r.readings, 0)).toBe(3);
  });
});

describe("ResourceChart", () => {
  const points = every5([0.2, 0.5, 0.35, 0.8]);
  const html = renderToStaticMarkup(
    createElement(ResourceChart, { title: "Memory", now: "1.2 / 2.0 GB", detail: "2.0 GB available", points, rangeLabel: "24 hours" }),
  );

  it("has a heading, the current reading, and the lowest, average and peak as text", () => {
    expect(html).toMatch(/<h2[^>]*>Memory<\/h2>/);
    expect(text(html)).toContain("1.2 / 2.0 GB");
    expect(text(html)).toContain("Lowest 20%");
    expect(text(html)).toContain("Average 46%");
    expect(text(html)).toContain("Peak 80%");
  });

  it("labels the picture with the same three figures", () => {
    expect(html).toContain(
      'role="img" aria-label="Area chart of Memory over the last 24 hours: lowest 20%, average 46%, peak 80% of the limit."',
    );
  });

  it("takes its colours from the theme tokens", () => {
    expect(html).toContain("--chart-line-primary:var(--primary)");
    expect(html).toContain("--chart-grid:var(--border)");
  });

  it("says so instead of drawing when there are fewer than two readings", () => {
    const one = renderToStaticMarkup(
      createElement(ResourceChart, { title: "Disk", now: null, points: every5([0.4]), rangeLabel: "7 days" }),
    );
    expect(one).not.toContain('role="img"');
    expect(text(one)).toContain("No reading");
    expect(text(one)).toContain("No line yet. The worker takes a reading every five minutes and a line needs two.");
  });
});

describe("ResourceTrend", () => {
  it("is a labelled picture, and nothing at all with fewer than two readings", () => {
    const html = renderToStaticMarkup(createElement(ResourceTrend, { points: every5([10, 30, 20]), label: "api memory, peak 30 megabytes" }));
    expect(html).toContain('role="img" aria-label="api memory, peak 30 megabytes"');
    expect(renderToStaticMarkup(createElement(ResourceTrend, { points: every5([10]), label: "x" }))).toBe("");
  });
});

describe("ProjectResources", () => {
  const at = (i: number) => T0 + i * 5 * MIN;

  it("names the newest reading and the peak of memory and CPU in words", () => {
    const html = renderToStaticMarkup(
      createElement(ProjectResources, {
        points: [
          { at: at(0), memMb: 120, cpuPercent: 2.5 },
          { at: at(1), memMb: 180, cpuPercent: 14 },
          { at: at(2), memMb: 150, cpuPercent: 4 },
        ],
      }),
    );
    expect(text(html)).toContain("150 MB now, peak 180 MB");
    expect(text(html)).toContain("4.0% now, peak 14.0%");
    expect(html).toContain('aria-label="Area chart of memory over the last 24 hours, peak 180 MB."');
    expect(html).toContain('aria-label="Area chart of CPU over the last 24 hours, peak 14.0% of one core."');
  });

  it("says it is still collecting when neither measurement has two readings", () => {
    const html = renderToStaticMarkup(createElement(ProjectResources, { points: [{ at: at(0), memMb: 120, cpuPercent: null }] }));
    expect(text(html)).toContain("Collecting data.");
    expect(html).not.toContain('role="img"');
  });
});
