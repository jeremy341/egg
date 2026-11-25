import { and, desc, eq, inArray, isNull, lt, sql } from "drizzle-orm";
import { audit } from "@/server/audit";
import { prunePageviews } from "@/server/analytics";
import { getDb, schema } from "@/server/db";
import { serverDiscriminator, unitName } from "@/server/deploy/layout";
import { serviceStatus } from "@/server/deploy/remote";
import { openAlert, pruneAlertEvents, resolveAlert } from "@/server/notify";
import { withServerSession } from "@/server/servers";
import { parseServiceStatus, type ServiceStatus } from "@/server/service-status";
import { probeSession } from "@/server/ssh/probe";
import { invalidateStatusPage } from "@/server/status-tags";
import { withMaintenanceLease } from "@/server/maintenance-leases";
import { purgeExpiredTrash } from "@/server/project-trash";
import { runPostDeployChecks } from "@/server/deploy-regression-job";
import { evaluateRules } from "@/server/alert-rules";
import { captureFailedUnit } from "@/server/crash-reports";

/**
 * Uptime checks and usage history, run by the worker on a timer.
 *
 * One SSH session per server covers every project on it. An outage is only
 * announced after a number of failed checks in a row (two unless the project
 * says otherwise), and the recovery is announced once, so a webhook channel is
 * not spammed by one slow answer. Resource warnings fire once when a value
 * reaches its limit and once more when it drops back below.
 */

export const FAILURES_BEFORE_DOWN = 2;
/** How long usage samples are kept. */
export const SAMPLE_KEEP_MS = 7 * 24 * 60 * 60 * 1000;
/** Bound parallel SSH probes so one slow container does not delay every other one. */
export const MONITOR_CONCURRENCY = 4;

/** Ignore malformed or excessive operator settings rather than flooding Nest. */
export function monitorConcurrency(raw?: string): number {
  if (!raw || !/^\d+$/.test(raw)) return MONITOR_CONCURRENCY;
  const n = Number(raw);
  return Number.isSafeInteger(n) && n >= 1 && n <= 16 ? n : MONITOR_CONCURRENCY;
}

/** Check every server once, isolating failures while bounding concurrent work. */
export async function monitorServers<T>(
  servers: readonly T[],
  check: (server: T) => Promise<void>,
  onError?: (err: unknown) => void,
  concurrency = monitorConcurrency(process.env.MONITOR_CONCURRENCY)
): Promise<void> {
  const limit = Number.isFinite(concurrency) ? Math.max(1, Math.floor(concurrency)) : 1;
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(servers.length, limit) }, async () => {
    while (next < servers.length) {
      const server = servers[next++];
      try {
        await check(server);
      } catch (err) {
        onError?.(err);
      }
    }
  }));
}

type MonitorState = "unknown" | "up" | "down";

/**
 * Share of one CPU core the service used between two samples, in percent.
 * Returns null when it cannot be worked out honestly: no earlier sample, a
 * gap too long to be meaningful, or the counter went backwards (a restart).
 */
export function cpuPercentBetween(
  prev: { at: Date; cpuNs: number | null } | undefined,
  cur: { at: Date; cpuNs: number | null },
  maxGapMs = 30 * 60_000
): number | null {
  if (!prev || prev.cpuNs === null || cur.cpuNs === null) return null;
  const elapsed = cur.at.getTime() - prev.at.getTime();
  if (elapsed <= 0 || elapsed > maxGapMs || cur.cpuNs < prev.cpuNs) return null;
  return Math.round(((cur.cpuNs - prev.cpuNs) / 1e6 / elapsed) * 1000) / 10;
}

/**
 * Running, and answering on its health path with anything below a server
 * error. With a response time limit, an answer slower than the limit counts
 * as a failed check too.
 */
export function isHealthy(s: ServiceStatus, slowMs: number | null = null): boolean {
  if (s.state !== "running") return false;
  if (s.http === null) return true; // no curl on the container: systemd's word is all we have
  if (!(s.http.code > 0 && s.http.code < 500)) return false;
  return !isSlow(s, slowMs);
}

/** Answered, but later than the limit. False when there is no limit or no timing. */
export function isSlow(s: ServiceStatus, slowMs: number | null): boolean {
  return slowMs !== null && s.http !== null && s.http.ms !== null && s.http.ms > slowMs;
}

// ------------------------------------------------------------ resource limits

export type ResourceKind = "disk" | "memory" | "cpu";

export type ResourceUsage = {
  cpuLoad: number | null;
  cpus: number | null;
  memUsedMb: number | null;
  memTotalMb: number | null;
  diskUsedMb: number | null;
  diskTotalMb: number | null;
};

export type ResourceLimits = { diskPct: number; memoryPct: number; cpuPct: number };

export type Reading = {
  kind: ResourceKind;
  /** Whole percent, rounded down so 89.9 never reads as 90. */
  percent: number;
  limit: number;
  over: boolean;
};

const share = (used: number | null, total: number | null) =>
  used !== null && total !== null && total > 0 ? (used / total) * 100 : null;

/**
 * Pure: how full each resource is, set against a project's limits. A figure
 * the probe could not read is left out, which says nothing either way.
 * CPU is the 1 minute load average as a share of the cores.
 */
export function readResources(u: ResourceUsage, limits: ResourceLimits): Reading[] {
  const raw: [ResourceKind, number | null, number][] = [
    ["disk", share(u.diskUsedMb, u.diskTotalMb), limits.diskPct],
    ["memory", share(u.memUsedMb, u.memTotalMb), limits.memoryPct],
    ["cpu", share(u.cpuLoad, u.cpus), limits.cpuPct],
  ];
  const out: Reading[] = [];
  for (const [kind, value, limit] of raw) {
    if (value === null || !Number.isFinite(value)) continue;
    out.push({ kind, percent: Math.floor(value), limit, over: value >= limit });
  }
  return out;
}

/**
 * Pure: what to do given the readings and which resources already have an
 * open alert. Fire once when a value reaches its limit, say so once when it
 * drops back below, and stay quiet in between.
 */
export function planResourceAlerts(
  readings: Reading[],
  open: ReadonlySet<ResourceKind>
): { fire: Reading[]; resolve: Reading[] } {
  return {
    fire: readings.filter((r) => r.over && !open.has(r.kind)),
    resolve: readings.filter((r) => !r.over && open.has(r.kind)),
  };
}

const RESOURCE_NAME: Record<ResourceKind, string> = {
  disk: "Disk",
  memory: "Memory",
  cpu: "CPU load",
};

export function resourceMessage(r: Reading, phase: "fire" | "resolve"): string {
  const name = RESOURCE_NAME[r.kind];
  return phase === "fire"
    ? `${name} on the server reached ${r.percent}% (your limit is ${r.limit}%).`
    : `${name} on the server is back below ${r.limit}% (now ${r.percent}%).`;
}

export type Transition = {
  state: MonitorState;
  failures: number;
  /** Set only when the state flipped and someone should be told. */
  change: "down" | "up" | null;
};

/** Pure: the next monitor state given the last one and this check's result. */
export function nextMonitorState(
  prev: { state: MonitorState; failures: number },
  healthy: boolean,
  failuresBeforeDown = FAILURES_BEFORE_DOWN
): Transition {
  if (healthy) {
    return { state: "up", failures: 0, change: prev.state === "down" ? "up" : null };
  }
  const failures = prev.failures + 1;
  if (failures >= failuresBeforeDown) {
    return { state: "down", failures, change: prev.state === "down" ? null : "down" };
  }
  return { state: prev.state, failures, change: null };
}

/**
 * One sentence about why a check failed. Web apps answer on a health path; a
 * worker is down when its process does not stay up, so the words match what
 * the workload actually does.
 */
function describe(s: ServiceStatus, slowMs: number | null = null, worker = false): string {
  if (s.state !== "running") {
    if (worker) {
      if (s.state === "failed") return "The process keeps failing to start, so systemd has paused it.";
      if (s.state === "starting") return "The process keeps restarting, which usually means it crashes right after it starts.";
      if (s.state === "stopped") return "The process is stopped.";
      if (s.state === "not_deployed") return "The worker's service is not on the container any more.";
      return "The process is not running.";
    }
    return `The service is ${s.state.replace("_", " ")}.`;
  }
  if (worker) return "The process did not pass its check.";
  if (s.http && s.http.code > 0 && s.http.code < 500 && isSlow(s, slowMs)) {
    return `The health path took ${s.http.ms} ms to answer, over your limit of ${slowMs} ms.`;
  }
  if (s.http && s.http.code === 0) return "The service is running but nothing answered on its health path.";
  if (s.http) return `The health path answered HTTP ${s.http.code}.`;
  return "The service did not pass its check.";
}

type ProjectRow = typeof schema.projects.$inferSelect;

/** Projects with a live production release and nothing being deployed right now. */
async function checkable(serverId: string): Promise<ProjectRow[]> {
  const db = await getDb();
  const projects = await db
    .select()
    .from(schema.projects)
    .where(and(eq(schema.projects.serverId, serverId),
      sql`exists (select 1 from deployments d where d.project_id = ${schema.projects.id} and d.env = 'production' and d.is_current = 1)`,
      sql`not exists (select 1 from deployments d where d.project_id = ${schema.projects.id} and d.state in ('queued', 'building', 'deploying'))`));
  return projects;
}

async function checkServer(server: typeof schema.servers.$inferSelect, now: Date, onError?: (err: unknown) => void) {
  const db = await getDb();
  const projects = await checkable(server.id);
  const currentReleases = projects.length
    ? await db.select({ projectId: schema.deployments.projectId, releaseId: schema.deployments.releaseId })
      .from(schema.deployments)
      .where(and(
        inArray(schema.deployments.projectId, projects.map((project) => project.id)),
        eq(schema.deployments.env, "production"),
        eq(schema.deployments.isCurrent, true),
      ))
    : [];
  const releaseByProject = new Map(currentReleases.map((release) => [release.projectId, release.releaseId]));

  const { probe, results } = await withServerSession(server, async (s) => {
    const probe = await probeSession(s);
    const results = new Map<string, ServiceStatus>();
    // Batch eight app probes per channel; run at most two batches per server.
    const batches: ProjectRow[][] = [];
    for (let i = 0; i < projects.length; i += 8) batches.push(projects.slice(i, i + 8));
    await monitorServers(batches, async (batch) => {
      const script = batch.map((p, i) => `printf '\\nEGG_STATUS_${i}\\n'\n` +
        serviceStatus({ unit: unitName(p.slug, undefined, serverDiscriminator(server.id)), port: p.workloadKind === "worker" ? null : p.port, path: p.healthPath })).join("\n");
      const r = await s.script(script, { timeoutMs: 20_000 * batch.length, maxOutputBytes: 64 * 1024 * batch.length });
      if (r.code !== 0) return;
      const parts = r.stdout.split(/\nEGG_STATUS_(\d+)\n/);
      for (let i = 1; i < parts.length; i += 2) {
        const p = batch[Number(parts[i])];
        if (p) results.set(p.id, parseServiceStatus(parts[i + 1], now));
      }
    }, onError, 2);
    for (const p of projects) {
      const status = results.get(p.id);
      const releaseId = releaseByProject.get(p.id);
      if (status?.state !== "failed" || !releaseId) continue;
      try {
        await captureFailedUnit({
          projectId: p.id,
          releaseId,
          unit: unitName(p.slug, undefined, serverDiscriminator(server.id)),
          status,
          session: s,
          at: now,
        });
      } catch (err) {
        // A journal read must not prevent the health sample or alert from being saved.
        onError?.(err);
      }
    }
    return { probe, results };
  });

  await db.insert(schema.usageSamples).values({
    serverId: server.id,
    at: now,
    cpuLoad: probe.load1,
    cpus: probe.cpus,
    memUsedMb: probe.memUsedMb,
    memTotalMb: probe.memTotalMb,
    diskUsedMb: probe.diskUsedMb,
    diskTotalMb: probe.diskTotalMb,
  });

  const usage: ResourceUsage = {
    cpuLoad: probe.load1,
    cpus: probe.cpus,
    memUsedMb: probe.memUsedMb,
    memTotalMb: probe.memTotalMb,
    diskUsedMb: probe.diskUsedMb,
    diskTotalMb: probe.diskTotalMb,
  };

  for (const p of projects) {
    await checkResources(p, usage, now);
    const status = results.get(p.id);
    if (!status) {
      // Could not read it: that says nothing about the app, so its rules see no value.
      await evaluateRules(p.id, { cpuPercent: null, memMb: null, healthMs: null }, now);
      continue;
    }
    // Every check is kept, failed ones too, so the error rate and restart count see crashes.
    // A service that is not running still gets a row when its last exit was a crash, so the crash is kept.
    const prev = await db
      .select({ at: schema.projectSamples.at, cpuNs: schema.projectSamples.cpuNs })
      .from(schema.projectSamples)
      .where(eq(schema.projectSamples.projectId, p.id))
      .orderBy(desc(schema.projectSamples.at))
      .limit(1)
      .get();
    const reading = {
      cpuPercent: cpuPercentBetween(prev, { at: now, cpuNs: status.cpuNs }),
      memMb: status.state === "running" ? status.memoryMb : null,
      healthMs: status.http?.ms ?? null,
    };
    await db.insert(schema.projectSamples).values({
      projectId: p.id,
      at: now,
      memMb: reading.memMb,
      cpuNs: status.cpuNs,
      cpuPercent: reading.cpuPercent,
      restarts: status.restarts,
      exitCode: status.lastExit?.code ?? null,
      exitReason: status.lastExit?.reason ?? null,
      healthMs: reading.healthMs,
      healthOk: isHealthy(status, null),
    });
    await evaluateRules(p.id, reading, now);
    if (status.result !== p.lastExitResult) {
      await db.update(schema.projects).set({ lastExitResult: status.result }).where(eq(schema.projects.id, p.id));
    }
    const next = nextMonitorState(
      { state: p.monitorState, failures: p.monitorFailures },
      isHealthy(status, p.alertSlowMs),
      p.alertFailures
    );
    await db
      .update(schema.projects)
      .set({
        monitorState: next.state,
        monitorFailures: next.failures,
        ...(next.change ? { monitorSince: now } : {}),
      })
      .where(eq(schema.projects.id, p.id));
    // The public status page keeps its data for 60 seconds; a change of state should not wait.
    if (next.change || next.state !== p.monitorState) await invalidateStatusPage(p.statusKey);
    if (next.change) {
      const worker = p.workloadKind === "worker";
      const detail =
        next.change === "down" ? describe(status, p.alertSlowMs, worker) : worker ? "The worker is running again." : "It is answering again.";
      await audit(p.userId, next.change === "down" ? "monitor.down" : "monitor.up", p.id, { detail });
      if (next.change === "down") await openAlert(p, "down", detail, now);
      else await resolveAlert(p, "down", detail, now);
    }
  }
}

/** Compare the server's usage with one project's limits and fire or clear alerts. */
async function checkResources(p: ProjectRow, usage: ResourceUsage, now: Date) {
  const db = await getDb();
  const readings = readResources(usage, {
    diskPct: p.alertDiskPct,
    memoryPct: p.alertMemPct,
    cpuPct: p.alertCpuPct,
  });
  const openRows = await db
    .select({ type: schema.alertEvents.type })
    .from(schema.alertEvents)
    .where(
      and(
        eq(schema.alertEvents.projectId, p.id),
        inArray(schema.alertEvents.type, ["disk", "memory", "cpu"]),
        isNull(schema.alertEvents.resolvedAt)
      )
    );
  const open = new Set(openRows.map((r) => r.type as ResourceKind));
  const plan = planResourceAlerts(readings, open);
  for (const r of plan.fire) await openAlert(p, r.kind, resourceMessage(r, "fire"), now);
  for (const r of plan.resolve) await resolveAlert(p, r.kind, resourceMessage(r, "resolve"), now);
}

/** Check every connected server once. A server that cannot be reached is skipped. */
export async function runMonitorPass(onError?: (err: unknown) => void, now?: Date) {
  await withMaintenanceLease("monitor", () => runOwnedMonitorPass(onError, now));
}

async function runOwnedMonitorPass(onError?: (err: unknown) => void, now?: Date) {
  const db = await getDb();
  const servers = await db
    .select()
    .from(schema.servers)
    .where(eq(schema.servers.status, "connected"));
  // Capture each server's check time as it starts, rather than assigning the
  // beginning of a long monitoring pass to every later sample.
  await monitorServers(servers, (server) => checkServer(server, now ?? new Date(), onError), onError);
  const passFinishedAt = now ?? new Date();
  const cutoff = new Date(passFinishedAt.getTime() - SAMPLE_KEEP_MS);
  await db.delete(schema.usageSamples).where(lt(schema.usageSamples.at, cutoff));
  await db.delete(schema.projectSamples).where(lt(schema.projectSamples.at, cutoff));
  await prunePageviews(passFinishedAt);
  await pruneAlertEvents(passFinishedAt);
  // The cleanup job: trashed apps past their 30 days are removed for good.
  await runPostDeployChecks(passFinishedAt);
  await purgeExpiredTrash(passFinishedAt);
  const { reconcileClosedPreviews } = await import("@/server/github/pulls");
  await reconcileClosedPreviews();
}
