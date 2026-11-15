"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTheme } from "next-themes";
import { ListIcon, MoonIcon, SunIcon, XIcon } from "@phosphor-icons/react";
import { isCurrent, type NavItem } from "@/components/marketing/marketing-nav";

const row =
  "flex min-h-[45px] w-full items-center gap-2 px-4 text-left text-[15px] text-foreground transition-colors duration-(--dur-fast) hover:bg-[var(--ds-gray-alpha-100)] aria-[current=page]:font-medium sm:px-[30px]";

/**
 * The header menu below 768px: a 40px "Menu" button and a panel under the bar
 * with every link and the theme switch. Esc, a click on a link, or a click
 * outside close it. Esc and a link click return focus to the button, and
 * tabbing out of the panel closes it. The panel is always in the DOM and
 * toggled with `hidden`, so it adds no layout shift. "Sign in" lives in the
 * bar and moves in here under 360px.
 */
export function MobileMenu({ items }: { items: NavItem[] }) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLElement>(null);
  const pathname = usePathname();
  const { resolvedTheme, setTheme } = useTheme();

  useEffect(() => {
    if (!open) return;

    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      button.current?.focus();
    };
    const outside = (e: Event) => {
      const t = e.target as Node;
      if (panel.current?.contains(t) || button.current?.contains(t)) return;
      setOpen(false);
    };
    // The panel is for narrow screens; close it if the window grows past md.
    const wide = window.matchMedia("(min-width: 768px)");
    const onWide = () => {
      if (wide.matches) setOpen(false);
    };

    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", outside);
    document.addEventListener("focusin", outside);
    wide.addEventListener("change", onWide);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("focusin", outside);
      wide.removeEventListener("change", onWide);
    };
  }, [open]);

  /* After a link click the browser moves focus to the link target; put it back on the button once it has. */
  const closeAndReturn = () => {
    setOpen(false);
    requestAnimationFrame(() => button.current?.focus({ preventScroll: true }));
  };

  return (
    <>
      <button
        ref={button}
        type="button"
        aria-expanded={open}
        aria-controls="site-menu"
        onClick={() => setOpen((o) => !o)}
        className="pressable inline-flex h-10 items-center justify-center gap-2 border px-3 text-[14px] font-medium text-foreground hover:bg-[var(--ds-gray-100)] md:hidden"
      >
        {open ? <XIcon aria-hidden="true" className="size-[18px]" /> : <ListIcon aria-hidden="true" className="size-[18px]" />}
        Menu
      </button>

      <nav
        ref={panel}
        id="site-menu"
        aria-label="Site menu"
        hidden={!open}
        onClick={(e) => {
          if ((e.target as HTMLElement).closest("a")) closeAndReturn();
        }}
        className="absolute inset-x-0 top-[calc(100%+8px)] border bg-background py-2 md:hidden"
      >
        {items.map((n) =>
          n.href.includes("#") ? (
            <a key={n.href} href={n.href} className={row}>
              {n.label}
            </a>
          ) : (
            <Link
              key={n.href}
              href={n.href}
              aria-current={isCurrent(pathname, n.href) ? "page" : undefined}
              className={row}
            >
              {n.label}
            </Link>
          )
        )}
        <div className="mt-2 border-t pt-2">
          <Link href="/login" className={`${row} min-[360px]:hidden`}>
            Sign in
          </Link>
          <button
            type="button"
            onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
            className={row}
          >
            <SunIcon aria-hidden="true" className="hidden size-[18px] dark:block" />
            <MoonIcon aria-hidden="true" className="size-[18px] dark:hidden" />
            Switch between light and dark
          </button>
        </div>
      </nav>
    </>
  );
}
