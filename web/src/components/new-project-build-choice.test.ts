import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {}, push: () => {} }) }));
vi.mock("next/link", () => ({ default: ({ children, ...rest }: { children: unknown; href: string }) => createElement("a", rest, children as never) }));
import { Configure } from "@/components/new-project-flow";

const servers = [{ id: "s1", nestUsername: "sam", status: "connected" }];
const render = (installationId: number | null) =>
  renderToStaticMarkup(
    createElement(Configure, {
      source: { repoUrl: "https://github.com/sam/recipe-api", repoFullName: installationId ? "sam/recipe-api" : null, installationId, branch: "main" },
      servers,
      onBack: () => {},
    })
  ).replace(/<!-- -->/g, "");

const checked = (out: string) =>
  [...out.matchAll(/<input[^>]*type="radio"[^>]*>/g)].filter((m) => /checked=""/.test(m[0])).map((m) => /value="([^"]+)"/.exec(m[0])?.[1]);

describe("How should Egg build it? in the new project flow", () => {
  const out = render(42);

  it("asks the question as a labelled group of two radios", () => {
    expect(out).toContain("<legend");
    expect(out).toContain("How should Egg build it?");
    expect(out.match(/name="np-build-location"/g)).toHaveLength(2);
  });

  it("preselects GitHub Actions and tags it Recommended with the reason, and keeps Build on Nest easy to find", () => {
    expect(checked(out)).toEqual(["github"]);
    expect(out).toContain("Recommended");
    expect(out).toContain("Builds on GitHub&#x27;s machines, so your Nest container only runs the app.");
    expect(out).toContain("Build on Nest");
    expect(out).toContain("Runs on your container under a memory and CPU cap.");
  });

  it("sends the person to the guided setup, not a deployment that would wait for a release that cannot arrive", () => {
    expect(out).toContain("Create and set up builds");
    expect(out).not.toMatch(/>Deploy</);
    expect(out).toContain("Next you make the build credentials and add the workflow file.");
    expect(out).toContain('aria-describedby="np-build-note"');
  });

  it("keeps the other settings of the form", () => {
    for (const label of ["Nest server", "Project name", "Application preset", "Production branch", "Root directory"]) expect(out).toContain(label);
    expect(out).toContain("Start with automatic deploys off");
  });

  it("offers no choice for a pasted public URL, which has no GitHub app link, and keeps the Deploy button", () => {
    const pasted = render(null);
    expect(pasted).not.toContain("How should Egg build it?");
    expect(pasted).not.toContain("np-build-location");
    expect(pasted).toMatch(/>Deploy</);
    expect(pasted).not.toContain("Create and set up builds");
  });

  it("points the port note to the docs instead of explaining more here", () => {
    expect(out).toContain("Your app must listen on the");
    expect(out).toContain('href="/docs/projects#projects-guarantees"');
    expect(out).not.toContain("Environment variables can be added in the project settings");
  });

  it("uses no em or en dashes", () => {
    expect(out).not.toMatch(/[–—]/);
  });
});
