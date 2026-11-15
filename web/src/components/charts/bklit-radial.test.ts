import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BklitRadial } from "./bklit-radial";

const hours = [
  { hour: 9, value: 120 },
  { hour: 14, value: 300 },
  { hour: 3, value: null },
];
const html = (props: Parameters<typeof BklitRadial>[0]) => renderToStaticMarkup(createElement(BklitRadial, props));

describe("BklitRadial", () => {
  it("renders inside the theme variables, at most as wide as asked", () => {
    const out = html({ hours });
    expect(out).toContain("--chart-line-primary:var(--primary)");
    expect(out).toContain("max-width:480px");
    expect(html({ hours, maxWidth: 320 })).toContain("max-width:320px");
  });

  it("draws no colour of its own", () => {
    const out = html({ hours });
    expect(out).not.toMatch(/#[0-9a-fA-F]{3,8}["s;]/);
    expect(out).not.toMatch(/rgba?\(|hsla?\(/);
  });

  it("draws nothing when no hour has a reading", () => {
    expect(html({ hours: [] })).toBe("");
    expect(html({ hours: [{ hour: 3, value: null }] })).toBe("");
    expect(html({ hours: [{ hour: 30, value: 4 }] })).toBe("");
  });
});
