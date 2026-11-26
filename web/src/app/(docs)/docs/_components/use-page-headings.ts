"use client";

import { useEffect, useState, type RefObject } from "react";

/** A heading of the page being read: an `h2` (a page section) or an `h3` (a subsection). */
export type PageHeading = { id: string; title: string; level: 2 | 3 };

/** A heading found in the article, with its element (to measure) and its place in the list. */
type Found = PageHeading & { el: HTMLElement };

/**
 * The article body being read. Next keeps pages you have left in the document
 * (hidden), so a page can have more than one `[data-docs-body]`. With `from`
 * (an element beside the article) the body is the one in the same
 * `[data-docs-page]` wrapper; without it, the first one that is on screen.
 */
function articleBody(from?: Element | null): Element | null {
  const own = from
    ?.closest("[data-docs-page]")
    ?.querySelector("[data-docs-body]");
  if (own) return own;
  const all = Array.from(document.querySelectorAll("[data-docs-body]"));
  return all.find((el) => el.getClientRects().length > 0) ?? all[0] ?? null;
}

function findHeadings(from?: Element | null): Found[] {
  const body = articleBody(from);
  if (!body) return [];
  const nodes = body.querySelectorAll<HTMLElement>("h2[id], h3[id]");
  return Array.from(nodes, (el) => ({
    id: el.id,
    title: (el.textContent ?? "").trim(),
    level: el.tagName === "H3" ? (3 as const) : (2 as const),
    el,
  })).filter((h) => h.title !== "");
}

/**
 * The h2 and h3 headings of the article body only (never the sidebar or the
 * docs index), in document order.
 */
export function scanPageHeadings(from?: Element | null): PageHeading[] {
  return findHeadings(from).map(({ id, title, level }) => ({
    id,
    title,
    level,
  }));
}

/**
 * The headings of the article on screen. `fallback` is what the server drew
 * (so the list exists with scripts off); once mounted the real headings are
 * read from the article, so a heading added to a page shows up with no list to
 * keep in step. `key` changes when the page changes. `rootRef` is an element
 * beside the article, used to find this page's own article.
 */
export function usePageHeadings(
  fallback: PageHeading[],
  key: string,
  rootRef?: RefObject<Element | null>,
): PageHeading[] {
  const [items, setItems] = useState(fallback);
  useEffect(() => {
    const found = scanPageHeadings(rootRef?.current);
    setItems(found.length > 0 ? found : fallback);
    // `fallback` is derived from `key`, so only the key matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return items;
}

/** How far from the top of the window the reading line is, in px. Headings stop 128px down when linked to. */
export const READING_LINE = 160;

/**
 * The id of the heading the reader is in: the last one whose top is above the
 * reading line, so it follows the scroll. At the very bottom of the page it is
 * the last heading (a short last section would otherwise never be reached);
 * above the first heading it is null.
 */
export function useActiveHeading(
  headings: PageHeading[],
  rootRef?: RefObject<Element | null>,
): string | null {
  const [active, setActive] = useState<string | null>(null);
  const key = headings.map((h) => h.id).join("|");

  useEffect(() => {
    const body = articleBody(rootRef?.current);
    const els = (key ? key.split("|") : [])
      .map((id) =>
        body
          ? body.querySelector<HTMLElement>(`[id="${CSS.escape(id)}"]`)
          : null,
      )
      .filter((el): el is HTMLElement => el !== null);
    if (els.length === 0) {
      setActive(null);
      return;
    }

    let frame = 0;
    const evaluate = () => {
      frame = 0;
      const doc = document.documentElement;
      const atBottom =
        window.scrollY > 0 &&
        window.scrollY + window.innerHeight >= doc.scrollHeight - 2;
      let current: string | null = atBottom ? els[els.length - 1].id : null;
      if (!atBottom) {
        for (const el of els) {
          if (el.getBoundingClientRect().top <= READING_LINE) current = el.id;
          else break;
        }
      }
      setActive(current);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(evaluate);
    };

    evaluate();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    window.addEventListener("hashchange", schedule);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      window.removeEventListener("hashchange", schedule);
    };
  }, [key, rootRef]);

  return active;
}
