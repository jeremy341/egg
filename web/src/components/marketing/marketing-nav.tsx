"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export type NavItem = { href: string; label: string };

/** True when `href` is the page the visitor is on (only the stats page is a separate page). */
export function isCurrent(pathname: string, href: string): boolean {
  return !href.includes("#") && (pathname === href || pathname.startsWith(`${href}/`));
}

const linkClass =
  "relative py-2 text-[14px] font-medium text-foreground after:absolute after:inset-x-0 after:bottom-0.5 after:h-0.5 after:origin-left after:scale-x-0 after:bg-foreground after:transition-transform after:duration-(--dur-fast) hover:after:scale-x-100 focus-visible:after:scale-x-100 aria-[current=page]:after:scale-x-100 motion-reduce:after:transition-none";

/**
 * The header links from 768px up. A client component only so the Stats link
 * can mark itself as the current page.
 */
export function MarketingNav({ items }: { items: NavItem[] }) {
  const pathname = usePathname();

  return (
    <nav aria-label="Main" className="hidden items-center gap-4 md:flex lg:gap-6">
      {items.map((n) => {
        const current = isCurrent(pathname, n.href);
        return n.href.includes("#") ? (
          <a key={n.href} href={n.href} className={linkClass}>
            {n.label}
          </a>
        ) : (
          <Link
            key={n.href}
            href={n.href}
            aria-current={current ? "page" : undefined}
            className={linkClass}
          >
            {n.label}
          </Link>
        );
      })}
    </nav>
  );
}
