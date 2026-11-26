import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ActivityHeatmap } from "@/components/activity-heatmap";
import { buildHeatmap } from "@/lib/heatmap";

// 2026-11-24 15:30 UTC
const NOW = Date.UTC(2026, 10, 24, 15, 30);

function render(counts: Record<string, number>) {
  return renderToStaticMarkup(
    createElement(ActivityHeatmap, {
      id: "t",
      title: "Activity",
      scope: "project",
      heatmap: buildHeatmap(counts, NOW),
      caption: "Per UTC day.",
    })
  );
}

describe("ActivityHeatmap", () => {
  it("draws one cell per day in the window", () => {
    const html = render({});
    expect(html.match(/title="[0-9-]+: \d+ events?"/g)).toHaveLength(365);
  });

  it("puts a visible sentence summary above the grid", () => {
    const html = render({ "2026-11-24": 3 });
    expect(html).toContain("3 events of project activity on 1 day in the last 365 days. Busiest day: 2026-11-24, 3 events.");
  });

  it("hides the grid from assistive technology and lists active days in a visually hidden list", () => {
    const html = render({ "2026-11-24": 3, "2026-11-20": 1 });
    expect(html).toMatch(/<div aria-hidden="true" class="grid/);
    expect(html).toMatch(/<div class="sr-only">/);
    expect(html).toContain("<li>2026-11-20: 1 event, medium activity</li>");
    expect(html).toContain("<li>2026-11-24: 3 events, highest activity</li>");
  });

  it("says there are no days with activity when the window is empty", () => {
    const html = render({});
    expect(html).toContain("No days with activity in this window.");
    expect(html).toContain("No project activity in the last 365 days.");
  });

  it("uses the five intensity classes from the design tokens", () => {
    const html = render({ "2026-11-24": 4, "2026-11-23": 1, "2026-11-22": 2, "2026-11-21": 3 });
    for (const cls of ["bg-muted", "bg-brand/25", "bg-brand/50", "bg-brand/75", "bg-brand"]) {
      expect(html).toContain(cls);
    }
  });

  it("names the section with its title", () => {
    const html = render({});
    expect(html).toContain('aria-labelledby="t-title"');
    expect(html).toContain('id="t-title"');
  });
});
