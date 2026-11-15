"use client";

import { useId, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { MagnifyingGlassIcon } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { DOCS_NAV, docsHref, sectionIdFromPath, type DocsGroup } from "../_data/nav";

/** The page the reader is on, or null on the docs home. */
export function useCurrentDocsPage(): string | null {
  return sectionIdFromPath(usePathname());
}

function filterNav(query: string): { groups: DocsGroup[]; count: number } {
  const q = query.trim().toLowerCase();
  if (q === "") return { groups: DOCS_NAV, count: DOCS_NAV.reduce((n, g) => n + g.sections.length, 0) };
  const groups: DocsGroup[] = [];
  let count = 0;
  for (const g of DOCS_NAV) {
    const groupMatch = g.group.toLowerCase().includes(q);
    const sections = g.sections.filter(
      (s) =>
        groupMatch ||
        s.title.toLowerCase().includes(q) ||
        s.subsections.some((sub) => sub.title.toLowerCase().includes(q))
    );
    if (sections.length > 0) {
      groups.push({ group: g.group, sections });
      count += sections.length;
    }
  }
  return { groups, count };
}

/**
 * The filter field and the grouped list of pages, shown in the panel of the
 * docs section bar. A small square marks the page you are on.
 */
export function DocsNavBody({ onNavigate }: { onNavigate?: () => void }) {
  const current = useCurrentDocsPage();
  const [query, setQuery] = useState("");
  const listId = useId();

  const { groups, count } = useMemo(() => filterNav(query), [query]);

  return (
    <div>
      <div className="relative max-w-sm">
        <MagnifyingGlassIcon
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-subtle-foreground"
        />
        <Input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape" && query) {
              // Clear the filter first; a second Escape closes the panel.
              e.stopPropagation();
              setQuery("");
            }
          }}
          placeholder="Filter pages…"
          aria-label="Filter docs pages"
          aria-controls={listId}
          autoComplete="off"
          spellCheck={false}
          className="bg-background pr-8 pl-8"
        />
      </div>
      <p className="sr-only" aria-live="polite">
        {query.trim() !== "" ? `${count} ${count === 1 ? "page" : "pages"}` : ""}
      </p>

      <div id={listId}>
        {groups.length === 0 ? (
          <div className="mt-4 px-1">
            <p className="text-[14px] leading-5 text-muted-foreground">No pages match &ldquo;{query.trim()}&rdquo;.</p>
            <Button variant="ghost" size="sm" className="mt-2" onClick={() => setQuery("")}>
              Clear filter
            </Button>
          </div>
        ) : (
          <div className="mt-4 lg:columns-3 lg:gap-8">
            {groups.map(({ group, sections }) => {
              const labelId = `${listId}-${group.replace(/\s+/g, "-")}`;
              return (
                <div key={group} className="mb-5 break-inside-avoid">
                  <p id={labelId} className="mb-1 px-2 text-[13px] leading-6 font-semibold text-foreground">
                    {group}
                  </p>
                  <ul aria-labelledby={labelId}>
                    {sections.map((section) => {
                      const isCurrent = section.id === current;
                      return (
                        <li key={section.id} className="relative">
                          <Link
                            href={docsHref(section.id)}
                            aria-current={isCurrent ? "page" : undefined}
                            onClick={onNavigate}
                            className={cn(
                              "flex min-h-10 items-center rounded-md px-2 text-[14px] leading-5 text-muted-foreground transition-colors duration-(--dur-fast) hover:bg-[var(--ds-gray-alpha-100)] hover:text-foreground lg:min-h-8",
                              isCurrent && "bg-[var(--ds-gray-alpha-100)] font-medium text-foreground"
                            )}
                          >
                            {section.title}
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
