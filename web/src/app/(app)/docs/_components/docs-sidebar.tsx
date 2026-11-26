"use client";

import { useId, useMemo, useState } from "react";
import Link from "next/link";
import { CaretDownIcon, CaretLeftIcon, MagnifyingGlassIcon } from "@phosphor-icons/react";
import { navItemClass, navItemIdle } from "@/components/nav-list";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { docsHref, groupOf } from "../_data/nav";
import { filterNav, useCurrentDocsPage } from "./docs-nav";

// Row sizes follow the Loadout docs: 15px page links on a tall row with the
// text set in from the group label, 12px uppercase group labels with a small
// count and a caret, and a filled row for the page you are on.
const rowClass =
  "flex min-h-9 w-full items-center gap-2 rounded-md px-3 py-1.5 text-left text-[15px] leading-5 tracking-[-0.01em] transition-colors duration-(--dur-fast) focus-visible:outline-offset-[-2px]";
const rowIdle = "font-normal text-muted-foreground hover:bg-[var(--ds-gray-alpha-100)] hover:text-foreground";
const rowCurrent = "bg-[var(--ds-gray-200)] font-medium text-foreground";

/**
 * The docs page list, shown by the app sidebar in place of its project and
 * team links while the reader is on a docs route (from 1280px; below that the
 * section bar opens the same list). It leads with the way back to the projects
 * and a search field, then the pages in groups. Each group header is a button
 * that folds the group (open by default; the group with the page you are on
 * stays open, and so does every group while a search is typed), with the number
 * of pages on its right. The page you are on is a filled row. Page rows are
 * links, so Tab and Enter work.
 */
export function DocsSidebarNav() {
  return (
    <div>
      <Link href="/projects" className={cn(navItemClass, navItemIdle)}>
        <CaretLeftIcon aria-hidden="true" className="size-4 shrink-0" />
        Back to projects
      </Link>
      <DocsPageList />
    </div>
  );
}

/**
 * The search field and the grouped, folding list of pages. The app sidebar and
 * the section bar's panel both render this, so the two stay the same.
 */
export function DocsPageList({ onNavigate }: { onNavigate?: () => void }) {
  const current = useCurrentDocsPage();
  const currentGroup = current ? groupOf(current) : undefined;
  const [query, setQuery] = useState("");
  const [folded, setFolded] = useState<Record<string, boolean>>({});
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
          groups.map(({ group, sections }) => {
            const slug = group.replace(/\s+/g, "-");
            const labelId = `${baseId}-${slug}`;
            const panelId = `${baseId}-${slug}-pages`;
            // The group you are reading and every group during a search stay open.
            const open = searching || group === currentGroup || !folded[group];
            const locked = searching || group === currentGroup;
            return (
              <div key={group} className="mt-4">
                <div>
                  <button
                    type="button"
                    id={labelId}
                    aria-expanded={open}
                    aria-controls={panelId}
                    onClick={() => {
                      if (!locked) setFolded((f) => ({ ...f, [group]: open }));
                    }}
                    className={cn(
                      "flex min-h-8 w-full items-center gap-2 rounded-md px-3 text-left text-[12px] leading-4 font-semibold tracking-[0.08em] text-subtle-foreground uppercase transition-colors duration-(--dur-fast) hover:text-foreground focus-visible:outline-offset-[-2px]",
                      locked && "cursor-default"
                    )}
                  >
                    <span className="min-w-0 flex-1">{group}</span>
                    <span className="text-[11px] font-medium tracking-normal tabular-nums" aria-label={`${sections.length} pages`}>
                      {sections.length}
                    </span>
                    <CaretDownIcon
                      aria-hidden="true"
                      weight="bold"
                      className={cn("size-3 shrink-0 transition-transform duration-(--dur-fast)", !open && "-rotate-90")}
                    />
                  </button>
                </div>
                <ul id={panelId} aria-labelledby={labelId} hidden={!open} className={cn("mt-0.5 flex-col gap-0.5", open ? "flex" : "hidden")}>
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
              </div>
            );
          })
        )}
      </nav>
    </div>
  );
}
