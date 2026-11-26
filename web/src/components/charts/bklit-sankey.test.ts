import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BklitSankey } from "./bklit-sankey";

const nodes = [
  { id: "a", label: "Ads" },
  { id: "b", label: "Landing" },
  { id: "c", label: "Bought" },
];
const flows = [
  { from: "a", to: "b", value: 40 },
  { from: "b", to: "c", value: 10 },
];
const html = (props: Parameters<typeof BklitSankey>[0]) => renderToStaticMarkup(createElement(BklitSankey, props));

describe("BklitSankey", () => {
  it("renders inside the theme variables with the aspect ratio asked for", () => {
    const out = html({ nodes, flows });
    expect(out).toContain("--chart-line-primary:var(--primary)");
    expect(out).toContain("aspect-ratio:16 / 9");
    expect(html({ nodes, flows, aspectRatio: "2 / 1" })).toContain("aspect-ratio:2 / 1");
  });

  it("draws no colour of its own", () => {
    const out = html({ nodes, flows });
    expect(out).not.toMatch(/#[0-9a-fA-F]{3,8}["s;]/);
    expect(out).not.toMatch(/rgba?\(|hsla?\(/);
  });

  it("says why instead of throwing when the flows cannot be laid out", () => {
    const circle = html({ nodes, flows: [...flows, { from: "c", to: "a", value: 1 }] });
    expect(circle).toContain("cannot be drawn");
    expect(circle).toContain("circle");
    expect(circle).not.toContain("aspect-ratio");
    expect(html({ nodes, flows: [{ from: "a", to: "zzz", value: 1 }] })).toContain("not in the list");
    expect(html({ nodes, flows: [] })).toContain("no flows");
  });
});
