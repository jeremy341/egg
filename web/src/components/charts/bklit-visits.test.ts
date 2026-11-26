import { describe, expect, it } from "vitest";
import { dayLabels, extremes, summarise, toBklitData, type Day } from "./bklit-visits";

const fixture: Day[] = [
  { day: "2026-11-01", views: 12, visitors: 9 },
  { day: "2026-11-02", views: 0, visitors: 0 },
  { day: "2026-11-03", views: 40, visitors: 31 },
  { day: "2026-11-04", views: 7, visitors: 6 },
];

describe("toBklitData", () => {
  it("keeps the same days, in the same order, with the same numbers", () => {
    const out = toBklitData(fixture);
    expect(out).toHaveLength(fixture.length);
    expect(out.map((p) => p.date.toISOString().slice(0, 10))).toEqual(fixture.map((d) => d.day));
    expect(out.map((p) => p.views)).toEqual(fixture.map((d) => d.views));
    expect(out.map((p) => p.visitors)).toEqual(fixture.map((d) => d.visitors));
  });

  it("has the same totals as the input", () => {
    const out = toBklitData(fixture);
    const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
    expect(sum(out.map((p) => p.views))).toBe(sum(fixture.map((d) => d.views)));
    expect(sum(out.map((p) => p.visitors))).toBe(sum(fixture.map((d) => d.visitors)));
  });

  it("puts each date at midnight UTC, so the day does not move with the time zone", () => {
    for (const p of toBklitData(fixture)) {
      expect(p.date.getUTCHours()).toBe(0);
      expect(p.date.getUTCMinutes()).toBe(0);
    }
  });

  it("does not sort, so an out-of-order input stays out of order", () => {
    const shuffled = [fixture[2], fixture[0], fixture[3], fixture[1]];
    expect(toBklitData(shuffled).map((p) => p.views)).toEqual([40, 12, 7, 0]);
  });

  it("returns nothing for no data", () => {
    expect(toBklitData([])).toEqual([]);
    expect(dayLabels([])).toEqual([]);
    expect(extremes([])).toBeNull();
    expect(summarise([])).toBe("No days to show.");
  });

  it("handles one point", () => {
    const one: Day[] = [{ day: "2026-11-04", views: 1, visitors: 1 }];
    const out = toBklitData(one);
    expect(out).toHaveLength(1);
    expect(out[0].views).toBe(1);
    expect(dayLabels(one)).toEqual(["4 Nov"]);
    expect(summarise(one)).toBe("4 Nov: 1 view.");
  });
});

describe("labels and summary", () => {
  it("gives one label per row, in order, as UTC calendar days", () => {
    expect(dayLabels(fixture)).toEqual(["1 Nov", "2 Nov", "3 Nov", "4 Nov"]);
  });

  it("names the highest and the lowest day", () => {
    expect(summarise(fixture)).toBe("Highest: 3 Nov, 40 views. Lowest: 2 Nov, 0 views.");
  });

  it("keeps the earlier day on a tie", () => {
    const tie: Day[] = [
      { day: "2026-11-01", views: 5, visitors: 5 },
      { day: "2026-11-02", views: 5, visitors: 4 },
    ];
    expect(extremes(tie)).toEqual({ highest: tie[0], lowest: tie[0] });
  });
});
