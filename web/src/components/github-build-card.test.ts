import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { ProjectView } from "@/server/queries";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {}, push: () => {} }) }));
vi.mock("next/link", () => ({ default: ({ children, ...rest }: { children: unknown; href: string }) => createElement("a", rest, children as never) }));
import { GithubBuildCard } from "@/components/github-build-card";

const project = (buildLocation: "container" | "github") =>
  ({ id: "p1", slug: "recipe-api", repo: "sam/recipe-api", repoUrl: "https://github.com/sam/recipe-api", branch: "main", buildLocation, autoDeploy: true, state: null }) as unknown as ProjectView;
const html = (loc: "container" | "github") => renderToStaticMarkup(createElement(GithubBuildCard, { project: project(loc) })).replace(/<!-- -->/g, "");

/** The value of every checked radio, whatever order the attributes come in. */
const checkedValues = (out: string) =>
  [...out.matchAll(/<input[^>]*type="radio"[^>]*>/g)].filter((m) => /checked=""/.test(m[0])).map((m) => /value="([^"]+)"/.exec(m[0])?.[1]);

describe("the Where Builds Run card", () => {
  it("is a labelled section with one radio group of two real radios, the saved one checked", () => {
    const out = html("container");
    expect(out).toContain('aria-labelledby="builds-heading"');
    expect(out).toContain("<legend");
    expect(out.match(/type="radio"/g)).toHaveLength(2);
    expect(out.match(/name="build-location"/g)).toHaveLength(2);
    expect(checkedValues(out)).toEqual(["container"]);
    // Nothing to set up while builds run on the container, and the saved value is stated.
    expect(out).not.toContain("Make credentials");
    expect(out).not.toContain("Test connection");
    expect(out).toContain("Builds run on your Nest container. Applies to the next deployment.");
  });

  it("offers the two options with GitHub Actions first and tagged Recommended, whatever is saved", () => {
    for (const loc of ["container", "github"] as const) {
      const out = html(loc);
      expect(out.indexOf("GitHub Actions")).toBeLessThan(out.indexOf("Build on Nest"));
      expect(out).toContain("Recommended");
      expect(out).toContain("Builds on GitHub&#x27;s machines, so your Nest container only runs the app.");
      expect(out).toContain("Runs on your container under a memory and CPU cap.");
    }
  });

  it("never checks a different option than the saved one, so opening the card changes nothing", () => {
    expect(checkedValues(html("container"))).toEqual(["container"]);
    expect(checkedValues(html("github"))).toEqual(["github"]);
    // Saving is a button that is disabled until the choice differs from the saved value.
    expect(html("container")).toMatch(/<button[^>]*disabled=""[^>]*>[^<]*Save/);
  });

  it("points to the docs with a Learn more link that has a full accessible name", () => {
    const out = html("github");
    expect(out).toContain('href="/docs/build-github-actions"');
    expect(out).toContain("Learn more");
    expect(out).toContain('aria-label="Read the docs about building with GitHub Actions"');
  });

  it("shows the five steps for GitHub Actions with a progress header and the test button, and no secret", () => {
    const out = html("github");
    expect(checkedValues(out)).toEqual(["github"]);
    for (const step of ["Make the build credentials", "Save the secrets on GitHub", "Add the workflow file", "Test the connection", "Run the first build"]) {
      expect(out).toContain(step);
    }
    expect(out).toMatch(/Checking your setup/);
    expect(out).toContain("Test connection");
    expect(out).toContain("Add to repository");
    expect(out).not.toMatch(/egg_build_/);
  });

  it("lets every step header be opened with a button that says whether it is expanded", () => {
    const out = html("github");
    expect(out.match(/aria-expanded="(true|false)"/g)).toHaveLength(5);
    expect(out.match(/aria-controls="setup-[a-z]+-body"/g)).toHaveLength(5);
    // Until the credentials are read, nothing is open, so no step body is announced.
    expect(out.match(/ hidden=""/g)?.length).toBeGreaterThanOrEqual(5);
  });

  it("tells the owner to keep the production secrets in the egg-production environment, and states what remains", () => {
    const out = html("github");
    expect(out).toContain("egg-production");
    expect(out).toContain("EGG_UPLOAD_PRODUCTION_TOKEN");
    expect(out).toContain("EGG_ENV_PRODUCTION_TOKEN");
    expect(out).toContain("EGG_UPLOAD_PREVIEW_TOKEN");
    expect(out).toContain("EGG_ENV_PREVIEW_TOKEN");
    expect(out).toContain("Selected branches and tags");
    expect(out).toContain("must not be repository secrets");
    expect(out).toMatch(/trusted operators of this project/);
    expect(out).toContain("Each project has a single owner");
    expect(out).toContain("cannot see your GitHub secrets or environment settings");
  });

  it("says so when automatic deploys are off, because a push then starts no deployment", () => {
    const off = renderToStaticMarkup(createElement(GithubBuildCard, { project: { ...project("github"), autoDeploy: false } as ProjectView }));
    expect(off).toContain("starts no deployment");
    expect(html("github")).not.toContain("starts no deployment");
  });

  it("links the first build to the workflow on GitHub and to the project's deployments", () => {
    const out = html("github");
    expect(out).toContain('href="https://github.com/sam/recipe-api/actions/workflows/egg.yml"');
    expect(out).toContain('href="/projects/recipe-api/deployments"');
    expect(out).toContain("Nothing has been deployed yet.");
  });

  it("uses no em or en dashes", () => {
    expect(html("github")).not.toMatch(/[–—]/);
    expect(html("container")).not.toMatch(/[–—]/);
  });
});
