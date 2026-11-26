/**
 * Calendar heatmap maths. Days are UTC days, keyed "YYYY-MM-DD". Pure: no
 * database or clock access, so the server and the browser can share it.
 */

export const HEATMAP_DAYS = 365;
const DAY_MS = 86_400_000;

export type Level = 0 | 1 | 2 | 3 | 4;

export type HeatmapCell = { date: string; count: number; level: Level };

export type Heatmap = {
  /** Oldest first; always HEATMAP_DAYS entries, ending on the UTC day of `now`. */
  cells: HeatmapCell[];
  total: number;
  activeDays: number;
  busiest: { date: string; count: number } | null;
};

/** The UTC day key of a timestamp in milliseconds. */
export function utcDayKey(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Midnight UTC at the start of the day that contains `ms`. */
export function utcDayStart(ms: number): number {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/** The first instant of the heatmap window: midnight UTC, `days - 1` days before today. */
export function windowStartMs(now: number, days = HEATMAP_DAYS): number {
  return utcDayStart(now) - (days - 1) * DAY_MS;
}

/** Day keys of the window, oldest first. */
export function windowKeys(now: number, days = HEATMAP_DAYS): string[] {
  const start = windowStartMs(now, days);
  return Array.from({ length: days }, (_, i) => utcDayKey(start + i * DAY_MS));
}

/** Count timestamps (ms) per UTC day, keeping only days in the window. */
export function countByDay(times: number[], now: number, days = HEATMAP_DAYS): Record<string, number> {
  const keys = new Set(windowKeys(now, days));
  const counts: Record<string, number> = {};
  for (const t of times) {
    if (!Number.isFinite(t)) continue;
    const key = utcDayKey(t);
    if (keys.has(key)) counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

/** Add several per-day count maps together (for example deploys plus pull requests). */
export function mergeCounts(...sources: Record<string, number>[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const source of sources) {
    for (const [key, value] of Object.entries(source)) {
      if (Number.isFinite(value) && value > 0) out[key] = (out[key] ?? 0) + value;
    }
  }
  return out;
}

/**
 * Intensity from 0 (nothing) to 4 (the busiest day). Relative to the busiest
 * day in the window, so a quiet project still shows its shape.
 */
export function levelFor(count: number, max: number): Level {
  if (!(count > 0) || !(max > 0)) return 0;
  const level = Math.ceil((count * 4) / max);
  return Math.min(4, Math.max(1, level)) as Level;
}

export function buildHeatmap(counts: Record<string, number>, now: number, days = HEATMAP_DAYS): Heatmap {
  const keys = windowKeys(now, days);
  let max = 0;
  let total = 0;
  let activeDays = 0;
  let busiest: Heatmap["busiest"] = null;
  for (const key of keys) {
    const count = counts[key] ?? 0;
    if (count > 0) {
      total += count;
      activeDays++;
      max = Math.max(max, count);
      if (!busiest || count > busiest.count) busiest = { date: key, count };
    }
  }
  const cells = keys.map((date) => {
    const count = counts[date] ?? 0;
    return { date, count, level: levelFor(count, max) };
  });
  return { cells, total, activeDays, busiest };
}

/**
 * Columns of weeks for a calendar grid: each week is seven entries, Sunday
 * first, with null for the days before the window starts or after its end.
 */
export function toWeeks(cells: HeatmapCell[]): (HeatmapCell | null)[][] {
  if (cells.length === 0) return [];
  const first = new Date(`${cells[0]!.date}T00:00:00Z`).getUTCDay();
  const padded: (HeatmapCell | null)[] = [...Array<null>(first).fill(null), ...cells];
  while (padded.length % 7 !== 0) padded.push(null);
  const weeks: (HeatmapCell | null)[][] = [];
  for (let i = 0; i < padded.length; i += 7) weeks.push(padded.slice(i, i + 7));
  return weeks;
}

/** A sentence for screen readers and for people who cannot see the colours. */
export function describeHeatmap(heatmap: Heatmap, scope: string, days = HEATMAP_DAYS): string {
  if (heatmap.total === 0) return `No ${scope} activity in the last ${days} days.`;
  const events = heatmap.total === 1 ? "1 event" : `${heatmap.total} events`;
  const active = heatmap.activeDays === 1 ? "1 day" : `${heatmap.activeDays} days`;
  const busiest = heatmap.busiest
    ? ` Busiest day: ${heatmap.busiest.date}, ${heatmap.busiest.count} ${heatmap.busiest.count === 1 ? "event" : "events"}.`
    : "";
  return `${events} of ${scope} activity on ${active} in the last ${days} days.${busiest}`;
}
