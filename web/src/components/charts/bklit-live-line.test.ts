import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BklitLiveLine } from "./bklit-live-line";

const readings = [
  { at: 1_700_000_000_000, value: 12 },
  { at: 1_700_000_001_000, value: 15 },
];
const html = (props: Parameters<typeof BklitLiveLine>[0]) => renderToStaticMarkup(createElement(BklitLiveLine, props));

describe("BklitLiveLine", () => {
  it("renders inside the theme variables at the height asked for", () => {
    const out = html({ readings, label: "Requests" });
    expect(out).toContain("--chart-line-primary:var(--primary)");
    expect(out).toContain("height:200px");
    expect(html({ readings, label: "Requests", height: 320 })).toContain("height:320px");
  });

  it("draws no colour of its own", () => {
    const out = html({ readings, label: "Requests" });
    expect(out).not.toMatch(/#[0-9a-fA-F]{3,8}["s;]/);
    expect(out).not.toMatch(/rgba?\(|hsla?\(/);
  });

  it("draws nothing until there is a reading, and ignores readings that are not numbers", () => {
    expect(html({ readings: [], label: "Requests" })).toBe("");
    expect(html({ readings: [{ at: Number.NaN, value: 1 }, { at: 5, value: Number.NaN }], label: "Requests" })).toBe("");
  });
});
