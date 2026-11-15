"use client";

import { useId, useMemo, useState } from "react";
import Link from "next/link";
import { MagnifyingGlassIcon } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { docsHref } from "../_data/nav";
import { filterIndex } from "../_data/index-filter";
import { SUMMARIES } from "../_data/summaries";

/**
 * Every docs page, grouped like the sidebar, each with its one-line summary and
 * links to its subsections. It is built from `DOCS_NAV` and `SUMMARIES`, so it
 * cannot drift from the sidebar. The filter narrows by title, summary or
 * subsection. Everything sits straight on the page grid.
 */
export function DocsIndex() {
  const [query, setQuery] = useState("");
  const listId = useId();
  const { groups, count } = useMemo(() => filterIndex(query), [query]);
  const filtering = query.trim() !== "";

  return (
    <section aria-labelledby="docs-all-pages" className="mt-[90px] max-sm:mt-[60px]">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-[15px]">
        <h2 id="docs-all-pages" className="text-foreground text-[22px] leading-[30px] font-semibold tracking-[-0.02em] max-sm:text-[20px]">
          All pages
        </h2>
        <p aria-live="polite" className="text-[14px] leading-5 text-subtle-foreground sm:order-last sm:ml-auto">
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
            placeholder="Filter all pages…"
            aria-label="Filter all docs pages"
            aria-controls={listId}
            autoComplete="off"
            spellCheck={false}
            className="rounded-none bg-background pl-8"
          />
        </div>
      </div>

      <div id={listId} className="mt-[30px]">
        {groups.length === 0 ? (
          <div className="border-t border-t-foreground/20 pt-[15px]">
            <p className="text-[15px] leading-6 text-muted-foreground">No page matches &ldquo;{query.trim()}&rdquo;.</p>
            <Button variant="ghost" size="sm" className="mt-2 rounded-none" onClick={() => setQuery("")}>
              Clear filter
            </Button>
          </div>
        ) : (
          <div className="space-y-[60px] max-sm:space-y-[45px]">
            {groups.map((g) => {
              const labelId = `${listId}-${g.group.replace(/\s+/g, "-")}`;
              return (
                <section
                  key={g.group}
                  aria-labelledby={labelId}
                  className="grid gap-[15px] border-t border-t-foreground/20 pt-[15px] lg:grid-cols-[150px_minmax(0,1fr)] lg:gap-x-[30px]"
                >
                  <h3 id={labelId} className="text-[19px] leading-[30px] font-semibold text-foreground">
                    {g.group}
                  </h3>
                  <ul className="grid gap-x-[30px] gap-y-[30px] min-[900px]:grid-cols-2">
                    {g.sections.map((s) => (
                      <li key={s.id} className="min-w-0">
                        <Link
                          href={docsHref(s.id)}
                          className="group relative inline-flex min-h-[30px] items-center text-[16px] leading-6 font-semibold text-foreground underline-offset-4 hover:underline max-sm:min-h-10"
                        >
                          <span
                            aria-hidden="true"
                            className="absolute top-1/2 -left-[15px] size-[7px] -translate-y-1/2 bg-[var(--pixel-lit)] opacity-0 [transition:opacity_var(--dur-fast)_steps(1,end)] group-hover:opacity-100 group-focus-visible:opacity-100 max-sm:hidden"
                          />
                          {s.title}
                        </Link>
                        <p className="max-w-[56ch] text-[15px] leading-6 text-muted-foreground">{SUMMARIES[s.id]}</p>
                        {s.subsections.length > 0 ? (
                          <ul aria-label={`Sections in ${s.title}`} className="mt-1.5 flex flex-wrap gap-x-4 gap-y-0.5">
                            {s.subsections.map((sub) => (
                              <li key={sub.id}>
                                <Link
                                  href={`${docsHref(s.id)}#${sub.id}`}
                                  className="inline-flex min-h-7 items-center text-[13px] leading-5 text-foreground/80 underline decoration-[var(--ds-gray-alpha-400)] underline-offset-4 transition-colors duration-(--dur-fast) hover:text-foreground hover:decoration-current max-sm:min-h-10"
                                >
                                  {sub.title}
                                </Link>
                              </li>
                            ))}
                          </ul>
                        ) : null}
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
