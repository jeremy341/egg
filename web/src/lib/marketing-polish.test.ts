import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { GRID } from "@/app/(marketing)/stats/_components/layout";
import { H3 } from "@/app/(app)/docs/_components/prose";
import { MARKETING_NAV, footerLinks } from "@/lib/marketing-nav";

const root = path.resolve(__dirname, "../..");

describe("marketing navigation", () => {
  it("links to the stats page in the header and the footer", () => {
    expect(MARKETING_NAV.some((l) => l.href === "/stats" && l.label === "Stats")).toBe(true);
    expect(footerLinks().some((l) => l.href === "/stats")).toBe(true);
  });

  it("does not repeat the footer column heading as a link", () => {
    expect(footerLinks().map((l) => l.label)).not.toContain("Product");
    expect(footerLinks().find((l) => l.href === "/#product")).toBeTruthy();
  });
});

describe("docs are not public", () => {
  it("keeps the docs out of the public site's links", () => {
    expect(MARKETING_NAV.some((l) => l.href.startsWith("/docs"))).toBe(false);
    expect(footerLinks().some((l) => l.href.startsWith("/docs"))).toBe(false);
  });
});

describe("stats grid", () => {
  it("uses the full width of the page wrapper, like the hairlines and the header", () => {
    expect(GRID).not.toMatch(/max-w-/);
  });
});

describe("docs headings", () => {
  it("renders a section heading as an h2 under the page's h1", () => {
    const html = renderToStaticMarkup(createElement(H3, { id: "overview-push" }));
    expect(html).toMatch(/<h2\b/);
    expect(html).not.toMatch(/<h3\b/);
  });
});

describe("text links", () => {
  it("draws the resting underline at gray alpha 600", () => {
    const css = readFileSync(path.join(root, "src/app/globals.css"), "utf8");
    const rule = css.slice(css.indexOf("@utility link {"));
    const rest = rule.slice(0, rule.indexOf("transition:"));
    expect(rest).toContain("text-decoration-color: var(--ds-gray-alpha-600)");
  });
});
