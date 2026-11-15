import { beforeEach, describe, expect, it, vi } from "vitest";
const saved = vi.hoisted(() => [] as { message: string }[]);
vi.mock("@/server/db", () => ({ getDb: async () => ({ insert: () => ({ values: async (rows: { message: string }[]) => { saved.push(...rows); } }) }), schema: { deploymentLogs: {} } }));
import { DeploymentLogger } from "./logger";

describe("deployment log byte budget", () => {
  beforeEach(() => { saved.length = 0; });
  it("stops storing lines when the configured byte budget is exhausted", async () => {
    const logger = new DeploymentLogger("d", 10000, 256);
    for (let i = 0; i < 100; i++) logger.info("é".repeat(32));
    await logger.flush();
    expect(saved.reduce((n, row) => n + Buffer.byteLength(row.message), 0)).toBeLessThanOrEqual(256);
    expect(saved.some(row => row.message.includes("limit"))).toBe(true);
  });
});
