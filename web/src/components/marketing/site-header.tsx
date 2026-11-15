"use client";

import { useEffect, useRef, useState } from "react";

/**
 * The sticky header of the public pages.
 *
 * It never moves and never changes size. At the top of the page it is clear,
 * so the grid runs behind it. Once the page has scrolled 8px it fills with the
 * page colour and gains a hairline, in 200ms. The state is binary and comes
 * from an IntersectionObserver on an 8px marker at the top of the page, so
 * there is no scroll listener and nothing is scrubbed half way. The first
 * answer only reports where the page already is (a reload halfway down), so it
 * is applied without a transition. With reduced motion the change is instant.
 *
 * It also makes same-page anchor links (the header, footer and hero links)
 * scroll smoothly, unless motion is reduced or the link was activated from the
 * keyboard. The browser still does the navigation, so the address, :target and
 * the focus starting point behave as with any anchor.
 */
export function SiteHeader({ children }: { children: React.ReactNode }) {
  const marker = useRef<HTMLSpanElement>(null);
  const [scrolled, setScrolled] = useState(false);
  const [settled, setSettled] = useState(false);

  useEffect(() => {
    const el = marker.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    let frame = 0;
    const io = new IntersectionObserver(([entry]) => {
      setScrolled(!entry.isIntersecting);
      if (!frame) frame = requestAnimationFrame(() => setSettled(true));
    });
    io.observe(el);
    return () => {
      io.disconnect();
      cancelAnimationFrame(frame);
    };
  }, []);

  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    const root = document.documentElement;
    let timer = 0;
    const reset = () => {
      root.style.removeProperty("scroll-behavior");
      window.clearTimeout(timer);
      window.removeEventListener("scrollend", reset);
    };

    const onClick = (e: MouseEvent) => {
      // detail is 0 for a click made with Enter: keyboard moves stay instant.
      if (e.defaultPrevented || e.button !== 0 || e.detail === 0 || reduce.matches) return;
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = e.target instanceof Element ? e.target.closest("a[href*='#']") : null;
      if (!(a instanceof HTMLAnchorElement) || a.target) return;
      const url = new URL(a.href);
      if (url.origin !== location.origin || url.pathname !== location.pathname || url.hash.length < 2) return;
      if (!document.getElementById(decodeURIComponent(url.hash.slice(1)))) return;

      reset();
      root.style.scrollBehavior = "smooth";
      window.addEventListener("scrollend", reset);
      // Already at the target, or no scrollend event: put it back anyway.
      timer = window.setTimeout(reset, 1500);
    };

    document.addEventListener("click", onClick);
    return () => {
      document.removeEventListener("click", onClick);
      reset();
    };
  }, []);

  return (
    <>
      <span ref={marker} aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 h-2" />
      <header
        data-scrolled={scrolled ? "" : undefined}
        data-settled={settled ? "" : undefined}
        className="sticky top-0 z-(--z-header) shadow-[0_1px_0_transparent] data-scrolled:bg-background-subtle data-scrolled:shadow-[0_1px_0_var(--border)] data-settled:transition-[background-color,box-shadow] data-settled:duration-(--dur-base) data-settled:ease-snappy has-[#site-menu:not([hidden])]:bg-background-subtle has-[#site-menu:not([hidden])]:shadow-[0_1px_0_var(--border)]"
      >
        {children}
      </header>
    </>
  );
}
