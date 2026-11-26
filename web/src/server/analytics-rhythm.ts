import { and, eq, gte, lte, sql } from "drizzle-orm";
import { getDb, schema } from "@/server/db";
import { getProjectForUser } from "@/server/projects";

/**
 * When a project's page views happen, by clock hour (UTC), for the last few days.
 * Read-only: it counts stored page views and never returns a visitor id or an address.
 */

const HOUR_MS = 3_600_000;

export type HourlyViews = {
  days: number;
  /** One entry per UTC hour in the range, oldest first. `at` is the start of the hour in ms. */
  hours: { at: number; views: number }[];
};

/**
 * Page views of the project per UTC clock hour for the last `days` days, ending with the
 * hour that contains `now`. Hours with no views are zero.
 */
export async function hourlyViews(userId: string, projectId: string, days = 30, now = new Date()): Promise<HourlyViews> {
  const project = await getProjectForUser(userId, projectId);
  const db = await getDb();
  const lastHour = Math.floor(now.getTime() / HOUR_MS);
  const firstHour = lastHour - days * 24 + 1;
  const hourExpr = sql<number>`(${schema.pageviews.at} / 3600000)`;
  const rows = await db
    .select({ hour: hourExpr, views: sql<number>`count(*)` })
    .from(schema.pageviews)
    .where(
      and(
        eq(schema.pageviews.projectId, project.id),
        gte(schema.pageviews.at, new Date(firstHour * HOUR_MS)),
        lte(schema.pageviews.at, now)
      )
    )
    .groupBy(hourExpr);
  const byHour = new Map(rows.map((r) => [Number(r.hour), Number(r.views)]));

  const hours: HourlyViews["hours"] = [];
  for (let h = firstHour; h <= lastHour; h++) {
    hours.push({ at: h * HOUR_MS, views: byHour.get(h) ?? 0 });
  }
  return { days, hours };
}
