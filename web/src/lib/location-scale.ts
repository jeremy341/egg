import { countValue, type Count } from "@/lib/stats-format";

/**
 * How the visitor map is shaded. Class 0 is a country with no recorded visits, class 1 is
 * "fewer than 10" (never drawn to scale), and classes 2 to 4 split the rounded counts at or
 * above 10 into three steps of the largest one. Pure, so the shapes, the legend and the tests
 * read the same rule.
 */
export type LocationScale = {
  /** Class of one country: 0 none, 1 fewer than 10, 2 to 4 by size. */
  classOf: (count: Count | undefined) => number;
  /** Legend entries in order, for the classes that can occur. */
  legend: { cls: number; label: string }[];
};

const n = new Intl.NumberFormat("en");

export function locationScale(counts: Count[]): LocationScale {
  const max = counts.reduce((m, c) => Math.max(m, countValue(c)), 0);
  const span = Math.max(0, max - 10);
  const edges = [10 + Math.ceil(span / 3), 10 + Math.ceil((2 * span) / 3)];
  const classOf = (c: Count | undefined): number => {
    if (!c) return 0;
    if ("lessThan" in c) return 1;
    return c.approx <= edges[0] ? 2 : c.approx <= edges[1] ? 3 : 4;
  };
  const used = new Set(counts.map(classOf));
  const legend = [{ cls: 0, label: "No visits recorded" }];
  if (used.has(1)) legend.push({ cls: 1, label: "Fewer than 10" });
  if (used.has(2)) legend.push({ cls: 2, label: `10 to ${n.format(edges[0])}` });
  if (used.has(3)) legend.push({ cls: 3, label: `${n.format(edges[0] + 1)} to ${n.format(edges[1])}` });
  if (used.has(4)) legend.push({ cls: 4, label: `${n.format(edges[1] + 1)} to ${n.format(max)}` });
  return { classOf, legend };
}

/**
 * The fill for a class, from the Bklit sequential scale variables (set in `bklit-theme.ts`), so it
 * follows every theme. No visits is a faded neutral, not the faintest shade, so "none" and
 * "fewer than 10" stay apart.
 */
export function classFill(cls: number): string {
  if (cls <= 0) return "var(--muted)";
  return `var(--chart-scale-0${Math.min(cls, 4) + 1})`;
}
