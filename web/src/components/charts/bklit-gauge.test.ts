import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BklitGauge } from "./bklit-gauge";

const html = (props: Parameters<typeof BklitGauge>[0]) => renderToStaticMarkup(createElement(BklitGauge, props));

describe("BklitGauge", () => {
  it("renders inside the theme variables", () => {
    const out = html({ value: 40, label: "CPU" });
    expect(out).toContain("--chart-line-primary:var(--primary)");
    expect(out).toContain("--chart-good:var(--success)");
    expect(out).toContain("--chart-bad:var(--destructive)");
  });

  it("draws no colour of its own", () => {
    const out = html({ value: 40, label: "CPU", ranges: [{ from: 0, to: 100, tone: "good" }] });
    expect(out).not.toMatch(/#[0-9a-fA-F]{3,8}["s;]/);
    expect(out).not.toMatch(/rgba?\(|hsla?\(/);
  });

  it("fits a narrow card by default", () => {
    expect(html({ value: 40, label: "CPU" })).toContain("min-width:0");
    expect(html({ value: 40, label: "CPU", minWidth: 240 })).toContain("min-width:240px");
  });

  it("draws nothing for a value or a scale that is not a number or a range", () => {
    expect(html({ value: Number.NaN, label: "CPU" })).toBe("");
    expect(html({ value: 5, min: 10, max: 10, label: "CPU" })).toBe("");
  });
});
