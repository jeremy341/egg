/**
 * Daily series behind the per-project statistics switches. Pure: no database or
 * clock access. Days are UTC days ("YYYY-MM-DD"), oldest first, ending on the UTC
 * day of `now`. Every series has one entry per day in the range, so a quiet day
 * is a zero (counts) or null (rates and averages), never a gap.
 */

import { countByDay, utcDayKey, windowKeys } from "@/lib/heatmap";

export const METRIC_RANGES = { "7d": 7, "30d": 30, "90d": 90 } as const;
export type MetricsRange = keyof typeof METRIC_RANGES;
export const DEFAULT_METRICS_RANGE: MetricsRange = "30d";

/** The statistics a series can be built for. Same keys as the switches. */
export type MetricKey = "deployCount" | "deploySuccess" | "buildTime" | "visitors";

export type DayCount = { date: string; count: number };
/** `percent` is null on a day with no finished deploys. Rounded to a whole percent. */
export type DayPercent = { date: string; percent: number | null; finished: number; succeeded: number };
/** `averageMs` is the mean build time, null on a day with no completed builds. */
export type DayAverage = { date: string; averageMs: number | null; builds: number };
export type DayVisitors = { date: string; visitors: number };

/** A deployment row as the metrics need it. Timestamps are milliseconds. */
export type DeployRow = { createdAt: number; state: string };
export type BuildRow = DeployRow & { startedAt: number | null; finishedAt: number | null };

/**
 * Read `?range=`. Absent means the default (30d). Anything other than the exact
 * keys of METRIC_RANGES is refused with null, including "365d", "30" and "".
 */
export function parseMetricsRange(raw: string | null | undefined): { range: MetricsRange; days: number } | null {
  const key = raw ?? DEFAULT_METRICS_RANGE;
  if (!Object.prototype.hasOwnProperty.call(METRIC_RANGES, key)) return null;
  const range = key as MetricsRange;
  return { range, days: METRIC_RANGES[range] };
}

/** Deploy count per day. Counts every deployment, whatever its state. */
export function deployCountByDay(deploys: DeployRow[], now: number, days: number): DayCount[] {
  const counts = countByDay(
    deploys.map((d) => d.createdAt),
    now,
    days
  );
  return windowKeys(now, days).map((date) => ({ date, count: counts[date] ?? 0 }));
}

/**
 * Share of finished deploys that went live, per day the deploy was created.
 * Only "ready" (live) and "error" (failed) count as finished. Canceled and
 * still-running deploys are left out of both the numerator and the denominator.
 * A day with a single failure is 0 percent, not null.
 */
export function deploySuccessByDay(deploys: DeployRow[], now: number, days: number): DayPercent[] {
  const tally = new Map<string, { finished: number; succeeded: number }>();
  for (const d of deploys) {
    if (!Number.isFinite(d.createdAt)) continue;
    if (d.state !== "ready" && d.state !== "error") continue;
    const key = utcDayKey(d.createdAt);
    const t = tally.get(key) ?? { finished: 0, succeeded: 0 };
    t.finished++;
    if (d.state === "ready") t.succeeded++;
    tally.set(key, t);
  }
  return windowKeys(now, days).map((date) => {
    const t = tally.get(date) ?? { finished: 0, succeeded: 0 };
    return {
      date,
      percent: t.finished > 0 ? Math.round((t.succeeded * 100) / t.finished) : null,
      finished: t.finished,
      succeeded: t.succeeded,
    };
  });
}

/**
 * Mean build time per day the deploy was created, in milliseconds. A build is
 * startedAt to finishedAt for a deploy that ended "ready" or "error" (a build
 * that failed still took that long). Deploys that never started, never
 * finished, or have a negative or non-finite duration are left out.
 * The mean is used rather than the median; one slow build moves it.
 */
export function buildTimeByDay(deploys: BuildRow[], now: number, days: number): DayAverage[] {
  const tally = new Map<string, { total: number; builds: number }>();
  for (const d of deploys) {
    if (!Number.isFinite(d.createdAt)) continue;
    if (d.state !== "ready" && d.state !== "error") continue;
    if (d.startedAt === null || d.finishedAt === null) continue;
    const ms = d.finishedAt - d.startedAt;
    if (!Number.isFinite(ms) || ms < 0) continue;
    const key = utcDayKey(d.createdAt);
    const t = tally.get(key) ?? { total: 0, builds: 0 };
    t.total += ms;
    t.builds++;
    tally.set(key, t);
  }
  return windowKeys(now, days).map((date) => {
    const t = tally.get(date);
    return {
      date,
      averageMs: t && t.builds > 0 ? Math.round(t.total / t.builds) : null,
      builds: t?.builds ?? 0,
    };
  });
}

/**
 * Distinct visitors per day. `counts` is the per-day distinct count already
 * grouped in the database, keyed by UTC day. Days without a count are zero.
 */
export function visitorsByDay(counts: Record<string, number>, now: number, days: number): DayVisitors[] {
  return windowKeys(now, days).map((date) => {
    const n = counts[date];
    return { date, visitors: Number.isFinite(n) && n > 0 ? n : 0 };
  });
}

/**
 * Keep only the series whose switch is on. A switch that is off leaves its key
 * out of the result entirely, so the response carries no zeros for it.
 */
export type MetricSeries = {
  deployCount: DayCount[];
  deploySuccess: DayPercent[];
  buildTime: DayAverage[];
  visitors: DayVisitors[];
};

export function enabledSeries(
  switches: Record<MetricKey, boolean>,
  computed: Partial<MetricSeries>
): Partial<MetricSeries> {
  const out: Partial<MetricSeries> = {};
  for (const key of Object.keys(switches) as MetricKey[]) {
    const value = computed[key];
    if (switches[key] === true && value !== undefined) {
      (out as Record<MetricKey, unknown>)[key] = value;
    }
  }
  return out;
}
