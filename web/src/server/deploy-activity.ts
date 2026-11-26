import { and, count, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { getDb, schema } from "@/server/db";
import { getProjectForUser } from "@/server/projects";

/**
 * Deployments per UTC day: how many were started and how many failed. Read-only.
 * Covers every project the user owns, or one project when a project id is given.
 */

const DAY_MS = 86_400_000;

export type DeployDay = { day: string; total: number; failed: number };

export type DeployActivity = {
  days: number;
  /** One entry per UTC day in the range, oldest first. Quiet days are zeros. */
  daily: DeployDay[];
  /** Deployments in the range, all days added up. */
  total: number;
  /** The day with the most deployments, or null when there are none. */
  busiestDay: DeployDay | null;
};

const dayExpr = sql<string>`strftime('%Y-%m-%d', ${schema.deployments.createdAt} / 1000, 'unixepoch')`;

export async function deployActivity(
  userId: string,
  opts: { projectId?: string; days?: number } = {},
  now = new Date()
): Promise<DeployActivity> {
  const days = Math.max(1, Math.floor(opts.days ?? 365));
  const db = await getDb();

  const scope = opts.projectId
    ? eq(schema.deployments.projectId, (await getProjectForUser(userId, opts.projectId)).id)
    : inArray(
        schema.deployments.projectId,
        db.select({ id: schema.projects.id }).from(schema.projects).where(eq(schema.projects.userId, userId))
      );

  const range: string[] = [];
  for (let i = days - 1; i >= 0; i--) range.push(new Date(now.getTime() - i * DAY_MS).toISOString().slice(0, 10));
  const since = new Date(`${range[0]}T00:00:00Z`);

  const rows = await db
    .select({
      day: dayExpr,
      total: count(),
      failed: sql<number>`sum(case when ${schema.deployments.state} = 'error' then 1 else 0 end)`,
    })
    .from(schema.deployments)
    .where(and(scope, gte(schema.deployments.createdAt, since), lte(schema.deployments.createdAt, now)))
    .groupBy(dayExpr);
  const byDay = new Map(rows.map((r) => [r.day, r]));

  const daily: DeployDay[] = range.map((day) => {
    const r = byDay.get(day);
    return { day, total: Number(r?.total ?? 0), failed: Number(r?.failed ?? 0) };
  });

  let busiestDay: DeployDay | null = null;
  for (const d of daily) {
    if (d.total > 0 && (!busiestDay || d.total > busiestDay.total)) busiestDay = d;
  }

  return {
    days,
    daily,
    total: daily.reduce((n, d) => n + d.total, 0),
    busiestDay,
  };
}
