import { formatDay, plural } from "@/components/charts/bklit-visits";
import { VITAL_THRESHOLDS, formatVital, type Vital } from "@/server/analytics-fields";
import type { VitalBand } from "@/server/analytics-speed";

/**
 * The words and the table rows that go with each Bklit chart. Pure: every sentence and every
 * cell is made from the numbers the chart is drawn from, never summed, sorted or filled in
 * again, so the text, the table and the picture cannot disagree.
 */

export type Unit = { one: string; many: string };

export const number = new Intl.NumberFormat("en");

export type Point = { label: string; value: number };

/** The first point with the most and the first with the least: a tie keeps the earlier one. */
export function describeExtremes(
  points: readonly Point[],
  unit: Unit,
  empty: string,
  say: (value: number) => string = (v) => plural(v, unit.one, unit.many)
): string {
  if (points.length === 0) return empty;
  let highest = points[0];
  let lowest = points[0];
  for (const p of points) {
    if (p.value > highest.value) highest = p;
    if (p.value < lowest.value) lowest = p;
  }
  const line = (p: Point) => `${p.label}, ${say(p.value)}`;
  if (points.length === 1) return `${line(highest)}.`;
  return `Highest: ${line(highest)}. Lowest: ${line(lowest)}.`;
}

/** The biggest category in words. A tie keeps the first, which is the one drawn first. */
export function describeLargest(points: readonly Point[], unit: Unit, empty: string): string {
  if (points.length === 0) return empty;
  let top = points[0];
  for (const p of points) if (p.value > top.value) top = p;
  return `Largest: ${top.label}, ${plural(top.value, unit.one, unit.many)}.`;
}

/** The labels of a list made unique: a repeat gets " (2)", " (3)" so two bars never share a category. */
export function uniqueLabels(labels: readonly string[]): string[] {
  const seen = new Map<string, number>();
  return labels.map((l) => {
    const n = (seen.get(l) ?? 0) + 1;
    seen.set(l, n);
    return n === 1 ? l : `${l} (${n})`;
  });
}

/** Day labels such as "4 Nov" for a list of UTC days. */
export function dayPoints(rows: readonly { day: string; value: number }[]): Point[] {
  return rows.map((r) => ({ label: formatDay(r.day), value: r.value }));
}

// ------------------------------------------------------------ speed

export const BAND_COLOURS = {
  good: "var(--success)",
  "needs-work": "var(--warning)",
  poor: "var(--destructive)",
} as const;

/** "Good, up to 2.50 s", "Needs work, up to 4.00 s", "Poor, over 4.00 s". */
export function bandRange(metric: Vital, rating: VitalBand["rating"]): string {
  const [good, poor] = VITAL_THRESHOLDS[metric];
  if (rating === "good") return `up to ${formatVital(metric, good)}`;
  if (rating === "needs-work") return `over ${formatVital(metric, good)}, up to ${formatVital(metric, poor)}`;
  return `over ${formatVital(metric, poor)}`;
}

/** Which band holds the most reports, in a sentence. Shares are included only when they are shown. */
export function describeBands(bands: readonly VitalBand[]): string {
  const total = bands.reduce((n, b) => n + b.reports, 0);
  if (total === 0) return "No reports of this measurement yet.";
  let top = bands[0];
  for (const b of bands) if (b.reports > top.reports) top = b;
  const share = top.percent === null ? "" : ` (${top.percent}%)`;
  return `Most reports are ${top.label}: ${number.format(top.reports)} of ${plural(total, "report", "reports")}${share}.`;
}

export function bandRows(metric: Vital, bands: readonly VitalBand[]): (string | number)[][] {
  return bands.map((b) => [
    b.label,
    bandRange(metric, b.rating),
    number.format(b.reports),
    b.percent === null ? "Not enough data" : `${b.percent}%`,
  ]);
}

export function medianRows(metric: Vital, daily: readonly { day: string; median: number; reports: number }[]): (string | number)[][] {
  return daily.map((d) => [formatDay(d.day), formatVital(metric, d.median), number.format(d.reports)]);
}

// ------------------------------------------------------------ visitors

export type Cohort = { label: string; cohort: number; returned: number; percent: number | null };

/** "Within 7 days: 42% of 120 visitors came back. Within 30 days: not enough visitors." */
export function describeCohorts(cohorts: readonly Cohort[], minimum: number): string {
  return cohorts
    .map((c) =>
      c.percent === null
        ? `${c.label}: not enough visitors (${number.format(c.cohort)} of the ${minimum} needed).`
        : `${c.label}: ${c.percent}% of ${plural(c.cohort, "visitor", "visitors")} came back.`
    )
    .join(" ");
}

export function cohortRows(cohorts: readonly Cohort[]): (string | number)[][] {
  return cohorts.map((c) => [
    c.label,
    number.format(c.cohort),
    number.format(c.returned),
    c.percent === null ? "Not enough data" : `${c.percent}%`,
  ]);
}

export type ReturningDay = { day: string; newVisitors: number; returning: number };

/** The day with the most visitors of either kind, and the day with the fewest. */
export function describeReturning(days: readonly ReturningDay[]): string {
  const points = days.map((d) => ({ label: formatDay(d.day), value: d.newVisitors + d.returning }));
  const total = days.reduce((n, d) => ({ fresh: n.fresh + d.newVisitors, back: n.back + d.returning }), { fresh: 0, back: 0 });
  const head = describeExtremes(points, { one: "visitor", many: "visitors" }, "No days to show.");
  if (points.length === 0) return head;
  return `${head} New: ${number.format(total.fresh)}. Returning: ${number.format(total.back)}.`;
}
