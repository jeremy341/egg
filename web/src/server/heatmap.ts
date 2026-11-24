import { and, eq, gte, lte, sql, type AnyColumn, type SQL } from "drizzle-orm";
import { getDb, schema } from "@/server/db";
import { HEATMAP_DAYS, mergeCounts, windowStartMs } from "@/lib/heatmap";

/**
 * Activity per UTC day over the heatmap window. Activity is deployments created
 * plus pull requests opened. Counts are grouped in SQL, so an account with many
 * projects still returns one row per active day.
 */

type Filter = { projectId?: string; userId?: string };

/** The UTC day of a millisecond timestamp column, as YYYY-MM-DD. */
const dayOf = (column: AnyColumn): SQL<string> => sql<string>`date(${column} / 1000, 'unixepoch')`;

async function deploysByDay(filter: Filter, since: number, until: number): Promise<Record<string, number>> {
  const db = await getDb();
  const day = dayOf(schema.deployments.createdAt);
  const rows = await db
    .select({ day, n: sql<number>`count(*)` })
    .from(schema.deployments)
    .innerJoin(schema.projects, eq(schema.projects.id, schema.deployments.projectId))
    .where(
      and(
        gte(schema.deployments.createdAt, new Date(since)),
        lte(schema.deployments.createdAt, new Date(until)),
        filter.projectId ? eq(schema.deployments.projectId, filter.projectId) : undefined,
        filter.userId ? eq(schema.projects.userId, filter.userId) : undefined
      )
    )
    .groupBy(day);
  return Object.fromEntries(rows.map((r) => [r.day, Number(r.n)]));
}

async function pullsByDay(filter: Filter, since: number, until: number): Promise<Record<string, number>> {
  const db = await getDb();
  const day = dayOf(schema.pullRequestEvents.createdAt);
  const rows = await db
    .select({ day, n: sql<number>`count(*)` })
    .from(schema.pullRequestEvents)
    .innerJoin(schema.projects, eq(schema.projects.id, schema.pullRequestEvents.projectId))
    .where(
      and(
        eq(schema.pullRequestEvents.action, "opened"),
        gte(schema.pullRequestEvents.createdAt, new Date(since)),
        lte(schema.pullRequestEvents.createdAt, new Date(until)),
        filter.projectId ? eq(schema.pullRequestEvents.projectId, filter.projectId) : undefined,
        filter.userId ? eq(schema.projects.userId, filter.userId) : undefined
      )
    )
    .groupBy(day);
  return Object.fromEntries(rows.map((r) => [r.day, Number(r.n)]));
}

async function dailyActivity(filter: Filter, now: number, days: number): Promise<Record<string, number>> {
  const since = windowStartMs(now, days);
  const [deploys, pulls] = await Promise.all([deploysByDay(filter, since, now), pullsByDay(filter, since, now)]);
  return mergeCounts(deploys, pulls);
}

/**
 * Per-day activity for one project. No permission check: the caller must already
 * have checked that the person can read the project.
 */
export function projectDailyActivity(projectId: string, now = Date.now(), days = HEATMAP_DAYS) {
  return dailyActivity({ projectId }, now, days);
}

/** Per-day activity across every project the account owns. */
export function accountDailyActivity(userId: string, now = Date.now(), days = HEATMAP_DAYS) {
  return dailyActivity({ userId }, now, days);
}
