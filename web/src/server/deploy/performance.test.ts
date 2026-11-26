import { expect, it } from "vitest";
import { measureStage, summarizePerformance } from "./performance";

it("records failed stages without retaining error text or blocking the failure", async () => {
  const rows: unknown[] = [];
  await expect(measureStage("source", async () => { throw new Error("secret"); }, async row => { rows.push(row); })).rejects.toThrow("secret");
  expect(rows).toHaveLength(1);
  expect(JSON.stringify(rows)).not.toContain("secret");
  expect(rows[0]).toMatchObject({ stage: "source", metadata: { outcome: "failed" } });
});

it("summarizes only observed stages and exposes missing resource metrics", () => {
  const report = summarizePerformance([
    { stage: "source", durationMs: 200, bytes: 100 },
    { stage: "build", durationMs: 400, bytes: null },
  ], [{ stage: "source", durationMs: 100, bytes: 50 }]);
  expect(report.bottleneck?.stage).toBe("build");
  expect(report.comparison).toContainEqual({ stage: "source", currentMs: 200, previousMs: 100, deltaMs: 100 });
  expect(report.unavailable).toContain("peak memory");
});

it("marks a completed but unhealthy check as failed", async () => {
  const rows: { metadata: { outcome: string } }[] = [];
  expect(await measureStage("health", async () => false, async row => { rows.push(row); }, null, Boolean)).toBe(false);
  expect(rows[0].metadata.outcome).toBe("failed");
});

it("computes queue time only when start time exists", async () => {
  const { queueDurationMs } = await import("./performance");
  expect(queueDurationMs(new Date(1000), new Date(3000))).toBe(2000);
  expect(queueDurationMs(new Date(1000), null)).toBeNull();
});

it("records a started stage at most once", async () => {
  const { startStage } = await import("./performance");
  const rows: unknown[] = [];
  const finish = startStage("lock_wait", async row => { rows.push(row); });
  await finish("ok");
  await finish("failed");
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ stage: "lock_wait", metadata: { outcome: "ok" } });
});
