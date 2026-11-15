"use client";

import { useRef } from "react";
import { cn } from "@/lib/utils";
import type { DocsSubsection } from "../_data/nav";
import { useActiveHeading, usePageHeadings } from "./use-page-headings";

/**
 * The headings of the page you are reading, in a rail from 1280px up, with
 * the one in view marked by a lit cell. Plain hash links: the browser does
 * the scrolling. `h2` headings are the sections and `h3` headings sit under
 * them. The list is read from the article body only (`[data-docs-body]`, never
 * the sidebar or the docs index), and the marked heading is the last one whose
 * top is above a reading line near the top of the window. Pages with fewer than
 * two headings show nothing.
 *
 * - `pageId`: the page's id, so the list is read again when the page changes.
 * - `items`: the headings from `_data/nav.ts`, drawn by the server until the real ones are read.
 */
export function OnThisPage({
  pageId,
  items,
}: {
  pageId: string;
  items: DocsSubsection[];
}) {
  const rootRef = useRef<HTMLSpanElement>(null);
  const headings = usePageHeadings(
    items.map((i) => ({ ...i, level: 2 as const })),
    pageId,
    rootRef,
  );
  const active = useActiveHeading(headings, rootRef);

  return (
    // `contents` keeps this marker out of the layout; it only tells the hooks which page's article is theirs.
    <span ref={rootRef} className="contents">
      {headings.length < 2 ? null : (
        <nav
          aria-label="On this page"
          className="sticky top-[calc(var(--topbar-height)+24px)] hidden max-h-[calc(100dvh-var(--topbar-height)-48px)] self-start overflow-y-auto min-[1280px]:block [scrollbar-width:thin]"
        >
          <p className="text-left text-[12px] leading-5 font-semibold tracking-[0.08em] text-foreground uppercase">
            On this page
          </p>
          <ul className="mt-3 border-l border-l-foreground/12">
            {headings.map((h) => {
              const current = h.id === active;
              return (
                <li key={h.id}>
                  {/* A 2px bar over the rail's own line marks the heading in view. */}
                  <a
                    href={`#${h.id}`}
                    aria-current={current ? "location" : undefined}
                    className={cn(
                      "-ml-px block min-h-8 border-l-2 py-1.5 pr-1 text-left text-[14px] leading-5 text-muted-foreground transition-colors duration-(--dur-fast) hover:text-foreground",
                      h.level === 2 ? "pl-[14px]" : "pl-[26px] text-[13px] text-subtle-foreground",
                      current ? "border-l-foreground font-medium text-foreground" : "border-l-transparent",
                    )}
                  >
                    {h.title}
                  </a>
                </li>
              );
            })}
          </ul>
        </nav>
      )}
    </span>
  );
}
