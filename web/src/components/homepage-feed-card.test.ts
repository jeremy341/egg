import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => undefined }) }));

import { HomepageFeedCard } from "@/components/homepage-feed-card";
import type { ProjectView } from "@/server/queries";

const view = (over: Partial<ProjectView>) =>
  ({ id: "p1", repo: "sam/site", homepageFeed: false, homepageFeedPossible: true, ...over }) as ProjectView;
const html = (over: Partial<ProjectView> = {}) => renderToStaticMarkup(createElement(HomepageFeedCard, { project: view(over) }));

/** The disabled attribute on the button itself, not the disabled: utility classes in its class list. */
const buttonDisabled = (out: string) => / disabled(?:=""| |>)/.test(out.slice(out.indexOf("<button"), out.indexOf(">", out.indexOf("<button"))+1));

describe("the homepage opt-in card", () => {
  it("says what becomes public and what never does", () => {
    const out = html().replace(/&#x27;/g, "'");
    for (const t of ["first line of the commit message", "the short commit", "the branch", "Production or", "Preview", "the time", "sam/site"]) {
      expect(out, t).toContain(t);
    }
    expect(out).toContain("Never build logs, your server, ports, or environment variables");
    expect(out).toContain("Never your Hack Club name or email");
    expect(out).toContain("Someone");
    expect(out).toContain("Public GitHub repositories only");
    expect(out).toContain("separate from the public status page");
  });

  it("starts off, with a button that turns it on", () => {
    const out = html();
    expect(out).toContain("Not shown.");
    expect(out).toContain("Show on homepage");
    expect(buttonDisabled(out)).toBe(false);
  });

  it("offers to stop when it is on", () => {
    const out = html({ homepageFeed: true });
    expect(out).toContain("Shown on the Egg homepage.");
    expect(out).toContain("Stop showing");
  });

  it("cannot be turned on for a project that Egg cannot check with GitHub", () => {
    const out = html({ homepageFeedPossible: false });
    expect(out).toContain("imported through the GitHub App");
    expect(buttonDisabled(out)).toBe(true);
  });

  it("can still be turned off when the link is gone", () => {
    const out = html({ homepageFeed: true, homepageFeedPossible: false });
    expect(buttonDisabled(out)).toBe(false);
  });
});
