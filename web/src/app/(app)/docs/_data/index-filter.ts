import { DOCS_NAV, type DocsGroup } from "./nav";
import { SUMMARIES } from "./summaries";

/**
 * The docs home filter. A page stays when the query is found in its title, its
 * one-line summary, any of its subsection titles or its group name. A blank
 * query keeps everything, in the nav's own order.
 */
export function filterIndex(query: string): { groups: DocsGroup[]; count: number } {
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
        (SUMMARIES[s.id] ?? "").toLowerCase().includes(q) ||
        s.subsections.some((sub) => sub.title.toLowerCase().includes(q))
    );
    if (sections.length > 0) {
      groups.push({ group: g.group, sections });
      count += sections.length;
    }
  }
  return { groups, count };
}
