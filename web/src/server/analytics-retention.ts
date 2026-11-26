import { and, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { LIVE_WINDOW_MS } from "@/server/analytics";
import { getFeatures } from "@/server/analytics-config";
import { lastDays } from "@/server/analytics-events";
import { share } from "@/server/analytics-funnel";
import { getDb, schema } from "@/server/db";
import { getReadableProject } from "@/server/projects";

/**
 * Returning visitors and the live view, both built on the retention code: an
 * HMAC of a random id the visitor's browser keeps in localStorage. The code
 * changes every 90 days (see retentionCode), so a visitor who comes back after
 * a change counts as new, and the figures here cover at most the stored 90 days.
 */

const DAY_MS = 86_400_000;

/** A cohort smaller than this gets no percentage. */
export const MIN_COHORT = 20;

export type Visit = { vid: string; at: number };

export type ReturnRate = {
  /** Visitors whose first stored visit fell in the cohort window. */
  cohort: number;
  /** Of those, the ones who came back on a later UTC day within the horizon. */
  returned: number;
  /** Null when the cohort is smaller than MIN_COHORT. */
  percent: number | null;
  enough: boolean;
};

/**
 * Of the visitors first seen from `fromDaysAgo` to `toDaysAgo` days before `now`
 * (the later end excluded), how many visited again on a later UTC day and within
 * `horizonDays` days of their first visit. The windows are chosen so the whole
 * follow-up period has already passed. Pure.
 */
export function returnRate(
  visits: readonly Visit[],
  now: number,
  fromDaysAgo: number,
  toDaysAgo: number,
  horizonDays: number
): ReturnRate {
  const byVisitor = new Map<string, number[]>();
  for (const v of visits) {
    const list = byVisitor.get(v.vid);
    if (list) list.push(v.at);
    else byVisitor.set(v.vid, [v.at]);
  }
  const from = now - fromDaysAgo * DAY_MS;
  const to = now - toDaysAgo * DAY_MS;
  let cohort = 0;
  let returned = 0;
  for (const times of byVisitor.values()) {
    const first = Math.min(...times);
    if (first < from || first >= to) continue;
    cohort += 1;
    const firstDay = Math.floor(first / DAY_MS);
    const limit = first + horizonDays * DAY_MS;
    if (times.some((t) => Math.floor(t / DAY_MS) > firstDay && t <= limit)) returned += 1;
  }
  const enough = cohort >= MIN_COHORT;
  return { cohort, returned, percent: enough ? share(returned, cohort) : null, enough };
}

export type RetentionSummary = {
  /** Distinct visitors with a page view in the last 7 days. */
  visitorsThisWeek: number;
  /** Of the visitors who first came 7 to 14 days ago, those who came back within 7 days. */
  week: ReturnRate;
  /** Of the visitors who first came 30 to 37 days ago, those who came back within 30 days. */
  month: ReturnRate;
  minimum: number;
  /**
   * For each UTC day of the last 30: visitors on their first stored day (new) and visitors who had
   * been seen on an earlier day (returning). Someone first seen before the stored 90 days, or
   * before the code changed, counts as new on their first stored day.
   */
  daily: { day: string; newVisitors: number; returning: number }[];
};

/**
 * Splits each day's distinct visitors into new and returning. `perDay` has one row per visitor per
 * day they visited; `firstSeen` is the first stored visit of each, as a UTC day. Pure.
 */
export function splitReturning(
  days: readonly string[],
  perDay: readonly { vid: string; day: string }[],
  firstSeen: ReadonlyMap<string, string>
): RetentionSummary["daily"] {
  const counts = new Map<string, { newVisitors: number; returning: number }>(
    days.map((day) => [day, { newVisitors: 0, returning: 0 }])
  );
  for (const row of perDay) {
    const slot = counts.get(row.day);
    if (!slot) continue;
    if (firstSeen.get(row.vid) === row.day) slot.newVisitors += 1;
    else slot.returning += 1;
  }
  return days.map((day) => ({ day, ...counts.get(day)! }));
}

export async function retentionSummary(userId: string, projectId: string, now = new Date()): Promise<RetentionSummary> {
  const project = await getReadableProject(userId, projectId);
  const db = await getDb();
  const t = now.getTime();
  const base = and(eq(schema.pageviews.projectId, project.id), sql`${schema.pageviews.vid} is not null`);

  const thisWeek = await db
    .select({ n: sql<number>`count(distinct ${schema.pageviews.vid})` })
    .from(schema.pageviews)
    .where(and(base, gte(schema.pageviews.at, new Date(t - 7 * DAY_MS)), lte(schema.pageviews.at, now)))
    .get();

  // Visitors whose first stored visit is within the last 37 days, and every visit they made.
  const since = new Date(t - 37 * DAY_MS);
  const fresh = db
    .select({ vid: schema.pageviews.vid })
    .from(schema.pageviews)
    .where(base)
    .groupBy(schema.pageviews.vid)
    .having(sql`min(${schema.pageviews.at}) >= ${since.getTime()}`);
  const rows = await db
    .select({ vid: schema.pageviews.vid, at: schema.pageviews.at })
    .from(schema.pageviews)
    .where(and(base, inArray(schema.pageviews.vid, fresh)))
    .limit(200_000);
  const visits: Visit[] = rows.flatMap((r) => (r.vid ? [{ vid: r.vid, at: r.at.getTime() }] : []));

  // New against returning, per day of the last 30.
  const window = lastDays(30, now);
  const dayOf = sql<string>`strftime('%Y-%m-%d', ${schema.pageviews.at} / 1000, 'unixepoch')`;
  const inRange = and(base, gte(schema.pageviews.at, new Date(`${window[0]}T00:00:00Z`)), lte(schema.pageviews.at, now));
  const perDay = await db
    .selectDistinct({ vid: schema.pageviews.vid, day: dayOf })
    .from(schema.pageviews)
    .where(inRange)
    .limit(200_000);
  const seen = db.selectDistinct({ vid: schema.pageviews.vid }).from(schema.pageviews).where(inRange);
  const firsts = await db
    .select({ vid: schema.pageviews.vid, first: sql<number>`min(${schema.pageviews.at})` })
    .from(schema.pageviews)
    .where(and(base, inArray(schema.pageviews.vid, seen)))
    .groupBy(schema.pageviews.vid);
  const firstSeen = new Map(
    firsts.flatMap((r) => (r.vid ? [[r.vid, new Date(Number(r.first)).toISOString().slice(0, 10)] as const] : []))
  );

  return {
    visitorsThisWeek: Number(thisWeek?.n ?? 0),
    week: returnRate(visits, t, 14, 7, 7),
    month: returnRate(visits, t, 37, 30, 30),
    minimum: MIN_COHORT,
    daily: splitReturning(
      window,
      perDay.flatMap((r) => (r.vid ? [{ vid: r.vid, day: r.day }] : [])),
      firstSeen
    ),
  };
}

// ------------------------------------------------------------ live view

export type LiveSummary = {
  windowMinutes: number;
  /** Page views in the last 5 minutes. */
  views: number;
  /** Distinct visitors in the window, or null when retention is off and they cannot be told apart. */
  visitors: number | null;
};

/**
 * Page views in the last 5 minutes and, with retention on, the distinct visitors
 * in that window: those with a page view or a heartbeat.
 */
export async function liveSummary(userId: string, projectId: string, now = new Date()): Promise<LiveSummary> {
  const project = await getReadableProject(userId, projectId);
  const features = await getFeatures(project.id);
  const db = await getDb();
  const from = new Date(now.getTime() - LIVE_WINDOW_MS);
  const inWindow = and(
    eq(schema.pageviews.projectId, project.id),
    gte(schema.pageviews.at, from),
    lte(schema.pageviews.at, now)
  );
  const views = await db.select({ n: sql<number>`count(*)` }).from(schema.pageviews).where(inWindow).get();
  let visitors: number | null = null;
  if (features.retention) {
    const seen = new Set<string>();
    const fromViews = await db
      .select({ vid: schema.pageviews.vid })
      .from(schema.pageviews)
      .where(and(inWindow, sql`${schema.pageviews.vid} is not null`));
    for (const r of fromViews) if (r.vid) seen.add(r.vid);
    const beats = await db
      .select({ vid: schema.analyticsLive.vid })
      .from(schema.analyticsLive)
      .where(
        and(
          eq(schema.analyticsLive.projectId, project.id),
          gte(schema.analyticsLive.at, from),
          lte(schema.analyticsLive.at, now)
        )
      );
    for (const r of beats) seen.add(r.vid);
    visitors = seen.size;
  }
  return { windowMinutes: LIVE_WINDOW_MS / 60_000, views: Number(views?.n ?? 0), visitors };
}
