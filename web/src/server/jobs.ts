import { randomUUID } from "node:crypto";
import { and, eq, lt, sql } from "drizzle-orm";
import { getDb, schema } from "@/server/db";
import { isUniqueViolation } from "@/server/db/errors";
import { runMonitorPass } from "@/server/monitor";
import { runStatusProbes } from "@/server/nest-status";
import { withMaintenanceLease } from "@/server/maintenance-leases";
import {
  defaultDeps,
  runDeployJob,
  runRollbackJob,
  type PipelineDeps,
} from "@/server/deploy/pipeline";

export type Job = typeof schema.jobs.$inferSelect;

/** How often workers renew their lease, and how long a missed lease is tolerated. */
const LEASE_RENEW_MS = 15_000;
const STALE_AFTER_MS = 60_000;

/**
 * Atomically claim the oldest queued job whose project has no running job.
 * The eligibility check and state change happen in one UPDATE, so two workers
 * cannot claim separate jobs for the same project. The claim also stamps the
 * job with its project, so `jobs_running_project_idx` is a second guard: if
 * it ever refuses the claim, another worker already holds that project, and
 * the job is simply left queued (this returns null) for a later tick.
 */
export async function claimNextJob(workerId: string): Promise<Job | null> {
  const db = await getDb();
  const now = new Date();
  const claimed = await db
    .update(schema.jobs)
    .set({
      state: "running",
      lockedBy: workerId,
      lockedAt: now,
      projectId: sql`(SELECT claimed_deployment.project_id FROM deployments AS claimed_deployment WHERE claimed_deployment.id = ${schema.jobs.deploymentId})`,
      attempts: sql`${schema.jobs.attempts} + 1`,
    })
    .where(
      and(
        eq(schema.jobs.state, "queued"),
        sql`${schema.jobs.id} = (
          SELECT candidate.id
          FROM jobs AS candidate
          JOIN deployments AS candidate_deployment
            ON candidate_deployment.id = candidate.deployment_id
          WHERE candidate.state = 'queued'
            AND NOT EXISTS (
              SELECT 1 FROM instance_settings AS maintenance
              JOIN projects AS maintenance_project ON maintenance_project.id = candidate_deployment.project_id
              WHERE maintenance.id = 'maintenance' AND maintenance.enabled = 1
                AND (maintenance.starts_at IS NULL OR maintenance.starts_at <= ${now.getTime()})
                AND (maintenance.ends_at IS NULL OR maintenance.ends_at > ${now.getTime()})
                AND maintenance_project.user_id <> ${process.env.SECURITY_REPORT_ADMIN_ID?.trim() || ""}
            )
            AND NOT EXISTS (
              SELECT 1 FROM cleanup_jobs AS cleanup
              JOIN projects AS cleanup_project ON cleanup_project.id = candidate_deployment.project_id
              WHERE cleanup.user_id = cleanup_project.user_id
                AND cleanup.state IN ('draining', 'running', 'failed')
                AND (cleanup.scope = 'account' OR cleanup.project_id = candidate_deployment.project_id)
            )
            AND NOT EXISTS (
              SELECT 1
              FROM jobs AS running_job
              JOIN deployments AS running_deployment
                ON running_deployment.id = running_job.deployment_id
              WHERE running_job.state = 'running'
                AND running_deployment.project_id = candidate_deployment.project_id
            )
          ORDER BY candidate.created_at, candidate.id
          LIMIT 1
        )`
      )
    )
    .returning()
    .catch((err: unknown) => {
      if (isUniqueViolation(err)) return [];
      throw err;
    });
  return claimed[0] ?? null;
}

/** Count expired leases. Do not free them: an SSH child may outlive its worker channel. */
export async function recoverStaleJobs(now = new Date()): Promise<number> {
  const db = await getDb();
  const cutoff = new Date(now.getTime() - STALE_AFTER_MS);
  const stale = await db
    .select()
    .from(schema.jobs)
    .where(and(eq(schema.jobs.state, "running"), lt(schema.jobs.lockedAt, cutoff)));

  return stale.length;
}

/** Count jobs owned by a previously started instance without freeing their guard. */
export async function countOrphanedJobs(workerId: string): Promise<number> {
  const db = await getDb();
  const orphans = await db
    .select()
    .from(schema.jobs)
    .where(and(eq(schema.jobs.state, "running"), eq(schema.jobs.lockedBy, workerId)));
  return orphans.length;
}

/** Run one claimed job to completion, honouring cancellation. */
export async function processJob(job: Job, deps: PipelineDeps = defaultDeps()) {
  const db = await getDb();
  const abort = new AbortController();
  const lockOwner = job.lockedBy;
  if (lockOwner === null) return;

  // Keep cancellation responsive while renewing ownership less often. Stale
  // rows are intentionally left blocking until an operator confirms no remote
  // command can still mutate the project.
  let checking = false;
  let renewedAt = Date.now();
  const watcher = setInterval(async () => {
    if (checking) return;
    checking = true;
    try {
      const owned = await db
        .select({ id: schema.jobs.id })
        .from(schema.jobs)
        .where(and(eq(schema.jobs.id, job.id), eq(schema.jobs.state, "running"), eq(schema.jobs.lockedBy, lockOwner)))
        .get();
      if (!owned) {
        abort.abort();
        return;
      }
      if (Date.now() - renewedAt >= LEASE_RENEW_MS) {
        const renewed = await db
          .update(schema.jobs)
          .set({ lockedAt: new Date() })
          .where(and(eq(schema.jobs.id, job.id), eq(schema.jobs.state, "running"), eq(schema.jobs.lockedBy, lockOwner)))
          .returning({ id: schema.jobs.id });
        if (renewed.length === 0) {
          abort.abort();
          return;
        }
        renewedAt = Date.now();
      }
      const d = await db
        .select({ state: schema.deployments.state })
        .from(schema.deployments)
        .where(eq(schema.deployments.id, job.deploymentId))
        .get();
      if (d?.state === "canceled") abort.abort();
    } catch {
      /* the next tick retries */
    } finally {
      checking = false;
    }
  }, 2000);

  try {
    if (job.type === "rollback") await runRollbackJob(job.deploymentId, deps, abort.signal);
    else await runDeployJob(job.deploymentId, deps, abort.signal);
    await db.update(schema.jobs).set({ state: "done" }).where(and(eq(schema.jobs.id, job.id), eq(schema.jobs.state, "running"), eq(schema.jobs.lockedBy, lockOwner)));
  } catch (err) {
    await db
      .update(schema.jobs)
      .set({ state: "failed", error: String((err as Error)?.message ?? err).slice(0, 500) })
      .where(and(eq(schema.jobs.id, job.id), eq(schema.jobs.state, "running"), eq(schema.jobs.lockedBy, lockOwner)));
  } finally {
    clearInterval(watcher);
  }
}

export type WorkerHandle = { stop: () => Promise<void>; workerId: string };

/** Poll for jobs until stopped. Used by `pnpm worker` and the embedded worker. */
export function startWorker(options: {
  concurrency?: number;
  pollMs?: number;
  /** How often to check uptime and sample usage. 0 turns the monitor off. */
  monitorMs?: number;
  /** How often to check that Nest and Egg answer, for the public Nest status page. 0 turns it off. */
  statusMs?: number;
  deps?: PipelineDeps;
  workerId?: string;
  onError?: (err: unknown) => void;
  /** Injectable worker operations for deterministic lifecycle tests. */
  workerOps?: {
    claimNextJob?: typeof claimNextJob;
    processJob?: typeof processJob;
  };
} = {}): WorkerHandle {
  const workerId = options.workerId ?? `worker-${randomUUID().slice(0, 8)}`;
  const concurrency = options.concurrency ?? 2;
  const pollMs = options.pollMs ?? 1000;
  let running = 0;
  let stopped = false;
  const inFlight = new Set<Promise<void>>();
  let activeTick: Promise<void> | null = null;
  let staleReported = false;

  const reportStale = async () => {
    const staleCount = await recoverStaleJobs();
    if (staleCount > 0 && !staleReported) {
      staleReported = true;
      console.warn(
        `${staleCount} deployment job lease(s) expired. They remain blocked until an operator confirms that remote work stopped; see docs/selfhost/README.md, "Recovering a stale deployment".`
      );
    } else if (staleCount === 0) {
      staleReported = false;
    }
  };

  const tick = () => {
    if (stopped || activeTick) return activeTick ?? Promise.resolve();
    const runTick = async () => {
      try {
        while (running < concurrency && !stopped) {
          const job = await (options.workerOps?.claimNextJob ?? claimNextJob)(workerId);
          if (!job) break;
          // A claim made before stop owns a running queue row, so start and track it
          // even if stop was requested while the database claim was in progress.
          running++;
          const p = (options.workerOps?.processJob ?? processJob)(job, options.deps).finally(() => {
            running--;
            inFlight.delete(p);
          });
          inFlight.add(p);
        }
      } catch (err) {
        options.onError?.(err);
      }
    };
    activeTick = runTick().finally(() => {
      activeTick = null;
    });
    return activeTick;
  };

  void (async () => {
    try {
      await countOrphanedJobs(workerId);
      await reportStale();
    } catch (err) {
      options.onError?.(err);
    }
  })();

  const interval = setInterval(() => void tick(), pollMs);
  void tick();
  const staleTimer = setInterval(() => void reportStale().catch(options.onError), 5 * 60_000);

  const monitorMs = options.monitorMs ?? Number(process.env.MONITOR_INTERVAL_MS ?? 5 * 60_000);
  let monitoring = false;
  const monitorTimer =
    monitorMs > 0
      ? setInterval(() => {
          if (monitoring || stopped) return;
          monitoring = true;
          void withMaintenanceLease("monitor-schedule", () => runMonitorPass(options.onError), 60_000, monitorMs)
            .catch(options.onError)
            .finally(() => {
              monitoring = false;
            });
        }, monitorMs)
      : null;

  const statusMs = options.statusMs ?? Number(process.env.STATUS_PROBE_INTERVAL_MS ?? 60_000);
  let probing = false;
  const statusTimer =
    statusMs > 0
      ? setInterval(() => {
          if (probing || stopped) return;
          probing = true;
          void withMaintenanceLease("status-probe-schedule", () => runStatusProbes(), 60_000, statusMs)
            .catch(options.onError)
            .finally(() => {
              probing = false;
            });
        }, statusMs)
      : null;

  return {
    workerId,
    stop: async () => {
      stopped = true;
      clearInterval(interval);
      clearInterval(staleTimer);
      if (monitorTimer) clearInterval(monitorTimer);
      if (statusTimer) clearInterval(statusTimer);
      await activeTick;
      await Promise.allSettled([...inFlight]);
    },
  };
}
