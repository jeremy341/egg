import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CONTENT } from "../_content";
import { DOCS_SECTIONS } from "./nav";

/** The headings of a rendered page, in order: level and id. */
function headingsOf(html: string): { level: number; id: string | null; text: string }[] {
  const out: { level: number; id: string | null; text: string }[] = [];
  for (const m of html.matchAll(/<h([1-6])\b([^>]*)>([\s\S]*?)<\/h\1>/g)) {
    const id = /\bid="([^"]*)"/.exec(m[2])?.[1] ?? null;
    out.push({ level: Number(m[1]), id, text: m[3].replace(/<[^>]*>/g, "").trim() });
  }
  return out;
}

function render(id: string): string {
  const Page = CONTENT[id];
  return renderToStaticMarkup(createElement(() => Page()));
}

describe("docs page headings", () => {
  for (const s of DOCS_SECTIONS) {
    it(`${s.id}: one h1 first, and no level is skipped going down`, () => {
      const headings = headingsOf(render(s.id));
      expect(headings.length, "page has headings").toBeGreaterThan(0);
      expect(headings[0].level, "starts with the h1").toBe(1);
      expect(headings.filter((h) => h.level === 1), "exactly one h1").toHaveLength(1);
      for (let i = 1; i < headings.length; i++) {
        const jump = headings[i].level - headings[i - 1].level;
        expect(
          jump,
          `"${headings[i].text}" (h${headings[i].level}) follows "${headings[i - 1].text}" (h${headings[i - 1].level})`
        ).toBeLessThanOrEqual(1);
      }
    });

    it(`${s.id}: heading ids are unique, and every h2 and h3 has one`, () => {
      const headings = headingsOf(render(s.id));
      const ids = headings.map((h) => h.id).filter((id): id is string => id !== null);
      expect(new Set(ids).size, "duplicate heading ids").toBe(ids.length);
      for (const h of headings.filter((h) => h.level === 2 || h.level === 3)) {
        // Worked-example parts ("Given", "Do", "Result") are h3 or h4 labels with no link target.
        if (["Given", "Do", "Result"].includes(h.text)) continue;
        expect(h.id, `"${h.text}" has an id`).not.toBeNull();
      }
    });
  }
});

describe("docs content", () => {
  it("has a page body for every nav entry, and nothing extra", () => {
    const ids = DOCS_SECTIONS.map((s) => s.id).sort();
    expect(Object.keys(CONTENT).sort()).toEqual(ids);
  });

  it("draws every nav subsection id on its page", () => {
    for (const s of DOCS_SECTIONS) {
      const present = new Set(headingsOf(render(s.id)).map((h) => h.id));
      for (const sub of s.subsections) expect(present.has(sub.id), `${s.id} is missing ${sub.id}`).toBe(true);
    }
  });
});
