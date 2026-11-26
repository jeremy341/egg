import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RightSizeCard } from "./right-size-card";

describe("RightSizeCard", () => {
  it("says how much history is still needed", () => {
    const html = renderToStaticMarkup(
      createElement(RightSizeCard, { suggestion: { status: "not_enough_history", days: 1, neededDays: 3 } })
    );
    expect(html).toContain("Need 3 days of readings");
    expect(html).toContain("Have 1");
  });

  it("shows the suggestion and makes clear nothing is applied", () => {
    const html = renderToStaticMarkup(
      createElement(RightSizeCard, {
        suggestion: {
          status: "ok",
          days: 7,
          memoryMb: 512,
          cpuMillicores: 250,
          basis: { memoryPeakMb: 400, cpuP95Percent: 12, cpuP99Percent: 20 },
        },
      })
    );
    expect(html).toContain("512 MB");
    expect(html).toContain("250m");
    expect(html).toContain("Based on 7 days of readings");
    expect(html).toMatch(/suggestion only/i);
  });
});
