import { describe, expect, it } from "vitest";
import {
  compareWindows,
  p95,
  parseStoredCheck,
  restartsWithin,
  splitAroundReady,
  windowStats,
  type CheckSample,
  type WindowStats,
} from "@/server/deploy-regression";

const READY = new Date("2026-01-01T12:00:00Z");
const MIN = 60_000;

/** A calm window: n healthy checks, 100 ms each. */
function stats(over: Partial<WindowStats> = {}): WindowStats {
  return { samples: 15, p95Ms: 100, errorRate: 0, restarts: 0, ...over };
}

function sample(minutesFromReady: number, over: Partial<CheckSample> = {}): CheckSample {
  return { at: new Date(READY.getTime() + minutesFromReady * MIN), healthMs: 100, healthOk: true, restarts: 0, ...over };
}

describe("p95", () => {
  it("uses the nearest rank and handles empty input", () => {
    expect(p95([])).toBeNull();
    expect(p95([10])).toBe(10);
    const hundred = Array.from({ length: 100 }, (_, i) => i + 1);
    expect(p95(hundred)).toBe(95);
    expect(p95([5, 1, 3])).toBe(5);
  });
});

describe("compareWindows", () => {
  it("is ok when the numbers hold steady", () => {
    expect(compareWindows(stats(), stats({ p95Ms: 105 })).verdict).toBe("ok");
  });

  it("flags a P95 rise only when it is both 25% and 50 ms", () => {
    // 25% of 100 is 25, but only 30 ms: not enough in absolute terms.
    expect(compareWindows(stats({ p95Ms: 100 }), stats({ p95Ms: 130 })).verdict).toBe("ok");
    // 50 ms, but 50% of 100 is also 50 ms: the rise is at least 25% and at least 50 ms.
    const r = compareWindows(stats({ p95Ms: 100 }), stats({ p95Ms: 150 }));
    expect(r.verdict).toBe("regressed");
    expect(r.reasons[0]).toContain("P95 latency rose from 100 ms to 150 ms");
  });

  it("does not flag a 60 ms rise on a slow app that is only 10% slower", () => {
    // 60 ms is over 50, but 60 is only 10% of 600.
    expect(compareWindows(stats({ p95Ms: 600 }), stats({ p95Ms: 660 })).verdict).toBe("ok");
  });

  it("flags an error rate that doubles and rises by at least half a point", () => {
    const r = compareWindows(stats({ errorRate: 0.01 }), stats({ errorRate: 0.02 }));
    // Doubled, but the rise is only 1 point, which is above 0.5: regressed.
    expect(r.verdict).toBe("regressed");
    expect(r.reasons.join(" ")).toContain("Error rate rose from 1% to 2%");
  });

  it("does not flag a doubling that is under half a point", () => {
    expect(compareWindows(stats({ errorRate: 0.001 }), stats({ errorRate: 0.003 })).verdict).toBe("ok");
  });

  it("does not flag a rise that is over half a point but not a doubling", () => {
    expect(compareWindows(stats({ errorRate: 0.1 }), stats({ errorRate: 0.11 })).verdict).toBe("ok");
  });

  it("flags two restarts after the deploy, and not one", () => {
    expect(compareWindows(stats(), stats({ restarts: 1 })).verdict).toBe("ok");
    const r = compareWindows(stats(), stats({ restarts: 2 }));
    expect(r.verdict).toBe("regressed");
    expect(r.reasons).toEqual(["The service restarted 2 times after the deploy."]);
  });

  it("reports every threshold crossed at once", () => {
    const r = compareWindows(stats({ p95Ms: 100, errorRate: 0 }), stats({ p95Ms: 300, errorRate: 0.2, restarts: 3 }));
    expect(r.verdict).toBe("regressed");
    expect(r.reasons).toHaveLength(3);
  });

  it("says insufficient data, never ok, when either side has too few checks", () => {
    expect(compareWindows(stats({ samples: 4 }), stats({ p95Ms: 900 })).verdict).toBe("insufficient_data");
    expect(compareWindows(stats(), stats({ samples: 0, p95Ms: 900 })).verdict).toBe("insufficient_data");
  });

  it("does not compare a P95 it does not have", () => {
    expect(compareWindows(stats({ p95Ms: null }), stats({ p95Ms: 900 })).verdict).toBe("ok");
  });
});

describe("windowStats", () => {
  it("computes P95, error rate and restarts from raw checks", () => {
    const samples: CheckSample[] = [
      sample(-14, { healthMs: 100, healthOk: true, restarts: 4 }),
      sample(-10, { healthMs: 200, healthOk: false, restarts: 4 }),
      sample(-5, { healthMs: null, healthOk: null, restarts: 5 }),
      sample(-1, { healthMs: 300, healthOk: true, restarts: 7 }),
    ];
    const s = windowStats(samples);
    expect(s.samples).toBe(4);
    expect(s.p95Ms).toBe(300);
    // One failure out of three checks that were made.
    expect(s.errorRate).toBeCloseTo(1 / 3);
    // 4 -> 4 (0), 4 -> 5 (+1), 5 -> 7 (+2).
    expect(s.restarts).toBe(3);
  });

  it("reports no error rate when no check was made", () => {
    expect(windowStats([sample(1, { healthOk: null, healthMs: null })]).errorRate).toBeNull();
  });
});

describe("restartsWithin", () => {
  it("ignores counter resets from a new service", () => {
    const samples = [sample(1, { restarts: 9 }), sample(2, { restarts: 0 }), sample(3, { restarts: 1 })];
    expect(restartsWithin(samples)).toBe(1);
  });

  it("reads the counter in time order, not list order", () => {
    const samples = [sample(3, { restarts: 2 }), sample(1, { restarts: 0 })];
    expect(restartsWithin(samples)).toBe(2);
  });
});

describe("splitAroundReady", () => {
  it("puts the 15 minutes before and after the ready moment in separate windows", () => {
    const all = [sample(-16), sample(-15), sample(-1), sample(0), sample(1), sample(15), sample(16)];
    const { before, after } = splitAroundReady(all, READY);
    // -15 is in the window; -16 is not; the exact ready moment belongs to neither side.
    expect(before.map((s) => s.at.getTime() - READY.getTime())).toEqual([-15 * MIN, -1 * MIN]);
    expect(after.map((s) => s.at.getTime() - READY.getTime())).toEqual([1 * MIN, 15 * MIN]);
  });
});

describe("parseStoredCheck", () => {
  it("returns null for nothing or for text that is not a check", () => {
    expect(parseStoredCheck(null)).toBeNull();
    expect(parseStoredCheck("not json")).toBeNull();
  });

  it("reads back a stored comparison", () => {
    const text = JSON.stringify({ verdict: "ok", reasons: [], before: stats(), after: stats(), readyAt: "x", checkedAt: "y" });
    expect(parseStoredCheck(text)?.verdict).toBe("ok");
  });
});
