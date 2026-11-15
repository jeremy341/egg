/** The marketing pages' links, shared by the header, the mobile menu and the footer. */
export type MarketingLink = { href: string; label: string };

export const MARKETING_NAV: MarketingLink[] = [
  { href: "/#product", label: "How it works" },
  { href: "/#runtimes", label: "Runtimes" },
  { href: "/security", label: "Security" },
  { href: "/#faq", label: "Questions" },
  { href: "/stats", label: "Stats" },
];

/** The footer lists the same links, with Setup after the homepage sections and before the separate pages. */
export function footerLinks(items: MarketingLink[] = MARKETING_NAV): MarketingLink[] {
  const onPage = items.filter((l) => l.href.startsWith("/#"));
  const pages = items.filter((l) => !l.href.startsWith("/#"));
  return [...onPage, { href: "/#start", label: "Setup" }, ...pages];
}
