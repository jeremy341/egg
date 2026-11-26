import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import PrivacyPage from "../privacy/page";
import SecurityPage from "./page";

const html = renderToStaticMarkup(createElement(SecurityPage));
const text = (markup: string) => markup.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
const source = readFileSync(path.resolve(__dirname, "page.tsx"), "utf8");

/** The ids the page's sections carry, in page order. */
const sectionIds = [...html.matchAll(/<section id="([a-z]+)"/g)].map((m) => m[1]);

describe("security page layout", () => {
  it("has one h1, and one h2 for each section, each naming its section", () => {
    expect(html.match(/<h1/g)).toHaveLength(1);
    expect(sectionIds).toHaveLength(16);
    expect(new Set(sectionIds).size).toBe(16);
    for (const id of sectionIds) {
      expect(html, id).toContain(`<section id="${id}" aria-labelledby="${id}-title"`);
      expect(html, id).toMatch(new RegExp(`<h2 id="${id}-title"`));
    }
    expect(html.match(/<h2/g)).toHaveLength(16);
  });

  it("starts with the short version, and ends with how to report a vulnerability", () => {
    expect(sectionIds[0]).toBe("short");
    expect(sectionIds.at(-1)).toBe("report");
  });

  it("lists every section in the On this page list, in page order, under its group", () => {
    // The list is drawn twice: the column beside the page, and the closed disclosure for small screens.
    const navs = [...html.matchAll(/<nav aria-label="On this page"[\s\S]*?<\/nav>/g)].map((m) => m[0]);
    expect(navs).toHaveLength(2);
    for (const nav of navs) {
      expect([...nav.matchAll(/href="#([a-z]+)"/g)].map((m) => m[1])).toEqual(sectionIds);
      for (const group of ["On your container", "Secrets and sign-in", "Requests from outside", "Builds and data", "Leaving and reporting"]) {
        expect(text(nav)).toContain(group);
      }
    }
  });

  it("links every sentence of the short version to a section that exists", () => {
    const short = /<section id="short"[\s\S]*?<\/section>/.exec(html)![0];
    const links = [...short.matchAll(/href="#([a-z]+)"/g)].map((m) => m[1]);
    expect(links).toHaveLength(8);
    for (const id of links) expect(sectionIds).toContain(id);
  });

  it("says nothing in the short version that the page does not state in full", () => {
    // Each claim of the summary, and the words further down the page that make it.
    const backed: [string, string][] = [
      ["Egg works in four places on your container and nowhere else.", "works in four places and nowhere else."],
      ["A new container starts with all three switches off", "A new container starts with all three switches off."],
      ["are encrypted before they are stored, with AES-256-GCM", "is encrypted before it is stored, with AES-256-GCM."],
      ["your environment variables are encrypted", "Encrypted the same way as the SSH key"],
      ["reaches only your own projects, servers and domains", "A token reaches only your own projects, servers and domains."],
      ["it cannot create another token", "A token cannot create another token."],
      ["Your code is built on your own Nest container, under a memory and CPU cap.", "Your code is built on your own Nest container, in a new release folder, under a memory and CPU cap."],
      ["Page analytics are off until you turn them on for a project", "Page analytics are off until you turn them on for a project."],
      ["the script sets no cookie", "It sets no cookie."],
      ["Removing Egg takes two steps", "Removing Egg takes two steps."],
      ["your apps keep running", "Your apps keep running."],
      ["The gaps that are known are listed on this page.", "These are the gaps that are known."],
    ];
    const body = source.replace(/\s+/g, " ");
    for (const [claim, statement] of backed) {
      expect(body, claim).toContain(claim);
      expect(body, statement).toContain(statement);
    }
  });

  it("does not number its sections: their order is not a sequence of steps", () => {
    expect(source).not.toMatch(/number=\{/);
    expect(text(html)).not.toMatch(/\b0[1-9] (What Egg can touch|The three switches|Keys and secrets)/);
  });

  it("keeps the caution about guarantees ahead of the detail, as a note and not a coloured side border", () => {
    const header = /<header[\s\S]*?<\/header>/.exec(html)![0];
    expect(text(header)).toContain("Security is an ongoing effort, not a guarantee.");
    expect(text(header)).toContain("not a security certification");
    expect(header).toContain("<aside");
    expect(html).not.toContain("border-l-4");
  });

  it("offers the report form's section from the top of the page, and the private inbox from the end", () => {
    const header = /<header[\s\S]*?<\/header>/.exec(html)![0];
    expect(header).toContain('href="#report"');
    const report = /<section id="report"[\s\S]*?<\/section>/.exec(html)![0];
    expect(report).toContain('href="/security/reports"');
    expect(report).toContain("/security/advisories/new");
    // Reporting happens in the app, behind sign-in; the public page links to it.
    expect(report).toContain('href="/security/report"');
    expect(text(report)).toContain("sign in with Hack Club");
  });

  it("uses the pixel face on every heading and no app theme class", () => {
    for (const tag of [...html.matchAll(/<h[123][^>]*class="([^"]*)"/g)]) {
      // The report form's own title is a control label inside a form, set in the UI face.
      if (tag[0].includes('id="report-form-title"')) continue;
      expect(tag[1], tag[0]).toContain("font-pixel");
    }
  });
});

describe("security page analytics section", () => {
  const section = text(/<section id="analytics"[\s\S]*?<\/section>/.exec(html)![0]);

  it("says campaign values are a separate switch and only listed values are kept", () => {
    expect(section).toContain("Campaign values are a separate switch, Campaigns, that is off until you turn it on.");
    expect(section).toContain("only when the value is one you listed for the project, spelled exactly (up to 20 values for each, 40 characters at most)");
    expect(section).toContain("Any other value is dropped before it is stored");
    expect(section).not.toContain("cut to 80 characters");
  });

  it("says retention is 30, 60 or 90 days for each project, and 90 until chosen", () => {
    expect(section).toMatch(/deleted after 30, 60 or 90 days, as you choose for each project, and after 90 days until you choose/);
  });

  it("says which switches delete what they stored, and describes the country lookup", () => {
    expect(section).toContain("Turning Referrers, Campaigns, Retention or Record visitor countries off deletes what that switch stored for the project.");
    expect(section).toContain("Record visitor countries is a separate switch that is off by default.");
    expect(section).toContain("in a country database that ships with Egg, so it is not sent to another service. Only the two-letter country code is stored.");
    expect(section).toContain("Egg does not store or log the address for this");
  });
});

describe("privacy page layout", () => {
  const privacy = renderToStaticMarkup(createElement(PrivacyPage));

  it("is built from the same parts: one sheet, unnumbered sections, the same list beside it", () => {
    const ids = [...privacy.matchAll(/<section id="([a-z]+)"/g)].map((m) => m[1]);
    expect(ids).toHaveLength(9);
    expect(privacy.match(/<h1/g)).toHaveLength(1);
    const nav = /<nav aria-label="On this page"[\s\S]*?<\/nav>/.exec(privacy)![0];
    expect([...nav.matchAll(/href="#([a-z]+)"/g)].map((m) => m[1])).toEqual(ids);
    expect(privacy).not.toContain("border-l-4");
  });
});
