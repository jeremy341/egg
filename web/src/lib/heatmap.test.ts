import { describe, expect, it } from "vitest";
import {
  buildHeatmap,
  countByDay,
  describeHeatmap,
  HEATMAP_DAYS,
  levelFor,
  mergeCounts,
  toWeeks,
  utcDayKey,
  windowKeys,
  windowStartMs,
} from "@/lib/heatmap";

// 2026-11-24 15:30 UTC (a Tuesday)
const NOW = Date.UTC(2026, 10, 24, 15, 30);

describe("window", () => {
  it("has 365 UTC days ending on today, oldest first", () => {
    const keys = windowKeys(NOW);
    expect(keys).toHaveLength(HEATMAP_DAYS);
    expect(keys[0]).toBe("2025-11-25");
    expect(keys[keys.length - 1]).toBe("2026-11-24");
  });

  it("starts at midnight UTC, not at the current hour", () => {
    expect(windowStartMs(NOW)).toBe(Date.UTC(2025, 10, 25));
  });

  it("keys days by UTC even late in the evening", () => {
    expect(utcDayKey(Date.UTC(2026, 10, 23, 23, 30))).toBe("2026-11-23");
  });
});

describe("countByDay", () => {
  it("buckets timestamps by UTC day and ignores days outside the window", () => {
    const times = [
      Date.UTC(2026, 10, 24, 0, 0),
      Date.UTC(2026, 10, 24, 23, 59),
      Date.UTC(2026, 10, 23, 12, 0),
      Date.UTC(2025, 10, 24, 12, 0), // the day before the window
      Date.UTC(2026, 10, 25, 0, 0), // after today
      Number.NaN,
    ];
    expect(countByDay(times, NOW)).toEqual({ "2026-11-24": 2, "2026-11-23": 1 });
  });

  it("includes the first day of the window", () => {
    expect(countByDay([Date.UTC(2025, 10, 25, 8)], NOW)).toEqual({ "2025-11-25": 1 });
  });
});

describe("mergeCounts", () => {
  it("adds per-day counts and drops zero or negative values", () => {
    expect(mergeCounts({ a: 1, b: 2 }, { a: 3, c: 0 }, { c: -1 })).toEqual({ a: 4, b: 2 });
  });
});

describe("levelFor", () => {
  it("is 0 for nothing and 4 for the busiest day", () => {
    expect(levelFor(0, 10)).toBe(0);
    expect(levelFor(10, 10)).toBe(4);
  });

  it("spreads counts over levels 1 to 4 relative to the busiest day", () => {
    expect([1, 3, 5, 7, 9].map((c) => levelFor(c, 10))).toEqual([1, 2, 2, 3, 4]);
  });

  it("is 0 when there is no busiest day", () => {
    expect(levelFor(3, 0)).toBe(0);
  });
});

describe("buildHeatmap", () => {
  it("returns one cell per day with counts and levels", () => {
    const heat = buildHeatmap({ "2026-11-24": 4, "2026-11-20": 1, "2025-01-01": 99 }, NOW);
    expect(heat.cells).toHaveLength(365);
    expect(heat.cells.at(-1)).toEqual({ date: "2026-11-24", count: 4, level: 4 });
    expect(heat.cells.find((c) => c.date === "2026-11-20")).toEqual({ date: "2026-11-20", count: 1, level: 1 });
    expect(heat.total).toBe(5);
    expect(heat.activeDays).toBe(2);
    expect(heat.busiest).toEqual({ date: "2026-11-24", count: 4 });
  });

  it("reports an empty window without a busiest day", () => {
    const heat = buildHeatmap({}, NOW);
    expect(heat).toMatchObject({ total: 0, activeDays: 0, busiest: null });
    expect(heat.cells.every((c) => c.level === 0)).toBe(true);
  });

  it("keeps the earlier day when two days tie for busiest", () => {
    const heat = buildHeatmap({ "2026-11-01": 2, "2026-11-02": 2 }, NOW);
    expect(heat.busiest).toEqual({ date: "2026-11-01", count: 2 });
  });
});

describe("toWeeks", () => {
  it("lays days out in Sunday-first columns with padding", () => {
    const weeks = toWeeks(buildHeatmap({}, NOW).cells);
    expect(weeks.every((w) => w.length === 7)).toBe(true);
    // 2025-11-25 is a Tuesday, so the first column has two empty slots first.
    const first = weeks[0]!;
    expect(first.slice(0, 2)).toEqual([null, null]);
    expect(first[2]?.date).toBe("2025-11-25");
    // 2026-11-24 is a Tuesday: the last real cell sits in the Tuesday row of the final week.
    const last = weeks[weeks.length - 1]!;
    expect(last[2]?.date).toBe("2026-11-24");
    expect(weeks.flat().filter((c) => c !== null)).toHaveLength(365);
  });

  it("returns no weeks for no cells", () => {
    expect(toWeeks([])).toEqual([]);
  });
});

describe("describeHeatmap", () => {
  it("states totals and the busiest day in words", () => {
    const heat = buildHeatmap({ "2026-11-24": 4, "2026-11-20": 1 }, NOW);
    expect(describeHeatmap(heat, "project")).toBe(
      "5 events of project activity on 2 days in the last 365 days. Busiest day: 2026-11-24, 4 events."
    );
  });

  it("says so when there is nothing", () => {
    expect(describeHeatmap(buildHeatmap({}, NOW), "account")).toBe("No account activity in the last 365 days.");
  });

  it("uses singular forms for one event on one day", () => {
    const heat = buildHeatmap({ "2026-11-24": 1 }, NOW);
    expect(describeHeatmap(heat, "project")).toBe(
      "1 event of project activity on 1 day in the last 365 days. Busiest day: 2026-11-24, 1 event."
    );
  });
});
