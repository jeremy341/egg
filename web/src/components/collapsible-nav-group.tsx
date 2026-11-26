"use client";

import { useId, useState, type ReactNode } from "react";
import { CaretDownIcon } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";

/**
 * A labelled group in a navigation list that folds away. The header is a
 * button (aria-expanded and aria-controls name the panel); pressing it toggles
 * the panel. Groups start open.
 *
 * `locked` keeps the panel open and the header inert: the group holds the page
 * the reader is on, or a search is filtering the list, so nothing it shows can
 * be hidden away from them.
 */
export function CollapsibleNavGroup({
  label,
  count,
  locked = false,
  children,
  className,
}: {
  label: string;
  /** Shown on the right of the header, e.g. how many pages are in the group. */
  count?: number;
  locked?: boolean;
  children: ReactNode;
  className?: string;
}) {
  const [folded, setFolded] = useState(false);
  const baseId = useId();
  const labelId = `${baseId}-label`;
  const panelId = `${baseId}-panel`;
  const open = locked || !folded;

  return (
    <div className={cn("mt-4", className)}>
      <button
        type="button"
        id={labelId}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => {
          if (!locked) setFolded((f) => !f);
        }}
        className={cn(
          "flex min-h-8 w-full items-center gap-2 rounded-md px-3 text-left text-[12px] leading-4 font-semibold tracking-[0.08em] text-subtle-foreground uppercase transition-colors duration-(--dur-fast) hover:text-foreground focus-visible:outline-offset-[-2px]",
          locked && "cursor-default"
        )}
      >
        <span className="min-w-0 flex-1">{label}</span>
        {count === undefined ? null : (
          <span className="text-[11px] font-medium tracking-normal tabular-nums" aria-label={`${count} ${count === 1 ? "item" : "items"}`}>
            {count}
          </span>
        )}
        <CaretDownIcon
          aria-hidden="true"
          weight="bold"
          className={cn("size-3 shrink-0 transition-transform duration-(--dur-fast)", !open && "-rotate-90")}
        />
      </button>
      <div id={panelId} role="group" aria-labelledby={labelId} hidden={!open} className={cn("mt-0.5", open ? "block" : "hidden")}>
        {children}
      </div>
    </div>
  );
}
