import { randomUUID } from "node:crypto";
import { getDb } from "@/server/db";
import { deployStageMetrics } from "@/server/db/schema";

export type StageName = "source" | "upload" | "lock_wait" | "unpack" | "compose" | "build" | "activation" | "health";
export type StageMetric = { stage: StageName; startedAt: Date; finishedAt: Date; durationMs: number; bytes: number | null; metadata: { outcome: "ok" | "failed" } };
export type StageRecorder = (metric: StageMetric) => Promise<void>;

/** Telemetry is best effort and never changes deployment behavior. No user data is recorded. */
export function startStage(stage: StageName, record: StageRecorder, bytes: number | null = null) {
  const startedAt = new Date();
  const start = performance.now();
  let finished = false;
  return async (outcome: "ok" | "failed") => {
    if (finished) return;
    finished = true;
    const metric: StageMetric = { stage, startedAt, finishedAt: new Date(), durationMs: Math.max(0, Math.round(performance.now() - start)), bytes, metadata: { outcome } };
    try { await record(metric); } catch { /* Metrics must not break deployments. */ }
  };
}

export async function measureStage<T>(stage: StageName, run: () => Promise<T>, record: StageRecorder, bytes: number | null = null, succeeded: (value: T) => boolean = () => true): Promise<T> {
  const finish = startStage(stage, record, bytes);
  let outcome: "ok" | "failed" = "failed";
  try { const value = await run(); outcome = succeeded(value) ? "ok" : "failed"; return value; }
  finally { await finish(outcome); }
}

export function deploymentRecorder(deploymentId: string): StageRecorder {
  return async metric => {
    const db = await getDb();
    await db.insert(deployStageMetrics).values({ id: randomUUID(), deploymentId, ...metric, metadata: JSON.stringify(metric.metadata) });
  };
}

export function queueDurationMs(createdAt: Date, startedAt: Date | null): number | null {
  if (!startedAt) return null;
  const elapsed = startedAt.getTime() - createdAt.getTime();
  return Number.isFinite(elapsed) && elapsed >= 0 ? elapsed : null;
}

type SummaryMetric = { stage: string; durationMs: number; bytes: number | null };
export function summarizePerformance(current: SummaryMetric[], previous: SummaryMetric[]) {
  const totals = (rows: SummaryMetric[]) => {
    const result = new Map<string, number>();
    for (const row of rows) result.set(row.stage, (result.get(row.stage) ?? 0) + row.durationMs);
    return result;
  };
  const now = totals(current), before = totals(previous);
  const comparison = [...now].filter(([stage]) => before.has(stage)).map(([stage, currentMs]) => ({ stage, currentMs, previousMs: before.get(stage)!, deltaMs: currentMs - before.get(stage)! }));
  const top = [...now].sort((a, b) => b[1] - a[1])[0];
  return { bottleneck: top ? { stage: top[0], durationMs: top[1], hint: `The ${top[0]} stage took the most measured time.` } : null, comparison, unavailable: ["peak memory", "peak CPU", "peak disk", "network throughput", "separate install and build durations", "separate clone and archive durations"] };
}
