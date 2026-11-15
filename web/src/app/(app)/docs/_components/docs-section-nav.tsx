"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { CaretDownIcon } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { sectionTitle } from "../_data/nav";
import { useCurrentDocsPage } from "./docs-nav";
import { DocsPageList } from "./docs-sidebar";
import { scanPageHeadings, type PageHeading } from "./use-page-headings";

/**
 * The docs section bar, for screens under 1280px (wider ones have the sidebar). It sticks under the app's top bar and always names the
 * current page; pressing it opens a panel with the list of pages, filterable,
 * grouped in columns on wide screens. On phones the panel also lists the
 * headings of this page ("On this page"), which wide screens show in a rail.
 * It is a button, so Tab, Enter, Space and Escape all work.
 */
export function DocsSectionNav() {
  const current = useCurrentDocsPage();
  const [open, setOpen] = useState(false);
  // Only a pointer opens with a motion; the keyboard gets it instantly.
  const [animate, setAnimate] = useState(false);
  const [headings, setHeadings] = useState<PageHeading[]>([]);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  const close = useCallback(() => setOpen(false), []);

  // Read the page's headings when the panel opens, so the list is never stale.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reads the DOM when the panel opens
    setHeadings(open ? scanPageHeadings() : []);
  }, [open, current]);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      setOpen(false);
      buttonRef.current?.focus();
    }
    function onPointerDown(e: PointerEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="sticky top-[var(--topbar-height)] z-20 -mx-4 -mt-6 mb-4 border-b bg-background-subtle lg:-mx-6 min-[1280px]:hidden">
      <button
        ref={buttonRef}
        type="button"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={(e) => {
          setAnimate(e.detail > 0);
          setOpen((v) => !v);
        }}
        className="mx-auto flex h-12 w-full max-w-[var(--page-width)] items-center gap-3 px-4 text-left -outline-offset-2 hover:bg-[var(--ds-gray-alpha-100)] lg:px-6"
      >
        <span className="shrink-0 text-[13px] text-muted-foreground">Docs</span>
        <span className="min-w-0 flex-1 truncate text-[15px] font-medium">{current ? sectionTitle(current) : "All pages"}</span>
        <CaretDownIcon
          aria-hidden="true"
          className={cn(
            "size-4 shrink-0 text-muted-foreground transition-transform duration-(--dur-base) ease-snappy",
            open && "rotate-180"
          )}
        />
      </button>

      {open ? (
        <div
          id={panelId}
          className={cn(
            "absolute inset-x-0 top-full max-h-[70dvh] overflow-y-auto overscroll-contain border-b bg-background shadow-menu",
            animate &&
              "transition-[opacity,translate] duration-[180ms] ease-snappy starting:-translate-y-1 starting:opacity-0"
          )}
        >
          <div className="mx-auto max-w-[var(--page-width)] px-4 py-4 lg:px-6">
            {headings.length > 1 ? (
              <nav aria-label="On this page" className="mb-4 border-b pb-4">
                <p className="px-2 text-[13px] leading-6 font-semibold text-foreground">On this page</p>
                <ul className="mt-1">
                  {headings.map((h) => (
                    <li key={h.id}>
                      <a
                        href={`#${h.id}`}
                        onClick={close}
                        className={cn(
                          "flex min-h-10 items-center rounded-md text-[14px] leading-5 text-muted-foreground hover:bg-[var(--ds-gray-alpha-100)] hover:text-foreground",
                          h.level === 2 ? "px-2" : "pr-2 pl-6"
                        )}
                      >
                        {h.title}
                      </a>
                    </li>
                  ))}
                </ul>
              </nav>
            ) : null}
            <nav aria-label="Docs pages">
              <DocsPageList onNavigate={close} />
            </nav>
          </div>
        </div>
      ) : null}
    </div>
  );
}
