import { describe, expect, it } from "vitest";
import {
  clockData,
  clockTable,
  funnelProblem,
  funnelTable,
  gaugePercent,
  gaugeProblem,
  gaugeTable,
  gaugeZones,
  hourSpan,
  liveReadings,
  nearestReading,
  nodeTotals,
  radarProblem,
  radarScaled,
  radarTable,
  sankeyProblem,
  sankeyTable,
} from "./bklit-chart-data";

describe("funnel", () => {
  const steps = [
    { label: "Visited", value: 1000 },
    { label: "Signed up", value: 250 },
    { label: "Paid", value: 25 },
  ];

  it("accepts steps with a first step above zero", () => {
    expect(funnelProblem(steps)).toBeNull();
  });

  it("refuses what it cannot show against the first step", () => {
    expect(funnelProblem([])).toMatch(/no steps/);
    expect(funnelProblem([{ label: "A", value: 0 }, { label: "B", value: 0 }])).toMatch(/first step is 0/);
    expect(funnelProblem([{ label: "A", value: 5 }, { label: "B", value: -1 }])).toMatch(/negative/);
    expect(funnelProblem([{ label: "A", value: 5 }, { label: "A", value: 2 }])).toMatch(/same label/);
    expect(funnelProblem([{ label: "A", value: Number.NaN }])).toMatch(/no number/);
  });

  it("gives each step as a share of the first and keeps the order", () => {
    const table = funnelTable(steps, "Sign-up funnel");
    expect(table.rows).toEqual([
      ["Visited", "1,000", "100%"],
      ["Signed up", "250", "25%"],
      ["Paid", "25", "2.5%"],
    ]);
  });
});

describe("gauge", () => {
  it("needs a real range and a number", () => {
    expect(gaugeProblem(50, 0, 100)).toBeNull();
    expect(gaugeProblem(50, 10, 10)).toMatch(/above the minimum/);
    expect(gaugeProblem(Number.NaN, 0, 100)).toMatch(/not a number/);
    expect(gaugeProblem(50, 0, Number.POSITIVE_INFINITY)).toMatch(/not a number/);
  });

  it("places a value on the 0 to 100 scale and holds it at the ends", () => {
    expect(gaugePercent(50, 0, 100)).toBe(50);
    expect(gaugePercent(30, 20, 120)).toBe(10);
    expect(gaugePercent(150, 0, 100)).toBe(100);
    expect(gaugePercent(-5, 0, 100)).toBe(0);
  });

  it("turns ranges into zones on that scale with a colour variable each", () => {
    const zones = gaugeZones(
      [
        { from: 0, to: 70, tone: "good" },
        { from: 70, to: 90, tone: "warning" },
        { from: 90, to: 100, tone: "bad" },
      ],
      0,
      200
    );
    expect(zones).toEqual([
      { from: 0, to: 35, color: "var(--chart-good)" },
      { from: 35, to: 45, color: "var(--chart-warning)" },
      { from: 45, to: 50, color: "var(--chart-bad)" },
    ]);
  });

  it("says the real value and the ranges in its table", () => {
    const table = gaugeTable(150, 0, 100, "Load", [{ from: 90, to: 100, tone: "bad" }]);
    expect(table.rows).toEqual([["Load", "150"], ["Bad range", "90 to 100"]]);
  });
});

describe("sankey", () => {
  const nodes = [
    { id: "ads", label: "Ads" },
    { id: "organic", label: "Organic" },
    { id: "landing", label: "Landing" },
    { id: "buy", label: "Bought" },
  ];
  const flows = [
    { from: "ads", to: "landing", value: 40 },
    { from: "organic", to: "landing", value: 30 },
    { from: "landing", to: "buy", value: 12 },
  ];

  it("accepts flows between known nodes", () => {
    expect(sankeyProblem(nodes, flows)).toBeNull();
  });

  it("refuses what the layout cannot place", () => {
    expect(sankeyProblem(nodes.slice(0, 1), flows)).toMatch(/fewer than two/);
    expect(sankeyProblem(nodes, [])).toMatch(/no flows/);
    expect(sankeyProblem([...nodes, { id: "ads", label: "Other" }], flows)).toMatch(/same id/);
    expect(sankeyProblem([...nodes, { id: "x", label: "Ads" }], flows)).toMatch(/same label/);
    expect(sankeyProblem(nodes, [{ from: "ads", to: "nowhere", value: 1 }])).toMatch(/not in the list/);
    expect(sankeyProblem(nodes, [{ from: "ads", to: "ads", value: 1 }])).toMatch(/to itself/);
    expect(sankeyProblem(nodes, [{ from: "ads", to: "buy", value: 0 }])).toMatch(/above zero/);
    expect(sankeyProblem(nodes, [flows[0], flows[0]])).toMatch(/same pair/);
    expect(
      sankeyProblem(nodes, [
        { from: "ads", to: "landing", value: 1 },
        { from: "landing", to: "buy", value: 1 },
        { from: "buy", to: "ads", value: 1 },
      ])
    ).toMatch(/circle/);
  });

  it("totals what goes in and out of each node, as given", () => {
    const totals = nodeTotals(nodes, flows);
    expect(totals.get("landing")).toEqual({ into: 70, out: 12, hasIn: true, hasOut: true });
    expect(totals.get("ads")).toEqual({ into: 0, out: 40, hasIn: false, hasOut: true });
    expect(totals.get("buy")).toEqual({ into: 12, out: 0, hasIn: true, hasOut: false });
  });

  it("lists the flows by label, in the order given", () => {
    expect(sankeyTable(nodes, flows, "Where visits go").rows).toEqual([
      ["Ads", "Landing", "40"],
      ["Organic", "Landing", "30"],
      ["Landing", "Bought", "12"],
    ]);
  });
});

describe("radar", () => {
  const axes = [
    { key: "a", label: "Speed" },
    { key: "b", label: "Memory" },
    { key: "c", label: "Disk" },
  ];
  const series = [{ label: "Now", values: { a: 50, b: 8, c: 300 } }];

  it("needs three axes, a number everywhere and a top of scale above zero", () => {
    expect(radarProblem(axes, series, { a: 100, b: 16, c: 500 })).toBeNull();
    expect(radarProblem(axes.slice(0, 2), series, 100)).toMatch(/three axes/);
    expect(radarProblem(axes, [], 100)).toMatch(/no series/);
    expect(radarProblem(axes, [series[0], series[0], series[0], series[0]], 100)).toMatch(/three series/);
    expect(radarProblem(axes, series, { a: 100, b: 16 })).toMatch(/"Disk"/);
    expect(radarProblem(axes, series, 0)).toMatch(/not above zero/);
    expect(radarProblem(axes, [{ label: "Now", values: { a: 1, b: 2 } }], 10)).toMatch(/no number for "Disk"/);
  });

  it("scales each value by its own top of scale and holds a value above it at the rim", () => {
    const [s] = radarScaled(axes, series, { a: 100, b: 16, c: 200 });
    expect(s.values).toEqual({ a: 50, b: 50, c: 100 });
  });

  it("lists the real numbers and the top of each scale", () => {
    const table = radarTable(axes, series, { a: 100, b: 16, c: 500 }, "Machine");
    expect(table.rows).toEqual([
      ["Speed", "100", "50"],
      ["Memory", "16", "8"],
      ["Disk", "500", "300"],
    ]);
  });
});

describe("radial clock", () => {
  it("makes 24 rows in hour order, null where there is no reading", () => {
    const { rows, ok, ignored } = clockData([
      { hour: 14, value: 9 },
      { hour: 2, value: 0 },
      { hour: 3, value: null },
    ]);
    expect(ok).toBe(true);
    expect(ignored).toBe(0);
    expect(rows).toHaveLength(24);
    expect(rows.map((r) => r.hour).slice(0, 3)).toEqual(["00", "01", "02"]);
    expect(rows[2].value).toBe(0);
    expect(rows[3].value).toBeNull();
    expect(rows[14].value).toBe(9);
    expect(rows[0].value).toBeNull();
  });

  it("counts hours it cannot use and says nothing can be drawn when no hour has a reading", () => {
    expect(clockData([{ hour: 24, value: 1 }, { hour: 1.5, value: 1 }, { hour: 3, value: -1 }]).ignored).toBe(3);
    expect(clockData([]).ok).toBe(false);
    expect(clockData([{ hour: 3, value: null }]).ok).toBe(false);
  });

  it("names an hour and lists the day", () => {
    expect(hourSpan(23)).toBe("23:00 to 00:00");
    const table = clockTable([{ hour: 9, value: 1200 }], "Views by hour");
    expect(table.rows).toHaveLength(24);
    expect(table.rows[9]).toEqual(["09:00 to 10:00", "1,200"]);
    expect(table.rows[10]).toEqual(["10:00 to 11:00", "No reading"]);
  });
});

describe("live line", () => {
  const readings = [
    { at: 3000, value: 30 },
    { at: 1000, value: 10 },
    { at: Number.NaN, value: 5 },
    { at: 2000, value: Number.POSITIVE_INFINITY },
    { at: 2500, value: 25 },
  ];

  it("sorts a copy by time and drops what is not a number", () => {
    const sorted = liveReadings(readings);
    expect(sorted.map((r) => r.at)).toEqual([1000, 2500, 3000]);
    expect(readings[0].at).toBe(3000);
  });

  it("finds the reading nearest in time, and none before the first", () => {
    const sorted = liveReadings(readings);
    expect(nearestReading(sorted, 999)).toBeNull();
    expect(nearestReading(sorted, 1000)?.value).toBe(10);
    expect(nearestReading(sorted, 1700)?.value).toBe(10);
    expect(nearestReading(sorted, 1800)?.value).toBe(25);
    expect(nearestReading(sorted, 2900)?.value).toBe(30);
    expect(nearestReading(sorted, 99_999)?.value).toBe(30);
    expect(nearestReading([], 1)).toBeNull();
  });

  it("never returns a value that was not a reading", () => {
    const sorted = liveReadings(readings);
    const values = new Set(sorted.map((r) => r.value));
    for (let t = 900; t < 3200; t += 37) {
      const r = nearestReading(sorted, t);
      if (r) expect(values.has(r.value)).toBe(true);
    }
  });
});
