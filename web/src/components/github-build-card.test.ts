import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { ProjectView } from "@/server/queries";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {}, push: () => {} }) }));
vi.mock("next/link", () => ({ default: ({ children, href }: { children: unknown; href: string }) => createElement("a", { href }, children as never) }));
import { GithubBuildCard } from "@/components/github-build-card";

const project = (buildLocation: "container" | "github") => ({ id: "p1", branch: "main", buildLocation, autoDeploy: true }) as unknown as ProjectView;
const html = (loc: "container" | "github") => renderToStaticMarkup(createElement(GithubBuildCard, { project: project(loc) }));

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
    // Nothing to set up while builds run on the container.
    expect(out).not.toContain("Make credentials");
    expect(out).not.toContain("Test connection");
  });

  it("shows the four steps for GitHub Actions, with the test button and no secret", () => {
    const out = html("github");
    expect(checkedValues(out)).toEqual(["github"]);
    for (const step of ["1. Make the build credentials", "2. Save the secrets on GitHub", "3. Add the workflow file", "4. Test the connection"]) expect(out).toContain(step);
    expect(out).toContain("Test connection");
    expect(out).not.toMatch(/egg_build_/);
  });

  it("tells the owner to keep the production secrets in the egg-production environment, and states what remains", () => {
    const out = html("github").replace(/<!-- -->/g, "");
    expect(out).toContain("egg-production");
    expect(out).toContain("EGG_UPLOAD_PRODUCTION_TOKEN");
    expect(out).toContain("EGG_ENV_PRODUCTION_TOKEN");
    expect(out).toContain("EGG_UPLOAD_PREVIEW_TOKEN");
    expect(out).toContain("Selected branches and tags");
    expect(out).toContain("must not be repository secrets");
    expect(out).toMatch(/trusted operators of this project/);
    expect(out).toMatch(/Project roles\s+in Egg do not isolate Nest accounts|Project roles in Egg do not isolate Nest accounts/);
    expect(out).toContain("cannot see your GitHub secrets or environment settings");
  });

  it("says so when automatic deploys are off, because a push then starts no deployment", () => {
    const off = renderToStaticMarkup(createElement(GithubBuildCard, { project: { ...project("github"), autoDeploy: false } as ProjectView }));
    expect(off).toContain("starts no deployment");
    expect(html("github")).not.toContain("starts no deployment");
  });

  it("uses no em or en dashes", () => {
    expect(html("github")).not.toMatch(/[–—]/);
  });
});
