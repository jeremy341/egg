import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ClicksCard, FunnelCard, TimeCard } from "@/components/analytics-insights";
import { summariseTime } from "@/server/analytics-events";
import { summariseFunnel } from "@/server/analytics-funnel";

const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

describe("TimeCard", () => {
  it("is a labelled table with a median once there are enough visits", () => {
    const html = renderToStaticMarkup(
      createElement(TimeCard, { summary: { ...summariseTime({ lt10: 10, "10-60": 30, "60-300": 50, gt300: 10 }), days: 30 } })
    );
    expect(html).toContain("<table");
    expect(html).toContain("<caption");
    expect(text(html)).toContain("Median: 1 to 5 minutes");
    expect(text(html)).toContain("50%");
  });

  it("says not enough data instead of showing shares below the minimum", () => {
    const html = renderToStaticMarkup(
      createElement(TimeCard, { summary: { ...summariseTime({ lt10: 3, "10-60": 2, "60-300": 0, gt300: 0 }), days: 30 } })
    );
    expect(text(html)).toContain("Median: Not enough data");
    expect(text(html)).toContain("Not enough data");
    expect(html).not.toContain("%");
    expect(text(html)).toContain("at least 50 visits");
  });

  it("explains an empty card", () => {
    const html = renderToStaticMarkup(
      createElement(TimeCard, { summary: { ...summariseTime({ lt10: 0, "10-60": 0, "60-300": 0, gt300: 0 }), days: 30 } })
    );
    expect(text(html)).toContain("No times recorded yet");
    expect(html).not.toContain("<table");
  });
});

describe("FunnelCard", () => {
  const steps = [
    { kind: "page" as const, value: "/pricing" },
    { kind: "track" as const, value: "signup" },
  ];

  it("lists the steps in order with counts and the drop-off in words and figures", () => {
    const html = renderToStaticMarkup(createElement(FunnelCard, { summary: summariseFunnel(steps, [200, 80]) }));
    expect(html).toContain("<ol");
    expect(text(html)).toContain("Step 1 of 2");
    expect(text(html)).toContain("200 visitors");
    expect(text(html)).toContain("120 visitors dropped off (60% of the step before)");
    expect(text(html)).toContain("Of 200 visitors who started, 80 reached the last step (40%)");
  });

  it("shows counts but no percentages below the minimum sample", () => {
    const html = renderToStaticMarkup(createElement(FunnelCard, { summary: summariseFunnel(steps, [30, 10]) }));
    expect(text(html)).toContain("20 visitors dropped off (percentage needs 50 visitors at the step before)");
    expect(text(html)).toContain("Not enough data for percentages yet");
    expect(html).not.toContain("%)");
  });

  it("explains an empty funnel", () => {
    const html = renderToStaticMarkup(createElement(FunnelCard, { summary: summariseFunnel(steps, [0, 0]) }));
    expect(text(html)).toContain("No visitors have reached the first step yet");
  });
});

describe("ClicksCard", () => {
  it("lists labels with a count and a unit for screen readers", () => {
    const html = renderToStaticMarkup(
      createElement(ClicksCard, { summary: { days: 30, total: 3, rows: [{ label: "Buy now", clicks: 3 }] } })
    );
    expect(text(html)).toContain("Buy now");
    expect(text(html)).toContain("3 clicks");
  });

  it("explains an empty list", () => {
    const html = renderToStaticMarkup(createElement(ClicksCard, { summary: { days: 30, total: 0, rows: [] } }));
    expect(text(html)).toContain("No clicks recorded yet");
  });
});
