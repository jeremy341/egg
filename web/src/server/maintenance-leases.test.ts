import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { useFreshDb } from "@/server/test/db";
import { withMaintenanceLease } from "@/server/maintenance-leases";

let ctx: Awaited<ReturnType<typeof useFreshDb>>;
beforeAll(async () => { ctx = await useFreshDb(); });
afterAll(async () => ctx.cleanup());
it("runs one maintenance task at a time and releases the lease after failure", async () => {
  let release!: () => void;
  let started!: () => void;
  const entered = new Promise<void>((r) => { started = r; });
  const gate = new Promise<void>((r) => { release = r; });
  const first = withMaintenanceLease("test", async () => { started(); await gate; return 42; });
  await entered;
  expect(await withMaintenanceLease("test", async () => 99)).toBeNull();
  release();
  expect(await first).toBe(42);
  await expect(withMaintenanceLease("test", async () => { throw new Error("failed"); })).rejects.toThrow("failed");
  expect(await withMaintenanceLease("test", async () => 7)).toBe(7);
});
it("keeps a completed scheduled run from repeating in another process during its interval", async () => {
  expect(await withMaintenanceLease("scheduled", async () => 1, 60_000, 60_000)).toBe(1);
  expect(await withMaintenanceLease("scheduled", async () => 2, 60_000, 60_000)).toBeNull();
});
it("makes the next scheduled run eligible one interval after start, not completion", async () => {
  vi.useFakeTimers();
  try {
    vi.setSystemTime(new Date("2026-11-13T00:00:00Z"));
    await withMaintenanceLease("cadence", async () => { await vi.advanceTimersByTimeAsync(10_000); }, 60_000, 60_000);
    await vi.advanceTimersByTimeAsync(50_000);
    expect(await withMaintenanceLease("cadence", async () => "next", 60_000, 60_000)).toBe("next");
  } finally { vi.useRealTimers(); }
});
