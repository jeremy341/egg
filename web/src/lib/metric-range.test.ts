import { describe, expect, it } from "vitest";
import {
  bucketPoints,
  bucketStart,
  DEFAULT_METRIC_RANGE,
  metricRangeHours,
  parseMetricRange,
} from "./metric-range";

const MIN = 60_000;

describe("parseMetricRange", () => {
  it("accepts the four ranges and falls back to 24 hours", () => {
    expect(parseMetricRange("5m")).toBe("5m");
    expect(parseMetricRange("1h")).toBe("1h");
    expect(parseMetricRange("24h")).toBe("24h");
    expect(parseMetricRange("7d")).toBe("7d");
    expect(parseMetricRange("30d")).toBe(DEFAULT_METRIC_RANGE);
    expect(parseMetricRange(null)).toBe("24h");
    expect(parseMetricRange("")).toBe("24h");
  });
});

describe("metricRangeHours", () => {
  it("converts each window to hours", () => {
    expect(metricRangeHours("5m")).toBeCloseTo(1 / 12);
    expect(metricRangeHours("1h")).toBe(1);
    expect(metricRangeHours("24h")).toBe(24);
    expect(metricRangeHours("7d")).toBe(168);
  });
});

describe("bucketStart", () => {
  it("aligns to the bucket size of each range", () => {
    const t = Date.UTC(2026, 0, 1, 10, 7, 33);
    expect(bucketStart(t, "5m")).toBe(Date.UTC(2026, 0, 1, 10, 7, 0));
    expect(bucketStart(t, "1h")).toBe(Date.UTC(2026, 0, 1, 10, 5, 0));
    expect(bucketStart(t, "24h")).toBe(Date.UTC(2026, 0, 1, 10, 0, 0));
    expect(bucketStart(t, "7d")).toBe(Date.UTC(2026, 0, 1, 10, 0, 0));
    expect(bucketStart(Date.UTC(2026, 0, 1, 10, 45, 0), "24h")).toBe(Date.UTC(2026, 0, 1, 10, 45, 0));
  });
});

describe("bucketPoints", () => {
  const now = Date.UTC(2026, 0, 1, 12, 0, 0);

  it("averages points that share a bucket", () => {
    const out = bucketPoints(
      [
        { at: now - 5 * MIN + 1000, memMb: 100, cpuPercent: 10 },
        { at: now - 5 * MIN + 30_000, memMb: 200, cpuPercent: 30 },
      ],
      "5m",
      now
    );
    expect(out).toHaveLength(1);
    expect(out[0].memMb).toBe(150);
    expect(out[0].cpuPercent).toBe(20);
  });

  it("drops points outside the window", () => {
    const out = bucketPoints(
      [
        { at: now - 6 * MIN, memMb: 1, cpuPercent: 1 },
        { at: now + MIN, memMb: 1, cpuPercent: 1 },
        { at: now - MIN, memMb: 9, cpuPercent: 9 },
      ],
      "5m",
      now
    );
    expect(out.map((p) => p.memMb)).toEqual([9]);
  });

  it("leaves a null out of the average and keeps an empty bucket null", () => {
    const out = bucketPoints(
      [
        { at: now - 2 * MIN, memMb: null, cpuPercent: 40 },
        { at: now - 2 * MIN + 5000, memMb: 50, cpuPercent: null },
      ],
      "1h",
      now
    );
    expect(out).toHaveLength(1);
    expect(out[0].memMb).toBe(50);
    expect(out[0].cpuPercent).toBe(40);
    const none = bucketPoints([{ at: now - MIN, memMb: null, cpuPercent: null }], "1h", now);
    expect(none[0]).toEqual({ at: bucketStart(now - MIN, "1h"), memMb: null, cpuPercent: null });
  });

  it("uses the coarser buckets for a 7-day view", () => {
    const out = bucketPoints(
      [
        { at: now - 2 * 3_600_000, memMb: 10, cpuPercent: null },
        { at: now - 2 * 3_600_000 + 20 * MIN, memMb: 30, cpuPercent: null },
        { at: now - 26 * 3_600_000, memMb: 70, cpuPercent: null },
      ],
      "7d",
      now
    );
    expect(out.map((p) => p.memMb)).toEqual([70, 20]);
    expect(out[1].at).toBe(bucketStart(now - 2 * 3_600_000, "7d"));
  });

  it("returns points sorted oldest first", () => {
    const out = bucketPoints(
      [
        { at: now - 1 * MIN, memMb: 2, cpuPercent: null },
        { at: now - 4 * MIN, memMb: 1, cpuPercent: null },
      ],
      "5m",
      now
    );
    expect(out.map((p) => p.memMb)).toEqual([1, 2]);
  });
});
