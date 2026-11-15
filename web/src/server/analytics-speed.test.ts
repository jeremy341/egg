import { describe, expect, it } from "vitest";
import { lastDays } from "@/server/analytics-events";
import { MIN_DAILY_REPORTS } from "@/server/analytics-fields";
import { splitReturning } from "@/server/analytics-retention";
import { bandShares, summariseVitals, type VitalRow } from "@/server/analytics-speed";

const row = (day: string, lcp: number | null, extra: Partial<VitalRow> = {}): VitalRow => ({
  at: new Date(`${day}T12:00:00Z`),
  lcp,
  cls: null,
  inp: null,
  fcp: null,
  ttfb: null,
  ...extra,
});

describe("summariseVitals bands", () => {
  // Thresholds for LCP: good up to 2500, poor over 4000. A value on a threshold is in the lower band.
  const values = [100, 2500, 2501, 4000, 4001, 9000];
  const lcp = (rows: VitalRow[]) => summariseVitals(rows).metrics.find((m) => m.metric === "lcp")!;

  it("puts each report in the good, needs-work or poor band by the thresholds", () => {
    const m = lcp(values.map((v) => row("2026-11-01", v)));
    expect(m.bands.map((b) => [b.rating, b.reports])).toEqual([["good", 2], ["needs-work", 2], ["poor", 2]]);
    expect(m.bands.map((b) => b.label)).toEqual(["Good", "Needs work", "Poor"]);
  });

  it("keeps the counts but withholds the shares below the minimum sample", () => {
    const m = lcp(values.map((v) => row("2026-11-01", v)));
    expect(m.samples).toBe(6);
    expect(m.bands.every((b) => b.percent === null)).toBe(true);
  });

  it("shows shares from the minimum sample, and they follow the counts", () => {
    const m = lcp(Array.from({ length: 50 }, (_, i) => row("2026-11-01", i < 30 ? 1000 : i < 45 ? 3000 : 5000)));
    expect(m.bands.map((b) => b.percent)).toEqual([60, 30, 10]);
  });

  it("only counts reports that include the metric", () => {
    const m = lcp([row("2026-11-01", 1000), row("2026-11-01", null)]);
    expect(m.samples).toBe(1);
    expect(m.bands.reduce((n, b) => n + b.reports, 0)).toBe(1);
  });

  it("never rounds a share to 100 while another band has reports, or to 0 while its own has", () => {
    expect(bandShares([999, 1, 0])).toEqual([99, 1, 0]);
    expect(bandShares([0, 0, 0])).toEqual([0, 0, 0]);
    expect(bandShares([5, 0, 0])).toEqual([100, 0, 0]);
  });
});

describe("summariseVitals day by day", () => {
  it("lists the median of a day only when it has at least the minimum number of reports", () => {
    const rows = [
      ...Array.from({ length: MIN_DAILY_REPORTS }, (_, i) => row("2026-11-02", 1000 + i * 100)),
      ...Array.from({ length: MIN_DAILY_REPORTS - 1 }, () => row("2026-11-01", 9999)),
    ];
    const m = summariseVitals(rows).metrics.find((x) => x.metric === "lcp")!;
    expect(m.daily).toEqual([{ day: "2026-11-02", median: 1450, reports: MIN_DAILY_REPORTS }]);
  });

  it("is oldest first and leaves out rows without a time", () => {
    const rows = [
      ...Array.from({ length: MIN_DAILY_REPORTS }, () => row("2026-11-03", 1)),
      ...Array.from({ length: MIN_DAILY_REPORTS }, () => row("2026-11-01", 2)),
      ...Array.from({ length: 50 }, () => ({ lcp: 3, cls: null, inp: null, fcp: null, ttfb: null })),
    ];
    const m = summariseVitals(rows).metrics.find((x) => x.metric === "lcp")!;
    expect(m.daily.map((d) => d.day)).toEqual(["2026-11-01", "2026-11-03"]);
  });
});

describe("lastDays", () => {
  it("lists every UTC day of the window, oldest first, ending today", () => {
    expect(lastDays(3, new Date("2026-11-05T23:59:00Z"))).toEqual(["2026-11-03", "2026-11-04", "2026-11-05"]);
    expect(lastDays(30, new Date("2026-11-05T00:00:00Z"))).toHaveLength(30);
  });
});

describe("splitReturning", () => {
  const days = ["2026-11-01", "2026-11-02", "2026-11-03"];
  const first = new Map([["a", "2026-11-01"], ["b", "2026-11-02"], ["c", "2026-10-01"]]);

  it("counts a visitor as new on the first stored day and returning on every later one", () => {
    const perDay = [
      { vid: "a", day: "2026-11-01" },
      { vid: "a", day: "2026-11-02" },
      { vid: "b", day: "2026-11-02" },
      { vid: "c", day: "2026-11-02" },
      { vid: "a", day: "2026-11-03" },
    ];
    expect(splitReturning(days, perDay, first)).toEqual([
      { day: "2026-11-01", newVisitors: 1, returning: 0 },
      { day: "2026-11-02", newVisitors: 1, returning: 2 },
      { day: "2026-11-03", newVisitors: 0, returning: 1 },
    ]);
  });

  it("keeps quiet days as zeros and ignores days outside the window", () => {
    expect(splitReturning(days, [{ vid: "a", day: "2026-12-01" }], first).every((d) => d.newVisitors + d.returning === 0)).toBe(true);
  });
});
