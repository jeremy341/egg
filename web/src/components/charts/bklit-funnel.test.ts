import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BklitFunnel } from "./bklit-funnel";

const steps = [
  { label: "Visited", value: 1000 },
  { label: "Signed up", value: 250 },
];
const html = (props: Parameters<typeof BklitFunnel>[0]) => renderToStaticMarkup(createElement(BklitFunnel, props));

describe("BklitFunnel", () => {
  it("renders inside the theme variables with the chosen shape", () => {
    const out = html({ steps });
    expect(out).toContain("--chart-line-primary:var(--primary)");
    expect(out).toContain("aspect-ratio:2.2 / 1");
    expect(html({ steps, orientation: "vertical" })).toContain("aspect-ratio:1 / 1.8");
    expect(html({ steps, aspectRatio: "3 / 1" })).toContain("aspect-ratio:3 / 1");
  });

  it("draws no colour of its own", () => {
    const out = html({ steps });
    expect(out).not.toMatch(/#[0-9a-fA-F]{3,8}["s;]/);
    expect(out).not.toMatch(/rgba?\(|hsla?\(/);
  });

  it("draws nothing when the steps cannot be shown against the first", () => {
    expect(html({ steps: [] })).toBe("");
    expect(html({ steps: [{ label: "A", value: 0 }, { label: "B", value: 0 }] })).toBe("");
    expect(html({ steps: [{ label: "A", value: 3 }, { label: "A", value: 1 }] })).toBe("");
  });
});
