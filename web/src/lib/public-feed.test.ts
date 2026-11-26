import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DeploymentRow } from "@/components/deployment-row";
import { commitUrl } from "@/lib/github";
import { feedRowsToViews, homepageListMode, LIVE_CAPTION, MIN_LIVE_ROWS, SAMPLE_CAPTION } from "@/lib/public-feed";
import type { FeedRow } from "@/server/public-feed";

const row = (over: Partial<FeedRow> = {}): FeedRow => ({
  message: "Fix the thing",
  sha: "abcdef1234",
  branch: "main",
  state: "ready",
  env: "production",
  at: "2026-11-13T10:00:00.000Z",
  repo: "sam/site",
  ...over,
});

describe("homepageListMode", () => {
  it("shows the live feed from three rows", () => {
    expect(MIN_LIVE_ROWS).toBe(3);
    expect(homepageListMode([row(), row(), row()])).toBe("live");
    expect(homepageListMode(new Array(8).fill(row()))).toBe("live");
  });

  it("falls back to the sample list with fewer rows, none, or no answer", () => {
    expect(homepageListMode([row(), row()])).toBe("sample");
    expect(homepageListMode([row()])).toBe("sample");
    expect(homepageListMode([])).toBe("sample");
    expect(homepageListMode(null)).toBe("sample");
    expect(homepageListMode(undefined)).toBe("sample");
  });

  it("has captions that say what the list is", () => {
    expect(SAMPLE_CAPTION).toBe("Sample data");
    expect(LIVE_CAPTION).toBe("Live: recent deployments from public projects that chose to show them");
  });
});

describe("feedRowsToViews", () => {
  it("copies the public fields and fills the rest with placeholders", () => {
    const [v] = feedRowsToViews([row({ state: "error", env: "preview" })], Date.parse("2026-11-13T12:00:00Z"));
    expect(v).toMatchObject({
      commit: "Fix the thing",
      sha: "abcdef1234",
      branch: "main",
      state: "error",
      env: "preview",
      repo: "sam/site",
      age: "2h ago",
      author: null,
      projectId: "live",
      port: 0,
      error: null,
    });
  });

  it("gives every view its own id and sends nothing but the feed's fields", () => {
    const views = feedRowsToViews([row(), row(), row()]);
    expect(new Set(views.map((v) => v.id)).size).toBe(3);
    const text = JSON.stringify(views);
    expect(text).not.toMatch(/secret|\/home\//i);
  });
});

describe("a live row on the page", () => {
  const html = (over: Partial<FeedRow> = {}) =>
    renderToStaticMarkup(
      createElement(DeploymentRow, { deployment: feedRowsToViews([row(over)])[0], showProject: false, demo: true, live: true })
    );

  it("opens the commit on GitHub in a new tab, without referrer, with a note for screen readers", () => {
    const out = html();
    expect(out).toContain('href="https://github.com/sam/site/commit/abcdef1234"');
    expect(out).toContain('target="_blank"');
    expect(out).toContain('rel="noreferrer"');
    expect(out).toContain("opens the commit on GitHub in a new tab");
    expect(out).toContain("Fix the thing");
  });

  it("shows no author and no actions menu", () => {
    const out = html();
    expect(out).not.toContain("sam-r");
    expect(out).not.toContain('role="menu"');
    expect(out).not.toMatch(/\?<\/span>/);
  });

  it("does not link a repository name with odd characters", () => {
    for (const repo of ["sam/site#x", "sam/site?x=1", "../x/y", "sam/..", "sam site/x", "javascript:alert(1)//a", 'sam/"onmouseover="x']) {
      const out = html({ repo });
      expect(out, repo).not.toContain("<a ");
      expect(out, repo).not.toContain("github.com");
    }
  });

  it("does not link a malformed commit", () => {
    expect(html({ sha: "xyz" })).not.toContain("github.com");
  });
});

describe("commitUrl", () => {
  it("builds the link only from validated parts", () => {
    expect(commitUrl("sam/site", "ABCDEF1234")).toBe("https://github.com/sam/site/commit/abcdef1234");
    expect(commitUrl("sam/site/extra", "abcdef1")).toBeNull();
    expect(commitUrl("sam/si te", "abcdef1")).toBeNull();
    expect(commitUrl("sam/site", "abcdef1/../x")).toBeNull();
  });
});
