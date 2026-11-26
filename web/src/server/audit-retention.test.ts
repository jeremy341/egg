import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { schema } from "@/server/db";
import { audit } from "@/server/audit";
import { AUDIT_KEEP_DAYS, pruneAuditLog } from "@/server/audit-retention";
import { useFreshDb } from "@/server/test/db";

let ctx: Awaited<ReturnType<typeof useFreshDb>>;
const now = new Date("2026-11-24T00:00:00Z");
const DAY = 24 * 60 * 60 * 1000;

beforeAll(async () => {
  ctx = await useFreshDb();
});
afterAll(async () => ctx.cleanup());

describe("audit levels", () => {
  it("an entry with no scope is tagged app and has no organization", async () => {
    await audit("u1", "project.update", "p1");
    const rows = await ctx.db.select().from(schema.auditLog).all();
    const appRow = rows.find((r) => r.action === "project.update");
    expect(appRow?.level).toBe("app");
    expect(appRow?.orgId).toBeNull();
  });

  it("an organization entry names its organization", async () => {
    await audit("u1", "org.invite", "inv1", { role: "member" }, { level: "organization", orgId: "org-1" });
    const row = (await ctx.db.select().from(schema.auditLog).all()).find((r) => r.action === "org.invite");
    expect(row).toMatchObject({ level: "organization", orgId: "org-1" });
  });

  it("an instance entry is tagged instance", async () => {
    await audit("admin", "admin.grant", "u2", undefined, { level: "instance" });
    const row = (await ctx.db.select().from(schema.auditLog).all()).find((r) => r.action === "admin.grant");
    expect(row?.level).toBe("instance");
  });
});

describe("retention", () => {
  it("keeps entries for 180 days and deletes older ones, at every level", async () => {
    expect(AUDIT_KEEP_DAYS).toBe(180);
    const at = (days: number) => new Date(now.getTime() - days * DAY);
    await ctx.db.insert(schema.auditLog).values([
      { userId: "old-app", action: "x.old", level: "app", at: at(181) },
      { userId: "old-org", action: "x.old", level: "organization", orgId: "org-1", at: at(181) },
      { userId: "old-instance", action: "x.old", level: "instance", at: at(181) },
      { userId: "edge", action: "x.edge", level: "app", at: at(180) },
      { userId: "new", action: "x.new", level: "app", at: at(10) },
    ]);
    const removed = await pruneAuditLog(now);
    expect(removed).toBe(3);
    const left = (await ctx.db.select().from(schema.auditLog).all()).map((r) => r.userId);
    expect(left).not.toContain("old-app");
    expect(left).not.toContain("old-org");
    expect(left).not.toContain("old-instance");
    // Exactly 180 days old is still kept; the window is strictly older than 180 days.
    expect(left).toContain("edge");
    expect(left).toContain("new");
  });

  it("is idempotent: a second run removes nothing more", async () => {
    expect(await pruneAuditLog(now)).toBe(0);
  });
});
