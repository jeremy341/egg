import { and, desc, eq, gte, sql } from "drizzle-orm";
import {
  MIN_DAILY_REPORTS,
  VITALS,
  VITAL_NAMES,
  VITAL_RATING_LABELS,
  VITAL_UNITS,
  median,
  percentile,
  rateVital,
  type Vital,
  type VitalRating,
} from "@/server/analytics-fields";
import { lastDays, sinceDay } from "@/server/analytics-events";
import { getDb, schema } from "@/server/db";
import { getProjectForUser } from "@/server/projects";
import { MIN_SAMPLE } from "@/server/stats";

/**
 * Speed and errors, read back for the owner. Speed is the median and the 75th
 * percentile of what the browsers reported, with Google's good / needs work /
 * poor label on the 75th percentile (the way Google judges a page).
 */

export type VitalRow = { [K in Vital]: number | null } & {
  /** When the report arrived. Without it a row still counts, but not in the day-by-day line. */
  at?: Date;
};

export type VitalBand = {
  rating: VitalRating;
  label: string;
  /** Reports of this metric in the band. Always shown. */
  reports: number;
  /** Share of the reports, whole percent. Null below the minimum number of samples. */
  percent: number | null;
};

export type SpeedSummary = {
  days: number;
  /** Page views that reported at least one measurement. */
  reports: number;
  minimum: number;
  metrics: {
    metric: Vital;
    name: string;
    unit: "ms" | "score";
    /** Reports that included this metric. */
    samples: number;
    /** Null below the minimum number of samples. */
    median: number | null;
    p75: number | null;
    rating: VitalRating | null;
    ratingLabel: string | null;
    /** Reports in the good, needs-work and poor bands (the thresholds of VITAL_THRESHOLDS), in that order. */
    bands: VitalBand[];
    /** The median of each UTC day that has at least MIN_DAILY_REPORTS reports, oldest first. Days below it are left out. */
    daily: { day: string; median: number; reports: number }[];
  }[];
};

const BAND_ORDER: VitalRating[] = ["good", "needs-work", "poor"];

/** Reports per band as shares of whole percents: never 100 while another band has reports, never 0 while its own has. */
export function bandShares(counts: readonly number[]): number[] {
  const total = counts.reduce((n, c) => n + c, 0);
  return counts.map((c) => {
    if (total === 0) return 0;
    let p = Math.round((c / total) * 100);
    if (p === 100 && c < total) p = 99;
    if (p === 0 && c > 0) p = 1;
    return p;
  });
}

function dailyMedians(rows: readonly VitalRow[], metric: Vital): SpeedSummary["metrics"][number]["daily"] {
  const byDay = new Map<string, number[]>();
  for (const r of rows) {
    const v = r[metric];
    if (!r.at || typeof v !== "number") continue;
    const day = r.at.toISOString().slice(0, 10);
    const list = byDay.get(day);
    if (list) list.push(v);
    else byDay.set(day, [v]);
  }
  return [...byDay.entries()]
    .filter(([, values]) => values.length >= MIN_DAILY_REPORTS)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([day, values]) => ({ day, median: median(values) ?? 0, reports: values.length }));
}

/**
 * Median and 75th percentile for each metric. A metric with fewer than the
 * minimum number of samples keeps its count and gets no figures and no label.
 * Pure.
 */
export function summariseVitals(rows: readonly VitalRow[], days = 30): SpeedSummary {
  return {
    days,
    reports: rows.length,
    minimum: MIN_SAMPLE,
    metrics: VITALS.map((metric) => {
      const values = rows.map((r) => r[metric]).filter((v): v is number => typeof v === "number");
      const enough = values.length >= MIN_SAMPLE;
      const m = enough ? median(values) : null;
      const p75 = enough ? percentile(values, 75) : null;
      const rating = p75 === null ? null : rateVital(metric, p75);
      const counts = BAND_ORDER.map((band) => values.filter((v) => rateVital(metric, v) === band).length);
      const shares = bandShares(counts);
      return {
        metric,
        name: VITAL_NAMES[metric],
        unit: VITAL_UNITS[metric],
        samples: values.length,
        median: m,
        p75,
        rating,
        ratingLabel: rating ? VITAL_RATING_LABELS[rating] : null,
        bands: BAND_ORDER.map((band, i) => ({
          rating: band,
          label: VITAL_RATING_LABELS[band],
          reports: counts[i],
          percent: enough ? shares[i] : null,
        })),
        daily: dailyMedians(rows, metric),
      };
    }),
  };
}

/** The most reports one read looks at, newest first, so a very busy site does not load the table. */
const MAX_REPORTS = 20_000;

export async function speedSummary(userId: string, projectId: string, days = 30, now = new Date()): Promise<SpeedSummary> {
  const project = await getProjectForUser(userId, projectId);
  const db = await getDb();
  const rows = await db
    .select({
      at: schema.analyticsVitals.at,
      lcp: schema.analyticsVitals.lcp,
      cls: schema.analyticsVitals.cls,
      inp: schema.analyticsVitals.inp,
      fcp: schema.analyticsVitals.fcp,
      ttfb: schema.analyticsVitals.ttfb,
    })
    .from(schema.analyticsVitals)
    .where(
      and(
        eq(schema.analyticsVitals.projectId, project.id),
        gte(schema.analyticsVitals.at, new Date(`${sinceDay(days, now)}T00:00:00Z`))
      )
    )
    .orderBy(desc(schema.analyticsVitals.at))
    .limit(MAX_REPORTS);
  return summariseVitals(rows, days);
}

export type ErrorsSummary = {
  days: number;
  total: number;
  rows: { message: string; file: string | null; line: number | null; count: number; lastSeen: Date }[];
  /** Errors on each UTC day of the range, quiet days as zero. */
  daily: { day: string; count: number }[];
};

const errorDay = sql<string>`strftime('%Y-%m-%d', ${schema.analyticsErrors.at} / 1000, 'unixepoch')`;

/** The most frequent errors of the last `days` days: the same message from the same file and line counts together. */
export async function errorsSummary(userId: string, projectId: string, days = 30, now = new Date()): Promise<ErrorsSummary> {
  const project = await getProjectForUser(userId, projectId);
  const db = await getDb();
  const where = and(
    eq(schema.analyticsErrors.projectId, project.id),
    gte(schema.analyticsErrors.at, new Date(`${sinceDay(days, now)}T00:00:00Z`))
  );
  const lastSeen = sql<number>`max(${schema.analyticsErrors.at})`;
  const rows = await db
    .select({
      message: schema.analyticsErrors.message,
      file: schema.analyticsErrors.file,
      line: schema.analyticsErrors.line,
      count: sql<number>`count(*)`,
      lastSeen,
    })
    .from(schema.analyticsErrors)
    .where(where)
    .groupBy(schema.analyticsErrors.message, schema.analyticsErrors.file, schema.analyticsErrors.line)
    .orderBy(desc(sql`count(*)`), desc(lastSeen))
    .limit(20);
  const total = await db.select({ n: sql<number>`count(*)` }).from(schema.analyticsErrors).where(where).get();
  const perDay = await db
    .select({ day: errorDay, count: sql<number>`count(*)` })
    .from(schema.analyticsErrors)
    .where(where)
    .groupBy(errorDay);
  const counts = new Map(perDay.map((r) => [r.day, Number(r.count)]));
  return {
    days,
    total: Number(total?.n ?? 0),
    daily: lastDays(days, now).map((day) => ({ day, count: counts.get(day) ?? 0 })),
    rows: rows.map((r) => ({
      message: r.message,
      file: r.file,
      line: r.line,
      count: Number(r.count),
      lastSeen: new Date(Number(r.lastSeen)),
    })),
  };
}
