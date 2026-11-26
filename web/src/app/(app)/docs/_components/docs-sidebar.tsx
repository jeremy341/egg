"use client";

import { useId, useMemo, useState } from "react";
import Link from "next/link";
import { MagnifyingGlassIcon } from "@phosphor-icons/react";
import { navItemCurrent, navItemIdle } from "@/components/nav-list";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { docsHref } from "../_data/nav";
import { filterNav, useCurrentDocsPage } from "./docs-nav";

const rowClass =
  "flex min-h-8 items-center gap-2 rounded-md px-2 py-1 text-[14px] leading-5 font-medium tracking-[-0.01em] transition-colors duration-(--dur-fast) focus-visible:outline-offset-[-2px]";

/**
 * The docs page list, from 1280px. It sits on the app background beside the
 * page, grouped like the app's own navigation: a hover tint on each row and a
 * tinted row with a small square for the page you are on. Below 1280px the
 * section bar opens the same list. Every row is a link, so Tab and Enter work.
 */
export function DocsSidebar() {
  const current = useCurrentDocsPage();
  const [query, setQuery] = useState("");
  const listId = useId();
  const { groups, count } = useMemo(() => filterNav(query), [query]);

  return (
    <aside
      aria-label="Docs"
      className="sticky top-[calc(var(--topbar-height)+24px)] hidden max-h-[calc(100dvh-var(--topbar-height)-48px)] self-start overflow-y-auto overscroll-contain [scrollbar-width:thin] min-[1280px]:block"
    >
      <div className="relative">
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
          className="pr-2 pl-8"
        />
      </div>
      <p className="sr-only" aria-live="polite">
        {query.trim() !== "" ? `${count} ${count === 1 ? "page" : "pages"}` : ""}
      </p>

      <nav id={listId} aria-label="Docs pages" className="mt-3 pb-2">
        <Link
          href="/docs"
          aria-current={current ? undefined : "page"}
          className={cn(rowClass, current ? navItemIdle : navItemCurrent)}
        >
          All pages
          {current ? null : <span aria-hidden="true" className="ml-auto size-1.5 shrink-0 rounded-[1px] bg-foreground" />}
        </Link>
        {groups.length === 0 ? (
          <p className="mt-3 px-2 text-[14px] leading-5 text-muted-foreground">No pages match &ldquo;{query.trim()}&rdquo;.</p>
        ) : (
          groups.map(({ group, sections }) => {
            const labelId = `${listId}-${group.replace(/\s+/g, "-")}`;
            return (
              <div key={group} className="mt-4">
                <p id={labelId} className="px-2 pb-1 text-[12px] leading-5 text-subtle-foreground">
                  {group}
                </p>
                <ul aria-labelledby={labelId} className="flex flex-col gap-0.5">
                  {sections.map((section) => {
                    const isCurrent = section.id === current;
                    return (
                      <li key={section.id}>
                        <Link
                          href={docsHref(section.id)}
                          aria-current={isCurrent ? "page" : undefined}
                          className={cn(rowClass, isCurrent ? navItemCurrent : navItemIdle)}
                        >
                          {section.title}
                          {isCurrent ? (
                            <span aria-hidden="true" className="ml-auto size-1.5 shrink-0 rounded-[1px] bg-foreground" />
                          ) : null}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })
        )}
      </nav>
    </aside>
  );
}
