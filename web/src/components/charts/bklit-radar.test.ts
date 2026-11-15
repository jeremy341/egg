import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BklitRadar } from "./bklit-radar";

const axes = [
  { key: "a", label: "Speed" },
  { key: "b", label: "Memory" },
  { key: "c", label: "Disk" },
];
const one = [{ label: "Now", values: { a: 50, b: 8, c: 300 } }];
const two = [...one, { label: "Last week", values: { a: 40, b: 6, c: 250 } }];
const html = (props: Parameters<typeof BklitRadar>[0]) => renderToStaticMarkup(createElement(BklitRadar, props));

describe("BklitRadar", () => {
  it("renders inside the theme variables", () => {
    expect(html({ axes, series: one, max: { a: 100, b: 16, c: 500 } })).toContain("--chart-line-primary:var(--primary)");
  });

  it("puts a key under the chart only when there is more than one series, in theme colours", () => {
    expect(html({ axes, series: one, max: 500 })).not.toContain("Last week");
    const out = html({ axes, series: two, max: 500 });
    expect(out).toContain("Now");
    expect(out).toContain("Last week");
    expect(out).toContain("var(--chart-line-primary)");
    expect(out).toContain("var(--chart-series-2)");
    expect(out).not.toMatch(/#[0-9a-fA-F]{3,8}["s;]/);
    expect(out).not.toMatch(/rgba?\(|hsla?\(/);
  });

  it("draws nothing when it cannot be drawn truthfully", () => {
    expect(html({ axes: axes.slice(0, 2), series: one, max: 500 })).toBe("");
    expect(html({ axes, series: one, max: { a: 100 } })).toBe("");
    expect(html({ axes, series: [{ label: "Now", values: { a: 1 } }], max: 10 })).toBe("");
  });
});
