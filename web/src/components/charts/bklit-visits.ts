/**
 * Adapter between the analytics page data and the Bklit UI area chart.
 *
 * The page gives `AnalyticsChart` a list of days, `{ day: "2026-11-04", views, visitors }`,
 * where `day` is a UTC calendar day. Bklit wants rows with a `Date` under one key. This file
 * only reshapes: it never sums, sorts, fills gaps or drops a day, so the totals and the order
 * are the ones the page was given.
 */

export type Day = { day: string; views: number; visitors: number };

/** One row for the Bklit chart. `date` is midnight UTC of the day. */
export type BklitPoint = { date: Date; views: number; visitors: number };

const number = new Intl.NumberFormat("en");
const dayFormat = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});

/** "2026-11-04" as "4 Nov". The strings are UTC calendar days, so the formatter is pinned to UTC. */
export function formatDay(day: string): string {
  return dayFormat.format(new Date(`${day}T00:00:00Z`));
}

export function plural(n: number, one: string, many: string): string {
  return `${number.format(n)} ${n === 1 ? one : many}`;
}

/** Same days, same order, same numbers; only `day` becomes a `Date`. */
export function toBklitData(daily: Day[]): BklitPoint[] {
  return daily.map((d) => ({
    date: new Date(`${d.day}T00:00:00Z`),
    views: d.views,
    visitors: d.visitors,
  }));
}

/** One label per row, in the same order as the rows, for the axis and the tooltip date pill. */
export function dayLabels(daily: Day[]): string[] {
  return daily.map((d) => formatDay(d.day));
}

export type Extremes = { highest: Day; lowest: Day };

/** The day with the most views and the day with the fewest. A tie keeps the earlier day. */
export function extremes(daily: Day[]): Extremes | null {
  if (daily.length === 0) return null;
  let highest = daily[0];
  let lowest = daily[0];
  for (const d of daily) {
    if (d.views > highest.views) highest = d;
    if (d.views < lowest.views) lowest = d;
  }
  return { highest, lowest };
}

/** The short text summary of the chart, for people who cannot see it. */
export function summarise(daily: Day[]): string {
  const e = extremes(daily);
  if (!e) return "No days to show.";
  if (daily.length === 1) {
    return `${formatDay(e.highest.day)}: ${plural(e.highest.views, "view", "views")}.`;
  }
  return `Highest: ${formatDay(e.highest.day)}, ${plural(e.highest.views, "view", "views")}. Lowest: ${formatDay(e.lowest.day)}, ${plural(e.lowest.views, "view", "views")}.`;
}
