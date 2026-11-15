"use client";

import { useEffect, useState } from "react";

/*
 * The "On this page" list. It marks the section that is in view. An
 * IntersectionObserver wakes the check when a section crosses the reading line;
 * the check itself reads the section positions, so it works the same for short
 * and long sections. Nothing animates, so there is nothing to switch off for
 * reduced motion beyond the colour change on the links.
 */

/** Distance from the top of the window where a section counts as "current" (matches scroll-mt-24 plus a little). */
const READING_LINE = 120;

export function Toc({ sections }: { sections: readonly { id: string; title: string }[] }) {
  const [active, setActive] = useState<string>(sections[0]?.id ?? "");

  useEffect(() => {
    const els = sections.map((s) => document.getElementById(s.id)).filter((el): el is HTMLElement => el !== null);
    if (els.length === 0) return;

    const update = () => {
      const atBottom = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4;
      if (atBottom) {
        setActive(els[els.length - 1].id);
        return;
      }
      let current = els[0].id;
      for (const el of els) {
        if (el.getBoundingClientRect().top <= READING_LINE) current = el.id;
        else break;
      }
      setActive(current);
    };

    const observer = new IntersectionObserver(update, {
      rootMargin: `-${READING_LINE}px 0px 0px 0px`,
      threshold: [0, 1],
    });
    for (const el of els) observer.observe(el);
    window.addEventListener("hashchange", update);
    window.addEventListener("scroll", update, { passive: true });
    update();
    return () => {
      observer.disconnect();
      window.removeEventListener("hashchange", update);
      window.removeEventListener("scroll", update);
    };
  }, [sections]);

  return (
    <nav aria-label="On this page" className="border border-border bg-background p-5 lg:sticky lg:top-24">
      <p className="m-0 border-b-2 border-foreground pb-3 text-[0.875rem] leading-6 font-semibold text-foreground">
        On this page
      </p>
      <ul className="m-0 mt-2 grid list-none grid-cols-1 gap-x-6 p-0 sm:grid-cols-2 lg:grid-cols-1">
        {sections.map((s, i) => {
          const current = s.id === active;
          return (
            <li key={s.id}>
              <a
                href={`#${s.id}`}
                aria-current={current ? "location" : undefined}
                className={`touch-target flex items-baseline gap-3 py-1.5 text-[0.9375rem] leading-6 underline decoration-transparent underline-offset-4 outline-offset-2 transition-[color,text-decoration-color] duration-(--dur-fast) focus-visible:outline-2 focus-visible:outline-[var(--ds-focus-color)] motion-reduce:transition-none ${
                  current
                    ? "font-semibold text-foreground"
                    : "text-muted-foreground hover:text-foreground hover:decoration-current"
                }`}
              >
                <span
                  aria-hidden="true"
                  className={`inline-block w-7 shrink-0 border px-1 text-center font-mono text-[0.75rem] leading-5 tabular-nums ${
                    current ? "border-foreground bg-foreground text-background" : "border-border"
                  }`}
                >
                  {String(i + 1).padStart(2, "0")}
                </span>
                <span>{s.title}</span>
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
