import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { DeploymentActions, writeActions } from "@/components/deployment-actions";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {}, push: () => {} }) }));

const deployment = {
  id: "d1234567890",
  projectSlug: "recipe-api",
  env: "production" as const,
  rawState: "ready",
  isCurrent: false,
  cleanedUp: false,
};

describe("the deployment action list", () => {
  it("offers an owner or developer every write in order", () => {
    expect(writeActions(true, deployment)).toEqual(["redeploy", "rollback"]);
    expect(writeActions(true, { ...deployment, rawState: "building" })).toEqual(["redeploy", "cancel"]);
    expect(writeActions(true, { ...deployment, isCurrent: true })).toEqual(["redeploy"]);
  });

  it("offers a viewer none, because the server refuses them all", () => {
    expect(writeActions(false, deployment)).toEqual([]);
  });
});

describe("DeploymentActions", () => {
  it("renders the actions button for every role", () => {
    const html = renderToStaticMarkup(createElement(DeploymentActions, { deployment }));
    expect(html).toContain('aria-label="Actions for deployment d123456"');
    expect(renderToStaticMarkup(createElement(DeploymentActions, { deployment, canAct: false }))).toContain(
      "aria-label"
    );
  });
});
