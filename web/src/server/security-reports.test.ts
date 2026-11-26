import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { schema } from "@/server/db";
import { eq } from "drizzle-orm";
import { useFreshDb } from "@/server/test/db";
import { upsertUser } from "@/server/auth/session";
import { isInstanceAdmin } from "@/server/admin-identity";
import {
  createSecurityReport,
  deleteSecurityReport,
  getSecurityReport,
  listSecurityReports,
  REPORT_CAPACITY,
  validateEvidence,
} from "@/server/security-reports";

let ctx: Awaited<ReturnType<typeof useFreshDb>>;
beforeAll(async () => {
  ctx = await useFreshDb();
  process.env.SECURITY_REPORT_ADMIN_ID = "admin-id";
});
afterAll(async () => {
  delete process.env.SECURITY_REPORT_ADMIN_ID;
  await ctx.cleanup();
});
const report = {
  title: "Authorization issue",
  details:
    "## Steps\n1. Open the affected endpoint\n2. Observe another account's resource",
  impact: "An account may read private resources.",
  location: "/api/example",
  anonymous: true,
  evidence: [],
};

describe("private security reports", () => {
  it("denies admin access unless the configured account or a granted account", async () => {
    expect(await isInstanceAdmin("admin-id")).toBe(true);
    expect(await isInstanceAdmin("other")).toBe(false);
    expect(await isInstanceAdmin(null)).toBe(false);
    delete process.env.SECURITY_REPORT_ADMIN_ID;
    expect(await isInstanceAdmin("admin-id")).toBe(false);
    process.env.SECURITY_REPORT_ADMIN_ID = "admin-id";
  });
  it("treats a granted account as admin until the grant is removed", async () => {
    const granted = await upsertUser({ id: "granted-admin", name: "Granted", email: null, slackId: null });
    expect(await isInstanceAdmin(granted.id)).toBe(false);
    const db = ctx.db;
    await db.insert(schema.instanceAdmins).values({ userId: granted.id, grantedBy: null, grantedAt: new Date() });
    expect(await isInstanceAdmin(granted.id)).toBe(true);
    await db.delete(schema.instanceAdmins).where(eq(schema.instanceAdmins.userId, granted.id));
    expect(await isInstanceAdmin(granted.id)).toBe(false);
  });
  it("seals report content and discards identity in anonymous mode", async () => {
    const id = await createSecurityReport({
      ...report,
      name: "Private name",
      contact: "private@example.test",
    });
    const stored = await ctx.db.select().from(schema.securityReports);
    expect(stored[0].payloadEnc).not.toContain("Authorization issue");
    expect(stored[0].payloadEnc).not.toContain("private@example.test");
    const opened = await getSecurityReport("admin-id", id);
    expect(opened.payload.title).toBe(report.title);
    expect(opened.payload.name).toBeUndefined();
    expect(opened.payload.contact).toBeUndefined();
    await expect(getSecurityReport("another-user", id)).rejects.toMatchObject({
      status: 403,
    });
    await expect(listSecurityReports("another-user")).rejects.toMatchObject({
      status: 403,
    });
    await deleteSecurityReport("admin-id", id);
    await expect(getSecurityReport("admin-id", id)).rejects.toMatchObject({
      status: 404,
    });
  });
  it("refuses evidence with a spoofed image type, active SVG, or oversized pixel dimensions", () => {
    expect(() =>
      validateEvidence({
        name: "proof.png",
        type: "image/png",
        data: Buffer.from("<svg onload=alert(1)>").toString("base64"),
      }),
    ).toThrow();
    expect(() =>
      validateEvidence({
        name: "proof.svg",
        type: "image/svg+xml",
        data: "AAAA",
      }),
    ).toThrow();
    const png = Buffer.alloc(45);
    Buffer.from("89504e470d0a1a0a", "hex").copy(png);
    png.write("IHDR", 12);
    png.writeUInt32BE(100000, 16);
    png.writeUInt32BE(100000, 20);
    expect(() =>
      validateEvidence({
        name: "large.png",
        type: "image/png",
        data: png.toString("base64"),
      }),
    ).toThrow();
  });
  it("does not accept reports when no administrator has been configured", async () => {
    delete process.env.SECURITY_REPORT_ADMIN_ID;
    await expect(createSecurityReport(report)).rejects.toMatchObject({
      status: 503,
    });
    process.env.SECURITY_REPORT_ADMIN_ID = "admin-id";
  });
  it("enforces its persistent inbox count cap before accepting another report", async () => {
    const rows = Array.from({ length: REPORT_CAPACITY }, (_, i) => ({
      id: `capacity-${i}`,
      payloadEnc: "test-only",
      storedBytes: 1,
      createdAt: new Date(),
    }));
    await ctx.db.insert(schema.securityReports).values(rows);
    try {
      await expect(createSecurityReport(report)).rejects.toMatchObject({
        status: 503,
        code: "capacity",
      });
      const all = await ctx.db.select().from(schema.securityReports);
      expect(all).toHaveLength(REPORT_CAPACITY);
    } finally {
      for (const row of rows)
        await ctx.db
          .delete(schema.securityReports)
          .where(eq(schema.securityReports.id, row.id));
    }
  });
});
