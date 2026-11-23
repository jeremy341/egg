"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import {
  ArrowUpRightIcon,
  BookOpenIcon,
  ListIcon,
  MagnifyingGlassIcon,
  XIcon,
} from "@phosphor-icons/react";
import { useFind } from "@/components/find-palette";
import {
  DocsLink,
  NavList,
  NavListSkeleton,
  navItemClass,
  navItemIdle,
} from "@/components/nav-list";
import { ServerSwitcher } from "@/components/server-switcher";
import { IconTip } from "@/components/ui/tooltip";
import { UserMenu } from "@/components/user-menu";
import { cn } from "@/lib/utils";

const TABBABLE_SELECTOR = [
  "a[href]", "area[href]", "button", "input", "select", "textarea", "summary",
  "iframe", "audio[controls]", "video[controls]", "[contenteditable]", "[tabindex]",
].join(", ");

/**
 * Phone navigation: a floating Find / menu pill at the bottom, and a
 * full-screen menu. The sidebar is hidden below the lg breakpoint.
 */
export function MobileDock() {
  const [menuOpen, setMenuOpen] = useState(false);
  const { open: openFind } = useFind();
  const toggleRef = useRef<HTMLButtonElement>(null);

  const close = useCallback((returnFocus: boolean) => {
    setMenuOpen(false);
    if (returnFocus) toggleRef.current?.focus();
  }, []);

  return (
    <div className="lg:hidden">
      <div className="pointer-events-none fixed inset-x-0 bottom-[calc(16px+env(safe-area-inset-bottom))] z-(--z-dock) flex justify-center">
        <div className="shadow-menu pointer-events-auto flex h-11 items-center rounded-xl bg-background">
          <button
            type="button"
            onClick={() => openFind()}
            className="touch-target pressable flex h-full items-center gap-2 rounded-l-xl pr-4 pl-4 font-medium text-muted-foreground focus-visible:outline-offset-[-2px]"
          >
            <MagnifyingGlassIcon aria-hidden="true" className="size-4" />
            Find
          </button>
          <span aria-hidden="true" className="h-5 w-px bg-border" />
          <IconTip label={menuOpen ? "Close menu" : "Open menu"}>
            <button
              ref={toggleRef}
              type="button"
              onClick={() => (menuOpen ? close(true) : setMenuOpen(true))}
              aria-expanded={menuOpen}
              aria-controls={menuOpen ? "mobile-menu" : undefined}
              aria-haspopup="dialog"
              aria-label={menuOpen ? "Close menu" : "Open menu"}
              className="touch-target pressable flex h-full w-12 items-center justify-center rounded-r-xl focus-visible:outline-offset-[-2px]"
            >
              {menuOpen ? (
                <XIcon aria-hidden="true" className="size-5" />
              ) : (
                <ListIcon aria-hidden="true" className="size-5" />
              )}
            </button>
          </IconTip>
        </div>
      </div>

      {menuOpen ? <Menu onClose={close} /> : null}
    </div>
  );
}

function Menu({ onClose }: { onClose: (returnFocus: boolean) => void }) {
  const pathname = usePathname();
  const first = useRef(pathname);
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  // Navigating closes the menu; focus belongs to the new page then.
  useEffect(() => {
    if (first.current !== pathname) onClose(false);
  }, [pathname, onClose]);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;

    closeRef.current?.focus();
    const content = document.querySelector("[data-app-content]");
    const wasInert = content?.hasAttribute("inert");
    if (!wasInert) content?.setAttribute("inert", "");

    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing) return;
      if (e.key === "Escape") {
        e.preventDefault();
        onClose(true);
        return;
      }
      if (e.key !== "Tab") return;

      const tabbable = Array.from(dialog.querySelectorAll<HTMLElement>(TABBABLE_SELECTOR))
        .filter((element) => {
          const editable = element.isContentEditable && !element.hasAttribute("tabindex") &&
            !element.parentElement?.isContentEditable;
          return (element.tabIndex >= 0 || editable) &&
            !element.matches(":disabled") &&
            !element.closest("[inert]") &&
            element.getClientRects().length > 0 &&
            window.getComputedStyle(element).visibility === "visible";
        })
        .sort((left, right) => (left.tabIndex > 0 ? left.tabIndex : Infinity) -
          (right.tabIndex > 0 ? right.tabIndex : Infinity));
      const firstTab = tabbable[0];
      const lastTab = tabbable[tabbable.length - 1];
      const active = document.activeElement;
      if (!firstTab || !dialog.contains(active) || active === dialog) {
        e.preventDefault();
        (firstTab ?? dialog).focus();
      } else if (e.shiftKey ? active === firstTab : active === lastTab) {
        e.preventDefault();
        (e.shiftKey ? lastTab : firstTab).focus();
      }
    };
    window.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
      if (!wasInert) content?.removeAttribute("inert");
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      id="mobile-menu"
      role="dialog"
      aria-modal="true"
      aria-label="Menu"
      tabIndex={-1}
      className="fixed inset-0 z-50 flex animate-in flex-col overflow-y-auto bg-background-subtle px-3 pt-3 pb-[calc(88px+env(safe-area-inset-bottom))] duration-[220ms] ease-sheet fade-in-0 slide-in-from-bottom-2"
    >
      <div className="flex shrink-0 justify-end">
        <button
          ref={closeRef}
          type="button"
          aria-label="Close menu"
          onClick={() => onClose(true)}
          className="touch-target pressable flex h-11 items-center gap-2 rounded-lg px-3 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-offset-[-2px]"
        >
          Close
          <XIcon aria-hidden="true" className="size-5" />
        </button>
      </div>
      <ServerSwitcher className="mt-1 max-sm:h-11" />
      <div className="mt-4">
        <Suspense fallback={<NavListSkeleton />}>
          <NavList roomy onNavigate={() => onClose(false)} />
        </Suspense>
      </div>
      <div className="mt-auto flex flex-col gap-0.5 border-t pt-3">
        <DocsLink roomy onNavigate={() => onClose(false)} />
        <a
          href="https://guides.hackclub.app"
          target="_blank"
          rel="noreferrer"
          onClick={() => onClose(false)}
          className={cn(navItemClass, navItemIdle, "h-11")}
        >
          <BookOpenIcon aria-hidden="true" className="size-4 shrink-0" />
          Nest guides
          <ArrowUpRightIcon
            aria-hidden="true"
            className="size-3 shrink-0 text-subtle-foreground"
          />
          <span className="sr-only">(opens in a new tab)</span>
        </a>
        <UserMenu className="max-sm:h-11" />
      </div>
    </div>
  );
}
