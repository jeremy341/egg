import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LocationsBklit } from "./analytics-locations-card";
import { summariseLocations } from "@/server/analytics-locations";
import { worldShapes } from "@/server/world-map";

const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
const shapes = worldShapes();

describe("the visitor map card", () => {
  it("says recording is off and links to the setting when the switch is off", () => {
    const html = renderToStaticMarkup(createElement(LocationsBklit, { summary: null, shapes }));
    expect(text(html)).toContain("Recording is off");
    expect(html).toContain('href="?tab=setup#analytics-features"');
    expect(html).not.toContain("<svg");
    expect(text(html)).toContain("never stored");
  });

  it("draws the map with a legend and a table of the same numbers", () => {
    const summary = summariseLocations([
      { code: "FR", visits: 400 },
      { code: "DE", visits: 3 },
    ]);
    const html = renderToStaticMarkup(createElement(LocationsBklit, { summary, shapes }));
    expect(html).not.toMatch(/#[0-9a-fA-F]{3,8}["s;]/);
    expect(text(html)).toContain("GeoLite2");
    expect(text(html)).toContain("Most page views came from France");
    expect(text(html)).toContain("Fewer than 10");
    expect(text(html)).toContain("Germany fewer than 10");
    expect(text(html)).not.toMatch(/Germany 3\b/);
  });

  it("says plainly when nothing is recorded yet", () => {
    const html = renderToStaticMarkup(createElement(LocationsBklit, { summary: summariseLocations([]), shapes }));
    expect(text(html)).toContain("No countries recorded yet");
    expect(html).not.toContain("<svg");
  });
});
