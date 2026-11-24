import { describe, expect, it } from "vitest";
import { GET as pageMd } from "../docs-md/[slug]/route";
import { GET as llmsTxt } from "../llms.txt/route";
import { GET as llmsFullTxt } from "../llms-full.txt/route";
import { DOCS_SECTIONS, getSection } from "./_data/nav";

const origin = "http://localhost:3100";
/** Markup the renderer would leave behind if a tag or attribute were not turned into Markdown. */
const HTML_TAG = /class="|aria-|<svg|<\/?(?:div|span|section|article|button)[\s>]/;
const params = (slug: string) => ({ params: Promise.resolve({ slug }) });

describe("/docs/<slug>.md", () => {
  it("returns the page as Markdown, starting with its title", async () => {
    const res = await pageMd(new Request(`${origin}/docs-md/quickstart`), params("quickstart"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/markdown; charset=utf-8");
    const body = await res.text();
    expect(body).toContain("# Quick start\n");
    expect(body).toContain("**Continue with Hack Club**");
    expect(body).not.toMatch(HTML_TAG);
  });

  it("gives every page its own heading and no HTML", async () => {
    for (const section of DOCS_SECTIONS) {
      const body = await (await pageMd(new Request(`${origin}/docs-md/${section.id}`), params(section.id))).text();
      expect(body, section.id).toContain(`# ${section.title}\n`);
      expect(body, section.id).not.toMatch(HTML_TAG);
    }
  });

  it("answers 404 for a page that does not exist", async () => {
    const res = await pageMd(new Request(`${origin}/docs-md/nope`), params("nope"));
    expect(res.status).toBe(404);
    expect(getSection("nope")).toBeUndefined();
  });
});

describe("/llms.txt", () => {
  it("lists every page with its Markdown address and title", async () => {
    const res = await llmsTxt(new Request(`${origin}/llms.txt`));
    expect(res.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    const body = await res.text();
    expect(body.startsWith("# Egg docs\n")).toBe(true);
    expect(body).toContain("- [Quick start](http://localhost:3100/docs/quickstart.md): ");
    const links = body.match(/^- \[.+\]\(.+\.md\)/gm) ?? [];
    expect(links).toHaveLength(DOCS_SECTIONS.length);
  });
});

describe("/llms-full.txt", () => {
  it("holds every page as Markdown", async () => {
    const body = await (await llmsFullTxt()).text();
    expect(body.startsWith("# Egg docs\n")).toBe(true);
    expect(body).toContain("# Quick start\n");
    expect(body).toContain("# Servers\n");
    expect(body.split("\n\n---\n\n")).toHaveLength(DOCS_SECTIONS.length);
  });
});
