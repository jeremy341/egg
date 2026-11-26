"use client";

import { useLayoutEffect, useRef } from "react";

const CELL = 30;
/** Clear space between the hero and the frame, so the frame never shows on the first screen. */
const BELOW_HERO = 60;
/** Boxes whose edges are rounded up to whole cells: rows, list items, the bands between sections. */
const SNAP = ".vg-row, .vg-stack > *, .vg-faq details, .vg-gap";

/**
 * The page-wide frame of the homepage, below the hero. Text keeps normal leading, so rows have
 * natural heights. To keep the frame's rules on the layout's 30px grid, this component does two
 * things after layout:
 *   1. it keeps the frame 60px below the hero (which fills the first screen) and pushes it down to
 *      the next grid line (at most 29px more);
 *   2. it rounds each row, list item and band up to a whole number of 30px cells (the extra goes
 *      to the bottom padding of the box, so text never moves).
 * Both run again when the window resizes, when the pixel font arrives and when a question opens
 * or closes.
 *
 * Without scripts the frame still renders in full. Its rules then sit a few pixels off the grid
 * lines, and nothing else changes.
 */
export function GridFrame({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    const grid = document.querySelector<HTMLElement>(".page-grid");
    if (!el || !grid) return;

    // Reduced motion gives every element a 0.01ms transition; a changed margin or min-height would
    // then still read as its old value for a frame. These boxes never animate, so switch it off.
    el.style.transition = "none";
    const snap = () => {
      el.style.marginTop = `${BELOW_HERO}px`;
      const top = el.getBoundingClientRect().top - grid.getBoundingClientRect().top;
      const rest = ((top % CELL) + CELL) % CELL;
      const extra = rest < 0.05 || CELL - rest < 0.05 ? 0 : CELL - rest;
      el.style.marginTop = `${BELOW_HERO + extra}px`;

      // Inner boxes first (later in document order), so a row sees the final height of its items.
      const boxes = Array.from(el.querySelectorAll<HTMLElement>(SNAP)).reverse();
      for (const box of boxes) {
        box.style.transition = "none";
        box.style.minHeight = "";
      }
      for (const box of boxes) {
        const cells = Math.max(1, Math.ceil(box.getBoundingClientRect().height / CELL - 0.02));
        box.style.minHeight = `${cells * CELL}px`;
      }
    };
    snap();

    // The hero changes height with the window width and when the pixel font arrives.
    const observer = new ResizeObserver(snap);
    if (el.previousElementSibling) observer.observe(el.previousElementSibling);
    window.addEventListener("resize", snap);
    // "toggle" does not bubble, so it is heard in the capture phase.
    el.addEventListener("toggle", snap, true);
    void document.fonts?.ready.then(snap);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", snap);
      el.removeEventListener("toggle", snap, true);
    };
  }, []);

  return (
    <div ref={ref} className="vg">
      {children}
    </div>
  );
}
