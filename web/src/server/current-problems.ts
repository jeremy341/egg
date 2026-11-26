import { and, desc, eq, gte, inArray, isNull } from "drizzle-orm";
import { getDb, schema } from "@/server/db";
import { restartsWithin, type CheckSample } from "@/server/deploy-regression";
import { assertOwned } from "@/server/projects";

/**
 * What is wrong with an app right now, worked out from state the monitor already
 * keeps. The computation is pure; `currentProblems` only gathers the inputs.
 */

export const CRASH_RESTARTS = 3;
export const CRASH_WINDOW_MS = 15 * 60_000;

export type ProblemKind = "oom_killed" | "crash_loop" | "failed_build" | "firing_alert" | "not_running";

export type Problem = {
  kind: ProblemKind;
  title: string;
  detail: string;
};

export type ProblemInput = {
  /** systemd's result for the service's last exit, such as "oom-kill". */
  lastExitResult: string | null;
  /** Restarts counted inside the recent window. */
  recentRestarts: number;
  /** The newest production deployment, or null when there has never been one. */
  latestProduction: { state: string; error: string | null } | null;
  /** Open alert types: down, cpu, memory, disk. */
  openAlertTypes: string[];
  /** Threshold rules currently firing. */
  firingRules: number;
  /** A production release is current on the server. */
  productionLive: boolean;
  /** The most recent health check failed. Null when no check has been recorded. */
  lastCheckFailed: boolean | null;
};

/**
 * Pure: the problems to show, most serious first. Nothing here is a guess:
 * each entry is backed by one of the inputs.
 */
export function computeProblems(input: ProblemInput): Problem[] {
  const out: Problem[] = [];

  if (input.lastExitResult === "oom-kill") {
    out.push({
      kind: "oom_killed",
      title: "Killed for running out of memory",
      detail: "The system stopped the app for using too much memory. Give it more memory or use less.",
    });
  }

  if (input.recentRestarts >= CRASH_RESTARTS) {
    out.push({
      kind: "crash_loop",
      title: "Crash loop",
      detail: `The app restarted ${input.recentRestarts} times in the last 15 minutes. It is likely crashing right after it starts.`,
    });
  }

  if (input.latestProduction?.state === "error") {
    const why = input.latestProduction.error?.trim();
    out.push({
      kind: "failed_build",
      title: "The last production deploy failed",
      detail: why ? why.slice(0, 200) : "The newest deploy to production did not finish. Open it for the log.",
    });
  }

  const alertTypes = input.openAlertTypes.filter((t, i, all) => all.indexOf(t) === i);
  if (alertTypes.length > 0 || input.firingRules > 0) {
    const parts: string[] = [];
    if (alertTypes.length > 0) parts.push(alertTypes.map(alertLabel).join(", "));
    if (input.firingRules > 0) parts.push(`${input.firingRules} threshold ${input.firingRules === 1 ? "rule" : "rules"}`);
    out.push({
      kind: "firing_alert",
      title: "Alert firing",
      detail: `Open: ${parts.join("; ")}.`,
    });
  }

  if (input.productionLive && input.lastCheckFailed === true) {
    out.push({
      kind: "not_running",
      title: "The live release is not running",
      detail: "The last health check found no running service for the current release.",
    });
  }

  return out;
}

const ALERT_LABEL: Record<string, string> = {
  down: "app down",
  cpu: "CPU",
  memory: "memory",
  disk: "disk",
};

function alertLabel(type: string): string {
  return ALERT_LABEL[type] ?? type;
}

/** Gathers the inputs for one app from the database and computes its problems. */
export async function currentProblems(userId: string, projectId: string, now = new Date()): Promise<Problem[]> {
  const project = await assertOwned(userId, projectId);
  const db = await getDb();

  const latest = await db
    .select({ state: schema.deployments.state, error: schema.deployments.error })
    .from(schema.deployments)
    .where(and(eq(schema.deployments.projectId, projectId), eq(schema.deployments.env, "production")))
    .orderBy(desc(schema.deployments.createdAt), desc(schema.deployments.id))
    .limit(1)
    .get();

  const recent = await db
    .select({ at: schema.projectSamples.at, restarts: schema.projectSamples.restarts, healthOk: schema.projectSamples.healthOk })
    .from(schema.projectSamples)
    .where(and(eq(schema.projectSamples.projectId, projectId), gte(schema.projectSamples.at, new Date(now.getTime() - CRASH_WINDOW_MS))))
    .orderBy(schema.projectSamples.at);

  const openAlerts = await db
    .select({ type: schema.alertEvents.type })
    .from(schema.alertEvents)
    .where(
      and(
        eq(schema.alertEvents.projectId, projectId),
        isNull(schema.alertEvents.resolvedAt),
        inArray(schema.alertEvents.type, ["down", "cpu", "memory", "disk"])
      )
    );

  const firing = await db
    .select({ id: schema.alertRules.id })
    .from(schema.alertRules)
    .where(and(eq(schema.alertRules.projectId, projectId), eq(schema.alertRules.paused, false), eq(schema.alertRules.status, "firing")));

  const lastCheck = recent.at(-1);
  const checks: CheckSample[] = recent.map((r) => ({ at: r.at, healthMs: null, healthOk: r.healthOk, restarts: r.restarts }));

  return computeProblems({
    lastExitResult: project.lastExitResult,
    recentRestarts: restartsWithin(checks),
    latestProduction: latest ?? null,
    openAlertTypes: openAlerts.map((a) => a.type),
    firingRules: firing.length,
    productionLive: await hasLiveProduction(projectId),
    lastCheckFailed: lastCheck ? lastCheck.healthOk === false : null,
  });
}

async function hasLiveProduction(projectId: string): Promise<boolean> {
  const db = await getDb();
  const row = await db
    .select({ id: schema.deployments.id })
    .from(schema.deployments)
    .where(
      and(
        eq(schema.deployments.projectId, projectId),
        eq(schema.deployments.env, "production"),
        eq(schema.deployments.isCurrent, true)
      )
    )
    .get();
  return Boolean(row);
}
