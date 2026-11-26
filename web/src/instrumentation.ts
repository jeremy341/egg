/**
 * Runs once when the Next.js server starts. With RUN_WORKER=1 the website
 * also works through the deployment queue, so one process is enough to host
 * everything. Set RUN_WORKER=0 and use `pnpm worker` to run builds elsewhere.
 */
/** An empty or non-numeric WORKER_CONCURRENCY would otherwise be 0 or NaN and silently disable the worker. */
function workerConcurrency(): number {
  const raw = process.env.WORKER_CONCURRENCY;
  if (raw === undefined || raw.trim() === "") return 2;
  const parsed = Number(raw);
  if (Number.isInteger(parsed) && parsed >= 1) return parsed;
  console.warn("invalid WORKER_CONCURRENCY, using 2:", raw);
  return 2;
}

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const cleanupState = globalThis as unknown as { __eggCleanupWorker?: unknown };
  if (!cleanupState.__eggCleanupWorker) {
    const { startCleanupWorker } = await import("@/server/cleanup");
    cleanupState.__eggCleanupWorker = startCleanupWorker({ onError: (err) => console.error("cleanup worker failed", err) });
  }

  // Retention is an application data policy, not a deployment-worker feature.
  // Keep it active when builds run in a separate process or uptime checks are off.
  const prunerState = globalThis as unknown as { __eggAnalyticsPruner?: ReturnType<typeof setInterval> };
  if (!prunerState.__eggAnalyticsPruner) {
    const prune = async () => {
      const { withMaintenanceLease } = await import("@/server/maintenance-leases");
      await withMaintenanceLease("analytics-and-source-retention", async () => {
      try {
        const { prunePageviews } = await import("@/server/analytics");
        await prunePageviews();
      } catch (err) {
        console.error("analytics retention cleanup failed", err);
      }
      try {
        // The privacy notice says a report's source digest is kept for one day at most.
        const { pruneReportSources } = await import("@/server/security-reports");
        await pruneReportSources();
      } catch (err) {
        console.error("report source cleanup failed", err);
      }
      }, 60_000, 15 * 60_000);
      try {
        const { pruneAuditLog } = await import("@/server/audit-retention");
        await pruneAuditLog();
      } catch (err) {
        console.error("audit log cleanup failed", err);
      }
      const { pruneDeploymentLogs } = await import("@/server/retention");
      await pruneDeploymentLogs();
    };
    void prune().catch((err) => console.error("retention maintenance failed", err));
    prunerState.__eggAnalyticsPruner = setInterval(() => void prune().catch((err) => console.error("retention maintenance failed", err)), 15 * 60_000);
    prunerState.__eggAnalyticsPruner.unref?.();
  }
  if (process.env.RUN_WORKER !== "1") return;

  const g = globalThis as unknown as { __eggWorker?: unknown };
  if (g.__eggWorker) return;

  const { startWorker } = await import("@/server/jobs");
  g.__eggWorker = startWorker({
    concurrency: workerConcurrency(),
    onError: (err) => console.error("worker error", err),
  });
}
