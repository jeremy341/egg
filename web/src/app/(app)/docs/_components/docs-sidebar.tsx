"use client";

import { useId, useMemo, useState } from "react";
import Link from "next/link";
import { MagnifyingGlassIcon } from "@phosphor-icons/react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { docsHref, getSection } from "../_data/nav";
import { filterNav, useCurrentDocsPage } from "./docs-nav";
import { usePageHeadings } from "./use-page-headings";

/**
 * The docs sidebar, from 1280px. It lists every page by group, marks the page
 * you are on with a lit square, and opens the headings of that page under it
 * until the "On this page" rail takes over at 1400px. Below 1280px the
 * section bar does this job instead.
 */
export function DocsSidebar() {
  const current = useCurrentDocsPage();
  const [query, setQuery] = useState("");
  const listId = useId();
  const { groups, count } = useMemo(() => filterNav(query), [query]);
  // The page sections of the page on screen, read from it so a heading added to a page shows up here.
  const fallback = (current ? (getSection(current)?.subsections ?? []) : []).map((s) => ({ ...s, level: 2 as const }));
  const subsections = usePageHeadings(fallback, current ?? "").filter((h) => h.level === 2);

  return (
    <aside
      aria-label="Docs"
      className="sticky top-[calc(var(--topbar-height)+24px)] hidden max-h-[calc(100dvh-var(--topbar-height)-48px)] self-start overflow-y-auto overscroll-contain pr-1 [scrollbar-width:thin] min-[1280px]:block"
    >
      <Link
        href="/docs"
        aria-current={current ? undefined : "page"}
        className={cn(
          "flex min-h-8 items-center rounded-md px-2 text-[14px] leading-5 font-medium hover:bg-[var(--ds-gray-alpha-100)]",
          current ? "text-muted-foreground hover:text-foreground" : "bg-[var(--ds-gray-alpha-100)] text-foreground"
        )}
      >
        All pages
      </Link>
      <div className="relative mt-2">
        <MagnifyingGlassIcon
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-subtle-foreground"
        />
        <Input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") setQuery("");
          }}
          placeholder="Filter pages"
          aria-label="Filter docs pages"
          aria-controls={listId}
          autoComplete="off"
          spellCheck={false}
          className="bg-background pr-2 pl-8"
        />
      </div>
      <p className="sr-only" aria-live="polite">
        {query.trim() !== "" ? `${count} ${count === 1 ? "page" : "pages"}` : ""}
      </p>

      <nav id={listId} aria-label="Docs pages" className="mt-4">
        {groups.length === 0 ? (
          <p className="px-2 text-[14px] leading-5 text-muted-foreground">No pages match &ldquo;{query.trim()}&rdquo;.</p>
        ) : (
          groups.map(({ group, sections }) => (
            <div key={group} className="mb-5">
              <p className="mb-1 px-2 text-[13px] leading-6 font-semibold text-foreground">{group}</p>
              <ul>
                {sections.map((section) => {
                  const isCurrent = section.id === current;
                  return (
                    <li key={section.id}>
                      <Link
                        href={docsHref(section.id)}
                        aria-current={isCurrent ? "page" : undefined}
                        className={cn(
                          "relative flex min-h-8 items-center rounded-md px-2 py-1 text-[14px] leading-5 text-muted-foreground transition-colors duration-(--dur-fast) hover:bg-[var(--ds-gray-alpha-100)] hover:text-foreground",
                          isCurrent && "bg-[var(--ds-gray-alpha-100)] font-medium text-foreground"
                        )}
                      >
                        {isCurrent ? (
                          <span
                            aria-hidden="true"
                            className="absolute top-1/2 -left-[3px] size-[7px] -translate-y-1/2 bg-[var(--pixel-lit)]"
                          />
                        ) : null}
                        {section.title}
                      </Link>
                      {isCurrent && subsections.length > 1 && query.trim() === "" ? (
                        <ul className="mt-0.5 mb-1 ml-3 border-l pl-2 min-[1400px]:hidden">
                          {subsections.map((sub) => (
                            <li key={sub.id}>
                              <a
                                href={`#${sub.id}`}
                                className="flex min-h-7 items-center rounded-md px-2 text-[13px] leading-4 text-muted-foreground hover:text-foreground"
                              >
                                {sub.title}
                              </a>
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </div>
          ))
        )}
      </nav>
    </aside>
  );
}
