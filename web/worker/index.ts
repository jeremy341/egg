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

const worker = startWorker({
  concurrency: concurrency(process.env.WORKER_CONCURRENCY),
  onError: (err) => console.error("worker error", err),
});
console.log(`Worker ${worker.workerId} started`);

const shutdown = async (signal: string) => {
  console.log(`${signal} received, finishing running jobs...`);
  await worker.stop();
  process.exit(0);
};
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
