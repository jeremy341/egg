import { createElement } from "react";
import { readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { ProjectView } from "@/server/queries";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {}, push: () => {} }), usePathname: () => "/", useSearchParams: () => new URLSearchParams() }));
vi.mock("next/link", () => ({ default: ({ children, ...rest }: { children: unknown; href: string }) => createElement("a", rest, children as never) }));
import { AlertsCard, DeployHookCard, StatusPageCard } from "@/components/project-automation";
import { ConnectFlow } from "@/components/connect-flow";
import { ProjectSettings } from "@/components/project-settings";

const project = {
  id: "p1", slug: "recipe-api", name: "recipe-api", repo: "sam/recipe-api", repoUrl: "https://github.com/sam/recipe-api", branch: "main",
  runtime: "node", startCommand: null, port: 3000, healthPath: "/", autoDeploy: true, buildLocation: "github", hookActive: false,
  hookCreatedAt: null, notify: null, serverId: "s1", nestUsername: "sam", domains: [], state: null, lastCommit: null, lastSha: null,
  lastShaFull: null, lastAge: null, latestDeploymentId: null, monitor: "unknown", monitorSince: null, analyticsKey: null, statusUrl: null,
  homepageFeed: false, homepageFeedPossible: false,
} as unknown as ProjectView;

const render = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el).replace(/<!-- -->/g, "");
const words = (s: string) => s.replace(/<[^>]*>/g, " ").split(/\s+/).filter(Boolean).length;

describe("project automation cards keep one sentence and link to the docs", () => {
  it("the deploy hook says what it is for, and the call details moved to the docs", () => {
    const out = render(createElement(DeployHookCard, { project }));
    expect(out).toContain("A private URL that starts a deployment when something sends it a POST.");
    expect(out).toContain('href="/docs/hooks"');
    expect(out).toContain("Learn more");
    expect(out).not.toContain("gets a 409");
    expect(out).not.toContain("builds");
  });

  it("the status page says what it shows in one line", () => {
    const out = render(createElement(StatusPageCard, { project }));
    expect(out).toContain("A public page that shows whether this app is answering.");
    expect(out).toContain('href="/docs/status-page"');
    expect(out).toContain("Learn more");
    expect(out).not.toContain("recent outages, and nothing else");
  });

  it("alerts keep one sentence and a Learn more link", () => {
    const out = render(createElement(AlertsCard, { project }));
    expect(out).toContain("Choose what counts as a problem and when to stay quiet.");
    expect(out).toContain('aria-label="Read the docs about alerts"');
    expect(out).toContain("Learn more");
  });
});

describe("the connect flow", () => {
  const out = render(createElement(ConnectFlow, { servers: [] }));
  it("keeps the steps to one line each", () => {
    expect(out).toContain("The public key appears here after step 1.");
    expect(out).toContain("Egg connects once and checks what your container can run.");
    expect(out).not.toContain("remember the server");
    expect(words(out)).toBeLessThan(260);
  });
  it("keeps the warning that the key gives the same access as a login", () => {
    expect(out).toContain("This key gives Egg the same access as your own login");
  });
});

describe("the project settings page", () => {
  const out = render(createElement(ProjectSettings, { project, env: [] }));
  it("shortens the variables and danger descriptions and links the variables to the docs", () => {
    expect(out).toContain("Stored encrypted. Values are never shown again.");
    expect(out).not.toContain("written to your server when you deploy");
    expect(out).toContain("Removes the project from Egg. The lists below show what goes and what stays.");
    expect(out).toContain('href="/docs/env"');
    expect(out).toContain("Learn more");
  });
  it("still holds the build choice with GitHub Actions saved", () => {
    expect(out).toContain('name="build-location"');
    expect(out).toContain("Builds run on GitHub Actions.");
  });
});

describe("the container page sections", () => {
  const src = readFileSync(path.resolve(__dirname, "container-view.tsx"), "utf8");
  it("state the purpose in one sentence and point to the docs for the rest", () => {
    expect(src).toContain('description="The memory limit of a build that runs on your container."');
    expect(src).toContain('description="The CPU a build can use on your container."');
    expect(src).toContain('description="Services and folders Egg created earlier that none of your projects use any more."');
    for (const href of ["/docs/container#container-build-memory", "/docs/container#container-build-cpu", "/docs/container#container-leftovers"]) {
      expect(src).toContain(href);
    }
    expect(src).toContain('label="Learn more"');
    expect(src).not.toContain("never on Egg's machine");
  });
});
