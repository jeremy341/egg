// Standalone worker: `pnpm worker`. Runs queued deployments until stopped.
// The web app can also run a worker in-process (RUN_WORKER=1), so this file
// exists for running deployments on a different machine than the website.
import { startWorker } from "../src/server/jobs";

const worker = startWorker({
  concurrency: Number(process.env.WORKER_CONCURRENCY ?? 2),
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
