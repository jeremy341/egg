"use client";

import { CaretRightIcon } from "@phosphor-icons/react";
import { useScrollSpy } from "@/components/motion/use-scroll-spy";
import { cn } from "@/lib/utils";

/*
 * The "On this page" list of the Security and Privacy pages, on a thin rail
 * like the one in the docs. It marks the section that is in view. Sections may
 * be gathered under a few group names so a long page can be taken in at once.
 *
 * From 1024px it is a sticky column beside the sheet. Below that it is a closed
 * disclosure above the sheet, so a phone shows the page first and not a long
 * list of links. Nothing animates beyond the colour change on the links.
 */

export type TocSection = { id: string; title: string; group?: string };

/** The sections in page order, cut into runs that share a group name. */
function grouped(sections: readonly TocSection[]): { group: string | undefined; items: TocSection[] }[] {
  const runs: { group: string | undefined; items: TocSection[] }[] = [];
  for (const s of sections) {
    const last = runs[runs.length - 1];
    if (last && last.group === s.group) last.items.push(s);
    else runs.push({ group: s.group, items: [s] });
  }
  return runs;
}

function Links({ sections, active }: { sections: readonly TocSection[]; active: string | null }) {
  return (
    <div className="flex flex-col gap-4">
      {grouped(sections).map((run, i) => (
        <div key={run.group ?? `run-${i}`}>
          {run.group ? <p className="m-0 mb-1.5 text-[0.8125rem] leading-5 text-muted-foreground">{run.group}</p> : null}
          <ul className="m-0 list-none border-l border-l-foreground/12 p-0">
            {run.items.map((s) => {
              const current = s.id === active;
              return (
                <li key={s.id}>
                  {/* A 2px bar over the rail's own line marks the section in view. */}
                  <a
                    href={`#${s.id}`}
                    aria-current={current ? "location" : undefined}
                    className={cn(
                      "-ml-px flex min-h-8 items-center border-l-2 py-1 pr-1 pl-[14px] text-[0.875rem] leading-5 outline-offset-2 transition-colors duration-(--dur-fast) focus-visible:outline-2 focus-visible:outline-[var(--ds-focus-color)] max-lg:min-h-10",
                      current
                        ? "border-l-foreground font-medium text-foreground"
                        : "border-l-transparent text-muted-foreground hover:text-foreground"
                    )}
                  >
                    {s.title}
                  </a>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}

export function Toc({ sections }: { sections: readonly TocSection[] }) {
  const active = useScrollSpy(
    sections.map((s) => s.id),
    { offset: 96 }
  );

  return (
    <>
      <nav
        aria-label="On this page"
        className="sticky top-[90px] max-h-[calc(100dvh-120px)] overflow-y-auto pr-2 [scrollbar-width:thin] max-lg:hidden"
      >
        <p className="m-0 mb-4 text-[0.875rem] leading-6 font-medium text-foreground">On this page</p>
        <Links sections={sections} active={active} />
      </nav>

      <details className="disclosure border bg-background lg:hidden">
        <summary className="touch-target flex min-h-11 w-full items-center gap-2 px-4 text-[0.9375rem] leading-6 font-medium text-foreground">
          <CaretRightIcon aria-hidden="true" className="disclosure-caret size-4 shrink-0" />
          On this page
          <span className="ml-auto text-[0.8125rem] font-normal text-muted-foreground">{sections.length} sections</span>
        </summary>
        <nav aria-label="On this page" className="border-t px-4 py-4">
          <Links sections={sections} active={active} />
        </nav>
      </details>
    </>
  );
}
