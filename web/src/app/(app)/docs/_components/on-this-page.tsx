"use client";

import { useScrollSpy } from "@/components/motion/use-scroll-spy";
import { cn } from "@/lib/utils";
import type { DocsSubsection } from "../_data/nav";
import { usePageHeadings } from "./use-page-headings";

/**
 * The headings of the page you are reading, in a rail from 1280px up, with
 * the one in view marked by a lit cell. Plain hash links: the browser does
 * the scrolling. `h2` headings are the sections and `h3` headings sit under
 * them. Pages with fewer than two headings show nothing.
 *
 * - `pageId`: the page's id, so the list is read again when the page changes.
 * - `items`: the headings from `_data/nav.ts`, drawn by the server until the real ones are read.
 */
export function OnThisPage({ pageId, items }: { pageId: string; items: DocsSubsection[] }) {
  const headings = usePageHeadings(
    items.map((i) => ({ ...i, level: 2 as const })),
    pageId
  );
  const active = useScrollSpy(
    headings.map((h) => h.id),
    { offset: 128 }
  );
  if (headings.length < 2) return null;

  return (
    <nav aria-label="On this page" className="sticky top-[calc(var(--topbar-height)+48px+16px)] hidden self-start max-h-[calc(100dvh-10rem)] overflow-y-auto min-[1280px]:block [scrollbar-width:thin]">
      <p className="text-[13px] leading-[30px] font-semibold text-foreground">On this page</p>
      <ul className="mt-[15px] border-l border-l-foreground/20">
        {headings.map((h) => {
          const current = h.id === active;
          return (
            <li key={h.id} className="relative">
              <a
                href={`#${h.id}`}
                aria-current={current ? "location" : undefined}
                className={cn(
                  "block py-1 pr-1 text-[13px] leading-5 text-muted-foreground transition-colors duration-(--dur-fast) hover:text-foreground",
                  h.level === 2 ? "pl-4" : "pl-7 text-subtle-foreground",
                  current && "font-medium text-foreground"
                )}
              >
                {h.title}
              </a>
              {current ? (
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute top-1/2 -left-[4px] size-[7px] -translate-y-1/2 bg-[var(--pixel-lit)]"
                />
              ) : null}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
