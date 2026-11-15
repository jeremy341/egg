import { describe, expect, it } from "vitest";
import { CONTENT } from "../_content";
import { filterIndex } from "./index-filter";
import { DOCS_NAV, DOCS_SECTIONS } from "./nav";
import { SUMMARIES } from "./summaries";

describe("docs summaries", () => {
  it("has one sentence for every section in the nav, and nothing extra", () => {
    const ids = DOCS_SECTIONS.map((s) => s.id).sort();
    expect(Object.keys(SUMMARIES).sort()).toEqual(ids);
  });

  it("are plain sentences: they end with a full stop and use no dashes", () => {
    for (const [id, text] of Object.entries(SUMMARIES)) {
      expect(text.trim(), id).toBe(text);
      expect(text.length, id).toBeGreaterThan(20);
      expect(text, id).toMatch(/\.$/);
      expect(text, id).not.toMatch(/[\u2013\u2014]/);
    }
  });

  it("has a page body for every section id", () => {
    for (const s of DOCS_SECTIONS) expect(typeof CONTENT[s.id], s.id).toBe("function");
    expect(Object.keys(CONTENT).sort()).toEqual(DOCS_SECTIONS.map((s) => s.id).sort());
  });
});

describe("filterIndex", () => {
  const total = DOCS_SECTIONS.length;

  it("returns every group and page for an empty or blank query", () => {
    for (const q of ["", "   "]) {
      const r = filterIndex(q);
      expect(r.groups).toEqual(DOCS_NAV);
      expect(r.count).toBe(total);
    }
  });

  it("matches a page by title, ignoring case", () => {
    const r = filterIndex("DOMAINS");
    expect(r.groups.flatMap((g) => g.sections.map((s) => s.id))).toContain("domains");
  });

  it("matches a page by one of its subsection titles", () => {
    const r = filterIndex("rotating");
    expect(r.groups.flatMap((g) => g.sections.map((s) => s.id))).toEqual(["servers"]);
  });

  it("matches a page by its summary", () => {
    const word = SUMMARIES.hooks.split(" ").find((w) => w.length > 5)!.replace(/[^a-z]/gi, "");
    const ids = filterIndex(word).groups.flatMap((g) => g.sections.map((s) => s.id));
    expect(ids).toContain("hooks");
  });

  it("keeps a whole group when the query is the group name", () => {
    const r = filterIndex("automate");
    expect(r.groups.map((g) => g.group)).toEqual(["Automate"]);
    expect(r.count).toBe(DOCS_NAV.find((g) => g.group === "Automate")!.sections.length);
  });

  it("drops groups with no match and reports zero for nonsense", () => {
    const r = filterIndex("zzzzqqq");
    expect(r.groups).toEqual([]);
    expect(r.count).toBe(0);
  });
});
