"use client";

import { useId, useMemo, useState } from "react";
import Link from "next/link";
import { MagnifyingGlassIcon } from "@phosphor-icons/react";
import { CollapsibleNavGroup } from "@/components/collapsible-nav-group";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { docsHref, groupOf } from "../_data/nav";
import { filterNav, useCurrentDocsPage } from "./docs-nav";

// Row sizes follow the Loadout docs: 15px page links on a tall row with the
// text set in from the group label, and a filled row for the page you are on.
const rowClass =
  "flex min-h-9 w-full items-center gap-2 rounded-md px-3 py-1.5 text-left text-[15px] leading-5 tracking-[-0.01em] transition-colors duration-(--dur-fast) focus-visible:outline-offset-[-2px]";
const rowIdle = "font-normal text-muted-foreground hover:bg-[var(--ds-gray-alpha-100)] hover:text-foreground";
const rowCurrent = "bg-[var(--ds-gray-200)] font-medium text-foreground";

/**
 * The search field and the grouped, folding list of pages. The docs sidebar
 * (from 1280px) and the section bar's panel both render this, so the two stay
 * the same. Each group folds with `CollapsibleNavGroup`; the group you are
 * reading and every group during a search stay open. The page you are on is a
 * filled row. Page rows are links, so Tab and Enter work.
 */
export function DocsPageList({ onNavigate }: { onNavigate?: () => void }) {
  const current = useCurrentDocsPage();
  const currentGroup = current ? groupOf(current) : undefined;
  const [query, setQuery] = useState("");
  const baseId = useId();
  const inputId = `${baseId}-search`;
  const listId = `${baseId}-list`;
  const { groups, count } = useMemo(() => filterNav(query), [query]);
  const searching = query.trim() !== "";

  return (
    <div>
      <div className="mt-3">
        <label htmlFor={inputId} className="sr-only">
          Search docs
        </label>
        <div className="relative">
          <MagnifyingGlassIcon
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-subtle-foreground"
          />
          <Input
            id={inputId}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setQuery("");
            }}
            placeholder="Search docs"
            aria-controls={listId}
            autoComplete="off"
            spellCheck={false}
            className="pr-2 pl-8 text-left"
          />
        </div>
      </div>
      <p className="sr-only" aria-live="polite">
        {searching ? `${count} ${count === 1 ? "page" : "pages"}` : ""}
      </p>

      <nav id={listId} aria-label="Docs pages" className="pb-2">
        {groups.length === 0 ? (
          <p className="mt-3 px-2 text-left text-[14px] leading-5 text-muted-foreground">
            No pages match &ldquo;{query.trim()}&rdquo;.
          </p>
        ) : (
          groups.map(({ group, sections }) => (
            <CollapsibleNavGroup key={group} label={group} count={sections.length} locked={searching || group === currentGroup}>
              <ul className="flex-col gap-0.5 flex">
                {sections.map((section) => {
                  const isCurrent = section.id === current;
                  return (
                    <li key={section.id}>
                      <Link
                        href={docsHref(section.id)}
                        aria-current={isCurrent ? "page" : undefined}
                        onClick={onNavigate}
                        className={cn(rowClass, isCurrent ? rowCurrent : rowIdle)}
                      >
                        {section.title}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </CollapsibleNavGroup>
          ))
        )}
      </nav>
    </div>
  );
}
