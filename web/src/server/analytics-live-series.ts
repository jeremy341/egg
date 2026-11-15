import { and, eq, gte, lte, sql } from "drizzle-orm";
import { getDb, schema } from "@/server/db";
import { getProjectForUser } from "@/server/projects";

/**
 * Page views per minute for the "on the site now" chart. Reads the page views table only.
 * Read-only: nothing identifies a visitor in the result.
 */

const MINUTE_MS = 60_000;
export const LIVE_SERIES_MAX_MINUTES = 60;

export type LiveSeries = {
  minutes: number;
  /** One entry per minute, oldest first. `at` is the start of the minute in ms. Empty minutes are zeros. */
  points: { at: number; views: number }[];
};

export async function liveSeries(userId: string, projectId: string, minutes = 30, now = new Date()): Promise<LiveSeries> {
  const project = await getProjectForUser(userId, projectId);
  const span = Math.min(LIVE_SERIES_MAX_MINUTES, Math.max(1, Math.floor(minutes)));
  const db = await getDb();
  const lastMinute = Math.floor(now.getTime() / MINUTE_MS);
  const firstMinute = lastMinute - span + 1;
  const minuteExpr = sql<number>`(${schema.pageviews.at} / 60000)`;
  const rows = await db
    .select({ minute: minuteExpr, views: sql<number>`count(*)` })
    .from(schema.pageviews)
    .where(
      and(
        eq(schema.pageviews.projectId, project.id),
        gte(schema.pageviews.at, new Date(firstMinute * MINUTE_MS)),
        lte(schema.pageviews.at, now)
      )
    )
    .groupBy(minuteExpr);
  const byMinute = new Map(rows.map((r) => [Number(r.minute), Number(r.views)]));

  const points: LiveSeries["points"] = [];
  for (let m = firstMinute; m <= lastMinute; m++) {
    points.push({ at: m * MINUTE_MS, views: byMinute.get(m) ?? 0 });
  }
  return { minutes: span, points };
}
