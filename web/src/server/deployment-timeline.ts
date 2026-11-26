import { eq } from "drizzle-orm";
import { getDb, schema } from "@/server/db";
import { buildTimeline, type Timeline, type TimelineLog, type TimelineMetric } from "@/lib/deploy-timeline";

function outcomeOf(metadata: string): TimelineMetric["outcome"] {
  try {
    const value = (JSON.parse(metadata) as { outcome?: unknown }).outcome;
    return value === "ok" || value === "failed" ? value : "unknown";
  } catch {
    return "unknown";
  }
}

/**
 * The timeline of one deployment. Read only: it uses the deployment row, the stage measurements the
 * pipeline already writes and the log lines the caller already loaded. The caller has checked that
 * the person may read this deployment.
 */
export async function deploymentTimeline(deploymentId: string, logs: TimelineLog[]): Promise<Timeline | null> {
  const db = await getDb();
  const dep = await db.select().from(schema.deployments).where(eq(schema.deployments.id, deploymentId)).get();
  if (!dep) return null;
  const rows = await db
    .select({
      stage: schema.deployStageMetrics.stage,
      startedAt: schema.deployStageMetrics.startedAt,
      finishedAt: schema.deployStageMetrics.finishedAt,
      durationMs: schema.deployStageMetrics.durationMs,
      metadata: schema.deployStageMetrics.metadata,
    })
    .from(schema.deployStageMetrics)
    .where(eq(schema.deployStageMetrics.deploymentId, deploymentId))
    .orderBy(schema.deployStageMetrics.startedAt);
  const metrics: TimelineMetric[] = rows.map((r) => ({
    stage: r.stage,
    startedAt: r.startedAt,
    finishedAt: r.finishedAt,
    durationMs: r.durationMs,
    outcome: outcomeOf(r.metadata ?? ""),
  }));
  return buildTimeline(dep, metrics, logs);
}
