import { describe, expect, it } from "vitest";
import {
  buildTimeByDay,
  deployCountByDay,
  deploySuccessByDay,
  enabledSeries,
  parseMetricsRange,
  visitorsByDay,
} from "@/lib/statistics-metrics";

// 2026-11-24 15:30 UTC
const NOW = Date.UTC(2026, 10, 24, 15, 30);
const DAY = 86_400_000;
const at = (daysAgo: number, hour = 12) => Date.UTC(2026, 10, 24 - daysAgo, hour);

describe("parseMetricsRange", () => {
  it("defaults to 30 days when the range is absent", () => {
    expect(parseMetricsRange(null)).toEqual({ range: "30d", days: 30 });
    expect(parseMetricsRange(undefined)).toEqual({ range: "30d", days: 30 });
  });

  it("accepts exactly 7d, 30d and 90d", () => {
    expect(parseMetricsRange("7d")).toEqual({ range: "7d", days: 7 });
    expect(parseMetricsRange("30d")).toEqual({ range: "30d", days: 30 });
    expect(parseMetricsRange("90d")).toEqual({ range: "90d", days: 90 });
  });

  it("refuses ranges outside the list, including ones that look close", () => {
    for (const raw of ["1d", "14d", "365d", "30", "30D", " 7d", "", "all", "__proto__", "constructor"]) {
      expect(parseMetricsRange(raw), raw).toBeNull();
    }
  });
});

describe("empty range", () => {
  it("gives one zero per day and no rates when there are no deploys", () => {
    const counts = deployCountByDay([], NOW, 7);
    expect(counts).toHaveLength(7);
    expect(counts.every((d) => d.count === 0)).toBe(true);
    expect(deploySuccessByDay([], NOW, 7).every((d) => d.percent === null)).toBe(true);
    expect(buildTimeByDay([], NOW, 7).every((d) => d.averageMs === null && d.builds === 0)).toBe(true);
    expect(visitorsByDay({}, NOW, 7).every((d) => d.visitors === 0)).toBe(true);
  });
});

describe("range limits", () => {
  it.each([7, 30, 90])("returns exactly %i days, oldest first, ending today", (days) => {
    const series = deployCountByDay([], NOW, days);
    expect(series).toHaveLength(days);
    expect(series[days - 1]!.date).toBe("2026-11-24");
    expect(series[0]!.date).toBe(new Date(Date.UTC(2026, 10, 24) - (days - 1) * DAY).toISOString().slice(0, 10));
  });

  it("leaves out deploys older than the range", () => {
    const series = deployCountByDay([{ createdAt: at(8), state: "ready" }], NOW, 7);
    expect(series.reduce((n, d) => n + d.count, 0)).toBe(0);
  });

  it("includes the first day of the range and not the day before it", () => {
    const series = deployCountByDay(
      [
        { createdAt: at(6), state: "ready" },
        { createdAt: at(7), state: "ready" },
      ],
      NOW,
      7
    );
    expect(series[0]).toEqual({ date: "2026-11-18", count: 1 });
    expect(series.reduce((n, d) => n + d.count, 0)).toBe(1);
  });
});

describe("days with no deploys", () => {
  it("counts zero on quiet days and keeps the busy day", () => {
    const series = deployCountByDay(
      [
        { createdAt: at(0, 1), state: "ready" },
        { createdAt: at(0, 2), state: "error" },
        { createdAt: at(3), state: "canceled" },
      ],
      NOW,
      7
    );
    // Nov 18 to Nov 24. Canceled deploys still count as deploys.
    expect(series.map((d) => d.count)).toEqual([0, 0, 0, 1, 0, 0, 2]);
  });

  it("gives null, not zero, for a success rate on a day with nothing finished", () => {
    const rates = deploySuccessByDay([{ createdAt: at(1), state: "ready" }], NOW, 7);
    expect(rates.find((d) => d.date === "2026-11-23")).toEqual({ date: "2026-11-23", percent: 100, finished: 1, succeeded: 1 });
    expect(rates.find((d) => d.date === "2026-11-22")).toEqual({ date: "2026-11-22", percent: null, finished: 0, succeeded: 0 });
  });
});

describe("success rate", () => {
  it("is 0 percent when a day has only failures", () => {
    const rates = deploySuccessByDay(
      [
        { createdAt: at(0, 1), state: "error" },
        { createdAt: at(0, 2), state: "error" },
        { createdAt: at(0, 3), state: "error" },
      ],
      NOW,
      7
    );
    expect(rates[6]).toEqual({ date: "2026-11-24", percent: 0, finished: 3, succeeded: 0 });
  });

  it("counts only ready and error as finished; canceled and running deploys are left out", () => {
    const rates = deploySuccessByDay(
      [
        { createdAt: at(0, 1), state: "ready" },
        { createdAt: at(0, 2), state: "error" },
        { createdAt: at(0, 3), state: "canceled" },
        { createdAt: at(0, 4), state: "building" },
        { createdAt: at(0, 5), state: "queued" },
      ],
      NOW,
      7
    );
    expect(rates[6]).toEqual({ date: "2026-11-24", percent: 50, finished: 2, succeeded: 1 });
  });

  it("rounds to a whole percent", () => {
    const rates = deploySuccessByDay(
      [
        { createdAt: at(0, 1), state: "ready" },
        { createdAt: at(0, 2), state: "ready" },
        { createdAt: at(0, 3), state: "error" },
      ],
      NOW,
      7
    );
    expect(rates[6]!.percent).toBe(67);
  });
});

describe("build time", () => {
  it("is the mean of completed builds, not the median", () => {
    // Three builds of 10, 20 and 60 seconds: the mean is 30 s, the median would be 20 s.
    const builds = buildTimeByDay(
      [
        { createdAt: at(0, 1), state: "ready", startedAt: at(0, 1), finishedAt: at(0, 1) + 10_000 },
        { createdAt: at(0, 2), state: "ready", startedAt: at(0, 2), finishedAt: at(0, 2) + 20_000 },
        { createdAt: at(0, 3), state: "error", startedAt: at(0, 3), finishedAt: at(0, 3) + 60_000 },
      ],
      NOW,
      7
    );
    expect(builds[6]).toEqual({ date: "2026-11-24", averageMs: 30_000, builds: 3 });
  });

  it("leaves out deploys that never started, never finished, or ran backwards", () => {
    const builds = buildTimeByDay(
      [
        { createdAt: at(0, 1), state: "ready", startedAt: null, finishedAt: at(0, 1) },
        { createdAt: at(0, 2), state: "ready", startedAt: at(0, 2), finishedAt: null },
        { createdAt: at(0, 3), state: "ready", startedAt: at(0, 3) + 5_000, finishedAt: at(0, 3) },
        { createdAt: at(0, 4), state: "canceled", startedAt: at(0, 4), finishedAt: at(0, 4) + 9_000 },
        { createdAt: at(0, 5), state: "ready", startedAt: at(0, 5), finishedAt: at(0, 5) + 4_000 },
      ],
      NOW,
      7
    );
    expect(builds[6]).toEqual({ date: "2026-11-24", averageMs: 4_000, builds: 1 });
  });
});

describe("visitors", () => {
  it("fills missing days with zero and keeps the counts that are there", () => {
    const series = visitorsByDay({ "2026-11-22": 4, "2026-11-24": 9 }, NOW, 7);
    expect(series).toHaveLength(7);
    expect(series.find((d) => d.date === "2026-11-22")!.visitors).toBe(4);
    expect(series.find((d) => d.date === "2026-11-23")!.visitors).toBe(0);
    expect(series[6]).toEqual({ date: "2026-11-24", visitors: 9 });
  });
});

describe("switches", () => {
  const computed = {
    deployCount: [{ date: "2026-11-24", count: 1 }],
    deploySuccess: [{ date: "2026-11-24", percent: 100, finished: 1, succeeded: 1 }],
    buildTime: [{ date: "2026-11-24", averageMs: 1000, builds: 1 }],
    visitors: [{ date: "2026-11-24", visitors: 2 }],
  };

  it("leaves out a statistic whose switch is off, rather than returning zeros", () => {
    const out = enabledSeries(
      { deployCount: true, deploySuccess: false, buildTime: false, visitors: true },
      computed
    );
    expect(Object.keys(out).sort()).toEqual(["deployCount", "visitors"]);
    expect(out).not.toHaveProperty("deploySuccess");
    expect(out).not.toHaveProperty("buildTime");
  });

  it("returns nothing when every switch is off", () => {
    expect(enabledSeries({ deployCount: false, deploySuccess: false, buildTime: false, visitors: false }, computed)).toEqual({});
  });

  it("returns nothing for a switch on whose series was never computed", () => {
    const out = enabledSeries({ deployCount: true, deploySuccess: true, buildTime: false, visitors: false }, { deployCount: computed.deployCount });
    expect(Object.keys(out)).toEqual(["deployCount"]);
  });
});
