"use client";

import { useEffect, useState } from "react";

/** A heading of the page being read: an `h2` (a page section) or an `h3` (a subsection). */
export type PageHeading = { id: string; title: string; level: 2 | 3 };

/** The h2 and h3 headings that carry an id inside the docs article, in document order. */
export function scanPageHeadings(): PageHeading[] {
  const nodes = document.querySelectorAll<HTMLElement>("#docs-article h2[id], #docs-article h3[id]");
  return Array.from(nodes, (el) => ({
    id: el.id,
    title: (el.textContent ?? "").trim(),
    level: el.tagName === "H3" ? (3 as const) : (2 as const),
  })).filter((h) => h.title !== "");
}

/**
 * The headings of the article on screen. `fallback` is what the server drew
 * (so the list exists with scripts off); once mounted the real headings are
 * read from the page, so a heading added to a page shows up with no list to
 * keep in step. `key` changes when the page changes.
 */
export function usePageHeadings(fallback: PageHeading[], key: string): PageHeading[] {
  const [items, setItems] = useState(fallback);
  useEffect(() => {
    const found = scanPageHeadings();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reads the DOM after mount
    setItems(found.length > 0 ? found : fallback);
    // `fallback` is derived from `key`, so only the key matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return items;
}
