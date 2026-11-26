"use client";

import { usePathname } from "next/navigation";
import { DOCS_NAV, sectionIdFromPath, type DocsGroup } from "../_data/nav";

/** The page the reader is on, or null on the docs home. */
export function useCurrentDocsPage(): string | null {
  return sectionIdFromPath(usePathname());
}

export function filterNav(query: string): { groups: DocsGroup[]; count: number } {
  const q = query.trim().toLowerCase();
  if (q === "") return { groups: DOCS_NAV, count: DOCS_NAV.reduce((n, g) => n + g.sections.length, 0) };
  const groups: DocsGroup[] = [];
  let count = 0;
  for (const g of DOCS_NAV) {
    const groupMatch = g.group.toLowerCase().includes(q);
    const sections = g.sections.filter(
      (s) =>
        groupMatch ||
        s.title.toLowerCase().includes(q) ||
        s.subsections.some((sub) => sub.title.toLowerCase().includes(q))
    );
    if (sections.length > 0) {
      groups.push({ group: g.group, sections });
      count += sections.length;
    }
  }
  return { groups, count };
}
