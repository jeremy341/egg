import { describe, expect, it } from "vitest";
import { percentile, RIGHT_SIZE_MIN_DAYS, RIGHT_SIZE_WINDOW_DAYS, suggestRightSize, type RightSizeSample } from "@/server/right-size";

const DAY = 24 * 60 * 60 * 1000;
// Noon UTC on a fixed day, so every sample in a "day" falls on the same UTC date.
const DAY0 = Date.UTC(2026, 10, 1, 12);
const NOW = DAY0 + 3 * DAY;

function sample(dayOffset: number, memMb: number | null, cpuPercent: number | null, minute = 0): RightSizeSample {
  return { at: DAY0 + dayOffset * DAY + minute * 60_000, memMb, cpuPercent };
}

describe("percentile (nearest rank)", () => {
  it("picks the value at ceil(p * n) in an ascending list", () => {
    const list = Array.from({ length: 100 }, (_, i) => i + 1); // 1..100
    expect(percentile(list, 95)).toBe(95);
    expect(percentile(list, 99)).toBe(99);
    expect(percentile(list, 100)).toBe(100);
    expect(percentile([7], 99)).toBe(7);
  });

  it("returns null for an empty list", () => {
    expect(percentile([], 95)).toBeNull();
  });
});

describe("memory suggestion", () => {
  it("is 115% of the highest daily peak", () => {
    const s = [sample(0, 500, null), sample(1, 800, null), sample(2, 600, null)];
    const out = suggestRightSize(s, NOW);
    expect(out).toMatchObject({ status: "ok", memoryMb: 920, basis: { memoryPeakMb: 800 } });
  });

  it("uses the peak of a day, not the average", () => {
    const s = [sample(0, 100, null, 0), sample(0, 1000, null, 30), sample(1, 100, null), sample(2, 100, null)];
    expect(suggestRightSize(s, NOW)).toMatchObject({ memoryMb: 1150 });
  });

  it("is never below 128 MiB", () => {
    const s = [sample(0, 10, null), sample(1, 20, null), sample(2, 30, null)];
    expect(suggestRightSize(s, NOW)).toMatchObject({ memoryMb: 128 });
  });

  it("does not add a float error to a whole number: 200 MB gives 230", () => {
    const s = [sample(0, 200, null), sample(1, 200, null), sample(2, 200, null)];
    expect(suggestRightSize(s, NOW)).toMatchObject({ memoryMb: 230 });
  });
});

describe("CPU suggestion", () => {
  // Percent of one core: 1..100 gives P95 = 95 and P99 = 99.
  const hundred = Array.from({ length: 100 }, (_, i) => sample(i % 3, null, i + 1, i));

  it("is the larger of 115% of P99 and 150% of P95, in millicores", () => {
    // 1.15 * 99 = 113.85 and 1.5 * 95 = 142.5 percent of a core. The larger, 142.5%, is 1425m.
    expect(suggestRightSize(hundred, NOW)).toMatchObject({ cpuMillicores: 1425, basis: { cpuP95Percent: 95, cpuP99Percent: 99 } });
  });

  it("takes 115% of P99 when that is the larger", () => {
    // Every sample is 60%: P95 = P99 = 60. 1.15 * 60 = 69 and 1.5 * 60 = 90 percent; the larger is 90%, 900m.
    const flat = Array.from({ length: 30 }, (_, i) => sample(i % 3, null, 60, i));
    expect(suggestRightSize(flat, NOW)).toMatchObject({ cpuMillicores: 900 });
    // With a P99 spike, 115% of P99 wins: 100 samples at 10% and three at 100%.
    // Of 103 samples, nearest-rank P95 is the 98th (10%) and P99 the 102nd (100%).
    const spiky = [
      ...Array.from({ length: 100 }, (_, i) => sample(i % 3, null, 10, i % 60)),
      sample(0, null, 100, 59),
      sample(1, null, 100, 59),
      sample(2, null, 100, 59),
    ];
    expect(suggestRightSize(spiky, NOW)).toMatchObject({ cpuMillicores: 1150 });
  });

  it("is never below 100 millicores", () => {
    const tiny = Array.from({ length: 10 }, (_, i) => sample(i % 3, null, 0.5, i));
    expect(suggestRightSize(tiny, NOW)).toMatchObject({ cpuMillicores: 100 });
  });

  it("gives memory and CPU independently, and null for a missing one", () => {
    const onlyCpu = [sample(0, null, 40), sample(1, null, 40), sample(2, null, 40)];
    expect(suggestRightSize(onlyCpu, NOW)).toMatchObject({ memoryMb: null, cpuMillicores: 600 });
  });
});

describe("not enough history", () => {
  it("needs at least 3 UTC days of samples", () => {
    expect(RIGHT_SIZE_MIN_DAYS).toBe(3);
    const twoDays = [sample(0, 500, 50), sample(0, 600, 50, 5), sample(1, 700, 50)];
    expect(suggestRightSize(twoDays, NOW)).toEqual({ status: "not_enough_history", days: 2, neededDays: 3 });
  });

  it("counts a day once however many samples it has", () => {
    const oneDay = Array.from({ length: 200 }, (_, i) => sample(0, 500, 50, i % 60));
    expect(suggestRightSize(oneDay, NOW)).toEqual({ status: "not_enough_history", days: 1, neededDays: 3 });
  });

  it("ignores samples older than 14 days", () => {
    expect(RIGHT_SIZE_WINDOW_DAYS).toBe(14);
    const old = [sample(-20, 900, 90), sample(-19, 900, 90), sample(-18, 900, 90)];
    expect(suggestRightSize(old, NOW)).toEqual({ status: "not_enough_history", days: 0, neededDays: 3 });
  });

  it("ignores samples with no measurement at all", () => {
    const empty = [sample(0, null, null), sample(1, null, null), sample(2, null, null)];
    expect(suggestRightSize(empty, NOW)).toEqual({ status: "not_enough_history", days: 0, neededDays: 3 });
  });

  it("uses the samples inside the window when older ones are present", () => {
    const mixed = [sample(-30, 9000, 99), sample(0, 500, 50), sample(1, 500, 50), sample(2, 500, 50)];
    expect(suggestRightSize(mixed, NOW)).toMatchObject({ status: "ok", days: 3, memoryMb: 575 });
  });
});
