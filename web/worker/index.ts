// Standalone worker: `pnpm worker`. Runs queued deployments until stopped.
// The web app can also run a worker in-process (RUN_WORKER=1), so this file
// exists for running deployments on a different machine than the website.
import { startWorker } from "../src/server/jobs";

/** An empty or non-numeric value would otherwise silently disable the worker. */
function concurrency(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === "") return 2;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed >= 1 ? parsed : 2;
}

/** How long to wait for in-flight jobs before forcing an exit. 0 means exit at once. */
const DEFAULT_SHUTDOWN_GRACE_MS = 30_000;
function shutdownGraceMs(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === "") return DEFAULT_SHUTDOWN_GRACE_MS;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_SHUTDOWN_GRACE_MS;
}

const worker = startWorker({
  concurrency: concurrency(process.env.WORKER_CONCURRENCY),
  onError: (err) => console.error("worker error", err),
});
console.log(`Worker ${worker.workerId} started`);

const shutdown = async (signal: string) => {
  const graceMs = shutdownGraceMs(process.env.WORKER_SHUTDOWN_GRACE_MS);
  console.log(`${signal} received, finishing running jobs (up to ${graceMs}ms)...`);

  // Waiting indefinitely for a hung SSH call would keep SIGTERM pending until the
  // orchestrator sends SIGKILL, stranding a running job with a lease that is still
  // being renewed. Race the drain against a deadline and always exit.
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<"deadline">((resolve) => {
    timer = setTimeout(() => resolve("deadline"), graceMs);
  });
  const result = await Promise.race([
    worker.stop().then(() => "stopped" as const),
    deadline,
  ]);
  if (timer) clearTimeout(timer);

  if (result === "deadline") {
    const ids = worker.unfinishedJobIds();
    console.error(
      `Shutdown deadline (${graceMs}ms) reached with ${ids.length} unfinished job(s)${ids.length ? `: ${ids.join(", ")}` : ""}. Aborting them so their leases stop being renewed.`
    );
    worker.abort();
  }
  process.exit(0);
};
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
