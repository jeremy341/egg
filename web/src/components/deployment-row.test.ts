import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DeploymentRow } from "@/components/deployment-row";
import type { DeploymentView } from "@/server/queries";

const base: DeploymentView = {
  id: "d1234567890",
  projectId: "p1",
  projectSlug: "recipe-api",
  projectName: "recipe-api",
  repo: null,
  env: "preview",
  state: "building",
  rawState: "building",
  source: "github",
  branch: "feat/a-very-long-branch-name-for-pagination",
  sha: "837638e1234",
  commit: "Add pagination to /recipes",
  pr: 14,
  author: "sam",
  age: "1d ago",
  duration: "12s",
  durationMs: 12000,
  port: 3000,
  isCurrent: false,
  cleanedUp: false,
  error: null,
  createdAt: "2026-11-04T10:00:00.000Z",
};

const render = (over: Partial<DeploymentView> = {}) =>
  renderToStaticMarkup(createElement("ul", null, createElement(DeploymentRow, { deployment: { ...base, ...over }, demo: true })));

describe("DeploymentRow on phones", () => {
  it("gives the status its own line below sm", () => {
    expect(render()).toMatch(/max-sm:col-span-3[\s\S]*Building/);
  });

  it("keeps the full branch name in a title and a minimum width of 12ch", () => {
    const html = render();
    expect(html).toContain(`title="${base.branch}"`);
    expect(html).toContain("min-w-[12ch]");
  });
});
