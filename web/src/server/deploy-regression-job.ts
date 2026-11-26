import { and, asc, eq, gte, isNull, lte } from "drizzle-orm";
import { getDb, schema } from "@/server/db";
import {
  compareWindows,
  REGRESSION_WINDOW_MS,
  splitAroundReady,
  windowStats,
  type CheckSample,
} from "@/server/deploy-regression";
import { notifyDeployRegressed } from "@/server/notify";
import { dispatchDeploymentEvent } from "@/server/webhooks";

/** Only deploys that became ready this recently are checked. Older ones were never due, so they stay unchecked. */
const LOOKBACK_MS = 60 * 60_000;

/**
 * Run the before/after comparison for production deploys that became ready at
 * least 15 minutes ago and have not been compared yet. Called from the monitor
 * pass, so it uses the same once-a-minute health checks. Returns how many were checked.
 */
export async function runPostDeployChecks(now = new Date()): Promise<number> {
  const db = await getDb();
  const due = await db
    .select()
    .from(schema.deployments)
    .where(
      and(
        eq(schema.deployments.state, "ready"),
        eq(schema.deployments.env, "production"),
        isNull(schema.deployments.postDeployCheck),
        lte(schema.deployments.finishedAt, new Date(now.getTime() - REGRESSION_WINDOW_MS)),
        gte(schema.deployments.finishedAt, new Date(now.getTime() - LOOKBACK_MS))
      )
    )
    .limit(50);

  for (const dep of due) {
    if (!dep.finishedAt) continue;
    const readyAt = dep.finishedAt;
    const rows = await db
      .select({
        at: schema.projectSamples.at,
        healthMs: schema.projectSamples.healthMs,
        healthOk: schema.projectSamples.healthOk,
        restarts: schema.projectSamples.restarts,
      })
      .from(schema.projectSamples)
      .where(
        and(
          eq(schema.projectSamples.projectId, dep.projectId),
          gte(schema.projectSamples.at, new Date(readyAt.getTime() - REGRESSION_WINDOW_MS)),
          lte(schema.projectSamples.at, new Date(readyAt.getTime() + REGRESSION_WINDOW_MS))
        )
      )
      .orderBy(asc(schema.projectSamples.at));

    const { before, after } = splitAroundReady(rows as CheckSample[], readyAt);
    const result = compareWindows(windowStats(before), windowStats(after));
    const stored = { ...result, readyAt: readyAt.toISOString(), checkedAt: now.toISOString() };
    await db
      .update(schema.deployments)
      .set({ postDeployCheck: JSON.stringify(stored), postDeployCheckedAt: now })
      .where(eq(schema.deployments.id, dep.id));

    if (result.verdict === "regressed") {
      // Both paths never throw, so one broken channel cannot stop the other or the pass.
      await dispatchDeploymentEvent(dep.id, { state: "ready", event: "deploy.regressed" });
      await notifyDeployRegressed(dep.id, result.reasons);
    }
  }
  return due.length;
}
