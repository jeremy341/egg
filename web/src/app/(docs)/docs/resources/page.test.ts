import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import ResourcesPage from "./page";

describe("project resources documentation", () => {
  it("shows a copyable project request and describes the supported boundary", () => {
    const html = renderToStaticMarkup(createElement(ResourcesPage));

    expect(html).toContain('data-docs-page="resources"');
    expect(html).toContain("Project resources");
    expect(html).toContain("POST /api/v1/projects");
    expect(html).toContain("https://your-egg/api/v1/projects");
    expect(html).toContain("Egg does not provision or manage databases");
    expect(html).toContain("template registry");
  });
});
