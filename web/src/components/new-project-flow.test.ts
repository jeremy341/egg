import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {}, push: () => {} }) }));
vi.mock("@/components/api", () => ({ api: vi.fn() }));

import { NewProjectFlow, type GithubState } from "@/components/new-project-flow";

const servers = [{ id: "s1", nestUsername: "sam-r", status: "connected" }];

const flow = (github: GithubState) =>
  renderToStaticMarkup(
    createElement(NewProjectFlow, {
      servers,
      github,
      defaultBranch: "main",
    })
  );

describe("the new project flow and GitHub setup", () => {
  it("leads with the Install the GitHub App card when the app is configured but not installed", () => {
    const html = flow({
      configured: true,
      installUrl: "https://github.com/apps/egg/installations/new",
      installations: [],
      notice: null,
    });
    expect(html).toContain("Install the GitHub App");
    expect(html).toContain("deploy private ones, and deploy on every push.");
    // The public repository path stays available beneath the setup card.
    expect(html).toContain("Or use a public repository URL");
  });

  it("explains the missing repository picker when the installation has no GitHub app, and keeps public repositories", () => {
    const html = flow({
      configured: false,
      installUrl: null,
      installations: [],
      notice: null,
    });
    expect(html).toContain("Connect GitHub");
    expect(html).toContain("it is not done here yet, so the repository picker is missing");
    expect(html).toContain("How GitHub setup works");
    // The form note says only what the card above does not: push deploys.
    expect(html).toContain("Pushes do not deploy automatically");
    expect(html).toContain("Public repository URL");
    // This state offers no install button, because the user cannot install an app this Egg cannot identify.
    expect(html).not.toContain("Install the GitHub App");
    // The bot hint names Slack and Telegram, and promises only the guides that exist.
    expect(html).toContain("Deploying a Discord, Slack or Telegram bot?");
    expect(html).toContain("have guides for Discord, Slack and Telegram");
  });
});
