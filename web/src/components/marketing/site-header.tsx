"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { MarketingNav } from "@/components/marketing/marketing-nav";
import { MobileMenu } from "@/components/marketing/mobile-menu";
import { NestMark } from "@/components/nest-mark";
import { ThemeButton } from "@/components/theme-button";
import { MARKETING_NAV } from "@/lib/marketing-nav";

/**
 * The top bar: 60px, sticky, on the white surface. A hairline appears under it
 * once the top of the page has scrolled out of view (watched by an
 * IntersectionObserver on a 1px marker, not a scroll listener). The wordmark
 * and links sit left; the theme button and the one filled Sign in button sit
 * right. Below 768px the links move into the Menu button.
 */
export function SiteHeader() {
  const [scrolled, setScrolled] = useState(false);
  const marker = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = marker.current;
    if (!el) return;
    const io = new IntersectionObserver(([entry]) => setScrolled(!entry.isIntersecting));
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <>
      <div ref={marker} aria-hidden="true" className="pointer-events-none absolute top-0 left-0 h-px w-px" />
      <header
        data-scrolled={scrolled || undefined}
        className="sticky top-0 z-(--z-header) border-b border-transparent bg-background transition-[border-color] duration-(--dur-fast) data-[scrolled]:border-border"
      >
        <div className="board-col">
          <div className="relative flex h-[60px] items-center gap-3 md:gap-8 lg:gap-10">
            <Link href="/" aria-label="Egg, home" className="flex shrink-0 items-center gap-2 outline-offset-4">
              <NestMark className="size-6" />
              <span className="font-pixel text-[1.375rem] leading-none font-semibold whitespace-nowrap">Egg</span>
            </Link>

            <MarketingNav items={MARKETING_NAV} />

            <div className="ml-auto flex items-center gap-2">
              <ThemeButton className="size-10! max-md:hidden" />
              <Link
                href="/login"
                className="pressable inline-flex h-10 items-center bg-foreground px-4 text-[0.875rem] font-medium whitespace-nowrap text-background outline-offset-2 transition-[background-color] duration-(--dur-fast) hover:bg-[color-mix(in_oklab,var(--foreground)_84%,var(--background))] focus-visible:outline-2 focus-visible:outline-[var(--ds-focus-color)] max-[359px]:hidden"
              >
                Sign in
              </Link>
              <MobileMenu items={MARKETING_NAV} />
            </div>
          </div>
        </div>
      </header>
    </>
  );
}
