"use client";

import { useId, useMemo, useState } from "react";
import Link from "next/link";
import { MagnifyingGlassIcon } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { docsHref } from "../_data/nav";
import { filterIndex } from "../_data/index-filter";
import { SUMMARIES } from "../_data/summaries";
import { H2_CLASS } from "./prose";

/** What each group is for, in one line, so the list reads in order. */
const GROUP_NOTES: Record<string, string> = {
  Start: "What it is, and your first deploy.",
  "Use it": "What you do with a project, day to day.",
  Automate: "Deploy and call the API without opening the dashboard.",
  Watch: "Know that apps are up, and what changed.",
  Reference: "Look things up: security, limits and fixes.",
};

/**
 * Every docs page, grouped like the sidebar, one row each: the page title and
 * what it covers. It is built from `DOCS_NAV` and `SUMMARIES`, so it cannot
 * drift from the sidebar. The filter narrows by title, summary or section.
 */
export function DocsIndex() {
  const [query, setQuery] = useState("");
  const listId = useId();
  const { groups, count } = useMemo(() => filterIndex(query), [query]);
  const filtering = query.trim() !== "";

  return (
    <section aria-labelledby="docs-all-pages" className="mt-[60px]">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-[15px]">
        <h2 id="docs-all-pages" className={H2_CLASS}>
          All pages
        </h2>
        <p aria-live="polite" className="text-[14px] leading-5 text-muted-foreground sm:order-last sm:ml-auto">
          {count} {count === 1 ? "page" : "pages"}
          {filtering ? " match" : ""}
        </p>
        <div className="relative w-full sm:w-72">
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
            aria-label="Filter all docs pages"
            aria-controls={listId}
            autoComplete="off"
            spellCheck={false}
            className="pl-8"
          />
        </div>
      </div>

      <div id={listId} className="mt-[30px]">
        {groups.length === 0 ? (
          <div className="rounded-md border bg-background-subtle p-4">
            <p className="text-[15px] leading-6 text-muted-foreground">No page matches &ldquo;{query.trim()}&rdquo;.</p>
            <Button variant="outline" size="sm" className="mt-2" onClick={() => setQuery("")}>
              Clear filter
            </Button>
          </div>
        ) : (
          <div className="space-y-[45px]">
            {groups.map((g) => {
              const labelId = `${listId}-${g.group.replace(/\s+/g, "-")}`;
              return (
                <section key={g.group} aria-labelledby={labelId}>
                  <h3 id={labelId} className="text-[19px] leading-[30px] font-semibold text-foreground">
                    {g.group}
                  </h3>
                  {GROUP_NOTES[g.group] ? (
                    <p className="text-[15px] leading-[30px] text-muted-foreground">{GROUP_NOTES[g.group]}</p>
                  ) : null}
                  <ul className="mt-[15px] divide-y overflow-hidden rounded-md border bg-background">
                    {g.sections.map((s) => (
                      <li key={s.id} className="group relative">
                        <Link
                          href={docsHref(s.id)}
                          className="grid gap-x-6 px-4 py-3 -outline-offset-2 transition-colors duration-(--dur-fast) hover:bg-[var(--ds-gray-alpha-100)] max-sm:px-3 sm:grid-cols-[13rem_minmax(0,1fr)]"
                        >
                          <span className="text-[16px] leading-6 font-semibold text-foreground">{s.title}</span>
                          <span className="text-[15px] leading-6 text-muted-foreground max-sm:mt-0.5">{SUMMARIES[s.id]}</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </section>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
