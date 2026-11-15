import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { schema } from "@/server/db";
import { useFreshDb } from "@/server/test/db";
import { rateLimiter } from "@/server/rate-limit";
import {
  capacityOf,
  createSecurityReport,
  pruneReportSources,
  REPORT_CAPACITY,
  REPORT_DAILY_LIMIT,
  REPORT_HEADROOM_HOURLY_LIMIT,
  REPORT_HOURLY_LIMIT,
  securityReportCapacity,
} from "@/server/security-reports";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

let ctx: Awaited<ReturnType<typeof useFreshDb>>;
beforeAll(async () => {
  ctx = await useFreshDb();
  process.env.SECURITY_REPORT_ADMIN_ID = "admin-id";
});
afterAll(async () => {
  delete process.env.SECURITY_REPORT_ADMIN_ID;
  await ctx.cleanup();
});
beforeEach(async () => {
  rateLimiter().clear();
  await ctx.db.delete(schema.securityReports);
  await ctx.db.delete(schema.auditLog);
});

const report = {
  title: "Authorization issue",
  details: "## Steps\n1. Open the affected endpoint\n2. Observe another account's resource",
  impact: "An account may read private resources.",
  location: "/api/example",
  anonymous: true,
  evidence: [],
};

/** Reports already in the inbox. Old ones fill capacity without using the hourly or daily budget. */
async function fill(count: number, createdAt: Date) {
  const rows = Array.from({ length: count }, (_, i) => ({
    id: `filler-${createdAt.getTime()}-${i}`,
    payloadEnc: "test-only",
    storedBytes: 1,
    createdAt,
  }));
  for (let i = 0; i < rows.length; i += 50) {
    await ctx.db.insert(schema.securityReports).values(rows.slice(i, i + 50));
  }
}
const old = () => new Date(Date.now() - 3 * DAY);

async function capacityWarnings() {
  return ctx.db
    .select()
    .from(schema.auditLog)
    .where(eq(schema.auditLog.action, "security_report.capacity_low"));
}

describe("shared admission control for anonymous reports", () => {
  it("enforces the hourly cap from the database, so a restart does not reset it", async () => {
    for (let i = 0; i < REPORT_HOURLY_LIMIT; i++) {
      await createSecurityReport(report, { source: `198.51.100.${i}` });
    }
    // A fresh process has an empty in-memory limiter; the database still holds the count.
    rateLimiter().clear();
    await expect(
      createSecurityReport(report, { source: "198.51.100.200" }),
    ).rejects.toMatchObject({ status: 503, code: "capacity" });
    expect(await ctx.db.select().from(schema.securityReports)).toHaveLength(
      REPORT_HOURLY_LIMIT,
    );
  });

  it("enforces the daily cap even when the hourly budget is free", async () => {
    await fill(REPORT_DAILY_LIMIT, new Date(Date.now() - 2 * HOUR));
    await expect(createSecurityReport(report)).rejects.toMatchObject({
      status: 503,
      code: "capacity",
    });
  });

  it("keeps one source to its share of the remaining capacity", async () => {
    // 100 used leaves 100 free, so one source may use 10% of what is left.
    // The share shrinks as the source's own reports fill the inbox: 9 get in here.
    await fill(100, old());
    for (let i = 0; i < 9; i++) {
      await createSecurityReport(report, { source: "203.0.113.7" });
    }
    await expect(
      createSecurityReport(report, { source: "203.0.113.7" }),
    ).rejects.toMatchObject({ status: 429, code: "rate_limited" });
    // Another source is still served.
    await expect(
      createSecurityReport(report, { source: "203.0.113.8" }),
    ).resolves.toEqual(expect.any(String));
  });

  it("stores only a keyed digest of the source, never the address", async () => {
    await createSecurityReport(report, { source: "203.0.113.9" });
    const rows = await ctx.db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.action, "security_report.source"));
    expect(rows).toHaveLength(1);
    expect(rows[0].target).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(rows)).not.toContain("203.0.113.9");
    expect(rows[0].userId).toBeNull();
  });

  it("reserves headroom once the inbox is 80% full", async () => {
    await fill(Math.ceil(REPORT_CAPACITY * 0.8), old());
    for (let i = 0; i < REPORT_HEADROOM_HOURLY_LIMIT; i++) {
      await createSecurityReport(report);
    }
    await expect(createSecurityReport(report)).rejects.toMatchObject({
      status: 503,
      code: "capacity",
    });
    // The last slots stay free: 160 of 200 used, 2 added in the hour.
    expect(await ctx.db.select().from(schema.securityReports)).toHaveLength(
      Math.ceil(REPORT_CAPACITY * 0.8) + REPORT_HEADROOM_HOURLY_LIMIT,
    );
  });

  it("still accepts a legitimate report under the cap", async () => {
    await fill(50, old());
    const id = await createSecurityReport(report, { source: "192.0.2.10" });
    expect(id).toEqual(expect.any(String));
    const stored = await ctx.db.select().from(schema.securityReports);
    expect(stored).toHaveLength(51);
    expect(await capacityWarnings()).toHaveLength(0);
  });

  it("warns the administrator above the threshold, at most once a day", async () => {
    await fill(Math.ceil(REPORT_CAPACITY * 0.8) - 1, old());
    await createSecurityReport(report);
    const warnings = await capacityWarnings();
    expect(warnings).toHaveLength(1);
    expect(warnings[0].userId).toBe("admin-id");
    expect(JSON.parse(warnings[0].meta ?? "{}")).toMatchObject({
      limit: REPORT_CAPACITY,
    });
    await createSecurityReport(report);
    expect(await capacityWarnings()).toHaveLength(1);
  });

  it("reports capacity to the administrator with used and limit counts", async () => {
    await fill(120, old());
    const low = await securityReportCapacity("admin-id");
    expect(low).toMatchObject({ used: 120, limit: REPORT_CAPACITY, low: false });
    await fill(40, old());
    const high = await securityReportCapacity("admin-id");
    expect(high).toMatchObject({ used: 160, limit: REPORT_CAPACITY, low: true });
    await expect(securityReportCapacity("someone-else")).rejects.toMatchObject({
      status: 403,
    });
  });

  it("does not warn below the threshold", async () => {
    await fill(100, old());
    await createSecurityReport(report);
    expect(await capacityWarnings()).toHaveLength(0);
    expect(capacityOf(160, 0).low).toBe(true);
    expect(capacityOf(159, 0).low).toBe(false);
  });

  it("keeps the source rows that matter to the window and removes expired ones", async () => {
    await ctx.db.insert(schema.auditLog).values({
      userId: null,
      action: "security_report.source",
      target: "f".repeat(64),
      meta: null,
      at: new Date(Date.now() - 2 * DAY),
    });
    await createSecurityReport(report, { source: "192.0.2.11" });
    const remaining = await ctx.db
      .select()
      .from(schema.auditLog)
      .where(and(eq(schema.auditLog.action, "security_report.source")));
    expect(remaining).toHaveLength(1);
    expect(remaining[0].target).not.toBe("f".repeat(64));
  });

  it("removes expired source rows on its own, without waiting for another report", async () => {
    const row = (target: string, at: Date) => ({ userId: null, action: "security_report.source", target, meta: null, at });
    await ctx.db.insert(schema.auditLog).values([
      row("a".repeat(64), new Date(Date.now() - DAY - 60_000)),
      row("b".repeat(64), new Date(Date.now() - HOUR)),
      // Another kind of row of the same age is not this function's to delete.
      { userId: null, action: "security_report.capacity_low", target: null, meta: null, at: new Date(Date.now() - 3 * DAY) },
    ]);
    await pruneReportSources();
    const left = await ctx.db.select().from(schema.auditLog);
    expect(left.map((r) => r.target).sort()).toEqual(["b".repeat(64), null].sort());
  });
});
