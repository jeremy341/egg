import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { EggMark } from "./egg-mark";
import { NestMark } from "./nest-mark";

describe("EggMark", () => {
  const html = renderToStaticMarkup(createElement(EggMark));

  it("renders an svg titled Egg", () => {
    expect(html).toMatch(/^<svg\b/);
    expect(html).toContain("<title>Egg</title>");
  });

  it("uses currentColor and no fixed colours", () => {
    expect(html).toContain("currentColor");
    expect(html).not.toMatch(/#[0-9a-f]{3,8}\b|rgb\(/i);
  });

  it("draws a 5 by 6 grid with the highlight cell left out", () => {
    expect(html).toContain('viewBox="0 0 5 6"');
    expect(html.match(/<rect /g)).toHaveLength(23);
  });

  it("keeps NestMark as an alias that renders the same mark", () => {
    expect(NestMark).toBe(EggMark);
  });
});
