import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { StatusDot, StatusIndicator } from "@/components/status-dot";

describe("StatusDot labels", () => {
  it("shows its word by default, for every state, including ready", () => {
    for (const [state, word] of [
      ["ready", "Ready"],
      ["building", "Building"],
      ["error", "Error"],
      ["queued", "Queued"],
      ["canceled", "Canceled"],
    ] as const) {
      const html = renderToStaticMarkup(createElement(StatusDot, { state }));
      expect(html).toContain(`<span>${word}</span>`);
      expect(html).not.toContain("sr-only");
    }
  });

  it("only drops the visible word when the caller says the mark is icon-only", () => {
    const html = renderToStaticMarkup(createElement(StatusDot, { state: "ready", iconOnly: true }));
    expect(html).toContain('<span class="sr-only">Ready</span>');
  });

  it("keeps the deprecated showLabel=false working as icon-only", () => {
    const html = renderToStaticMarkup(createElement(StatusDot, { state: "ready", showLabel: false }));
    expect(html).toContain('<span class="sr-only">Ready</span>');
  });

  it("StatusIndicator always renders its label", () => {
    const html = renderToStaticMarkup(createElement(StatusIndicator, { tone: "ready", label: "Live" }));
    expect(html).toContain("<span>Live</span>");
  });
});
