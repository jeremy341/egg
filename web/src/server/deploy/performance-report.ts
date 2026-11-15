import { and, desc, eq, lt, ne } from "drizzle-orm";
import { getDb, schema } from "@/server/db";
import { queueDurationMs, summarizePerformance } from "./performance";

type Deployment = typeof schema.deployments.$inferSelect;
export async function performanceReport(dep: Deployment) {
  const db = await getDb();
  const previous = await db.select({ id: schema.deployments.id }).from(schema.deployments)
    .where(and(eq(schema.deployments.projectId, dep.projectId), eq(schema.deployments.env, dep.env), eq(schema.deployments.state, "ready"), ne(schema.deployments.id, dep.id), lt(schema.deployments.createdAt, dep.createdAt)))
    .orderBy(desc(schema.deployments.createdAt), desc(schema.deployments.id)).limit(1).get();
  const read = (id: string) => db.select({ stage: schema.deployStageMetrics.stage, startedAt: schema.deployStageMetrics.startedAt, finishedAt: schema.deployStageMetrics.finishedAt, durationMs: schema.deployStageMetrics.durationMs, bytes: schema.deployStageMetrics.bytes, metadata: schema.deployStageMetrics.metadata }).from(schema.deployStageMetrics).where(eq(schema.deployStageMetrics.deploymentId, id)).orderBy(schema.deployStageMetrics.startedAt);
  const stages = await read(dep.id);
  const previousStages = previous ? await read(previous.id) : [];
  const safe = stages.map(({ metadata, ...row }) => ({ ...row, outcome: metadata === '{"outcome":"ok"}' ? "ok" : metadata === '{"outcome":"failed"}' ? "failed" : "unknown" }));
  return { deploymentId: dep.id, queueDurationMs: queueDurationMs(dep.createdAt, dep.startedAt), stages: safe, previousDeploymentId: previous?.id ?? null, ...summarizePerformance(stages, previousStages), telemetryNote: "Only recorded stages are shown. The build stage includes dependency installation. Older deployments and interrupted stages may have no measurements." };
}

