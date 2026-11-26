import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CopyPromptButton } from "./copy-prompt";

describe("CopyPromptButton", () => {
  it("renders the copy control and the Claude/ChatGPT menu trigger", () => {
    const html = renderToStaticMarkup(createElement(CopyPromptButton, { slug: "install" }));
    expect(html).toContain("Copy prompt");
    expect(html).toContain("Preview prompt");
  });

  it("uses a custom label for the whole-docs prompt", () => {
    const html = renderToStaticMarkup(createElement(CopyPromptButton, { global: true, label: "Copy docs prompt" }));
    expect(html).toContain("Copy docs prompt");
  });
});
