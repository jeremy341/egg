import { and, eq, gte, sql } from "drizzle-orm";
import { getDb, schema } from "@/server/db";
import { windowKeys, windowStartMs } from "@/lib/heatmap";
import {
  buildTimeByDay,
  deployCountByDay,
  deploySuccessByDay,
  enabledSeries,
  visitorsByDay,
  type MetricSeries,
  type MetricsRange,
} from "@/lib/statistics-metrics";
import { getReadableProject } from "@/server/projects";
import { getStatistics } from "@/server/statistics";

export type StatisticsMetrics = {
  range: MetricsRange;
  days: number;
  /** First and last UTC day of the series, "YYYY-MM-DD". */
  from: string;
  to: string;
  /** Only the statistics that are switched on. An off statistic has no key here. */
  series: Partial<MetricSeries>;
};

/**
 * Daily series for one project over the last `days` UTC days, including only the
 * statistics switched on. Rows are fetched only for the switches that need them.
 * The caller must be able to read the project; this checks that.
 */
export async function projectStatisticsMetrics(
  userId: string,
  projectId: string,
  range: { range: MetricsRange; days: number },
  now = new Date()
): Promise<StatisticsMetrics> {
  const project = await getReadableProject(userId, projectId);
  const switches = await getStatistics(project.id);
  const nowMs = now.getTime();
  const since = windowStartMs(nowMs, range.days);
  const db = await getDb();

  const computed: Partial<MetricSeries> = {};

  if (switches.deployCount || switches.deploySuccess || switches.buildTime) {
    const deploys = await db
      .select({
        createdAt: schema.deployments.createdAt,
        state: schema.deployments.state,
        startedAt: schema.deployments.startedAt,
        finishedAt: schema.deployments.finishedAt,
      })
      .from(schema.deployments)
      .where(and(eq(schema.deployments.projectId, project.id), gte(schema.deployments.createdAt, new Date(since))));
    const rows = deploys.map((d) => ({
      createdAt: d.createdAt.getTime(),
      state: d.state,
      startedAt: d.startedAt ? d.startedAt.getTime() : null,
      finishedAt: d.finishedAt ? d.finishedAt.getTime() : null,
    }));
    if (switches.deployCount) computed.deployCount = deployCountByDay(rows, nowMs, range.days);
    if (switches.deploySuccess) computed.deploySuccess = deploySuccessByDay(rows, nowMs, range.days);
    if (switches.buildTime) computed.buildTime = buildTimeByDay(rows, nowMs, range.days);
  }

  if (switches.visitors) {
    // Distinct visitors per day are counted in the database: a busy project has far
    // more page views than it has days, and the count is what the series needs.
    const day = sql<string>`date(${schema.pageviews.at} / 1000, 'unixepoch')`;
    const rows = await db
      .select({ day, n: sql<number>`count(distinct ${schema.pageviews.visitor})` })
      .from(schema.pageviews)
      .where(and(eq(schema.pageviews.projectId, project.id), gte(schema.pageviews.at, new Date(since))))
      .groupBy(day);
    const counts = Object.fromEntries(rows.map((r) => [r.day, Number(r.n)]));
    computed.visitors = visitorsByDay(counts, nowMs, range.days);
  }

  const keys = windowKeys(nowMs, range.days);
  return {
    range: range.range,
    days: range.days,
    from: keys[0]!,
    to: keys[keys.length - 1]!,
    series: enabledSeries(switches, computed),
  };
}
