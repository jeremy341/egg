import { and, count, desc, eq, gte, lt, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/server/db";
import { keyedDigestHex, newId, open, seal } from "@/server/crypto";
import { HttpError, notFound } from "@/server/http";
import { audit } from "@/server/audit";

export const REPORT_BODY_LIMIT = 4_300_000;
export const REPORT_IMAGE_BYTES = 1_000_000;
export const REPORT_MAX_IMAGES = 3;
export const REPORT_CAPACITY = 200;
export const REPORT_STORAGE_BYTES = 100_000_000;
export const REPORT_STATUSES = ["new", "reviewing", "resolved"] as const;

/*
 * Admission control for anonymous submissions. It is counted from the inbox
 * itself (createdAt, and the source digests kept in audit_log), so it holds
 * across restarts and across processes. The in-memory limiter in the route is
 * only a cheap first layer against floods.
 *
 * - REPORT_HOURLY_LIMIT / REPORT_DAILY_LIMIT: new reports from anyone, per
 *   rolling hour and day. 12 an hour and 60 a day would fill the 200 slots in
 *   about four days of sustained abuse, which gives the admin time to notice
 *   the warning, while a real reporter (a few a month at most) is never near it.
 * - REPORT_HEADROOM_SHARE: once the inbox is this full (by count or bytes), the
 *   last 20% of capacity is held back for reports that matter. Anonymous
 *   submissions then get only REPORT_HEADROOM_HOURLY_LIMIT per hour, so a flood
 *   cannot take the final slots in minutes. The same share also triggers the
 *   operator warning.
 * - REPORT_SOURCE_SHARE: one network source may use this share of the remaining
 *   capacity per rolling day (never less than one report). Sources are
 *   identified by a keyed digest of the address; no raw address is stored. When
 *   no trusted address is known, no per-source check applies and only the
 *   global limits do.
 */
export const REPORT_HOURLY_LIMIT = 12;
export const REPORT_DAILY_LIMIT = 60;
export const REPORT_HEADROOM_SHARE = 0.8;
export const REPORT_HEADROOM_HOURLY_LIMIT = 2;
export const REPORT_SOURCE_SHARE = 0.1;

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
const SOURCE_ACTION = "security_report.source";
const FULL_MESSAGE =
  "The private inbox is at capacity. Please use the private advisory link.";
const REFUSED_MESSAGE =
  "The private inbox is not accepting new reports right now. Please use the private advisory link.";

export type ReportCapacity = {
  used: number;
  limit: number;
  bytes: number;
  byteLimit: number;
  /** The fuller of the two measures, from 0 to 1. */
  fraction: number;
  /** True at or above REPORT_HEADROOM_SHARE, when headroom applies and the admin is warned. */
  low: boolean;
};

export function capacityOf(used: number, bytes: number): ReportCapacity {
  const fraction = Math.max(used / REPORT_CAPACITY, bytes / REPORT_STORAGE_BYTES);
  return {
    used,
    limit: REPORT_CAPACITY,
    bytes,
    byteLimit: REPORT_STORAGE_BYTES,
    fraction,
    low: fraction >= REPORT_HEADROOM_SHARE,
  };
}

/** Current inbox fill, for the administrator's capacity banner. */
export async function securityReportCapacity(userId: string): Promise<ReportCapacity> {
  assertReportAdmin(userId);
  const db = await getDb();
  const totals = await db
    .select({
      n: count(),
      bytes: sql<number>`coalesce(sum(${schema.securityReports.storedBytes}), 0)`,
    })
    .from(schema.securityReports)
    .get();
  return capacityOf(totals?.n ?? 0, totals?.bytes ?? 0);
}

export function reportAdminId(): string | null {
  return process.env.SECURITY_REPORT_ADMIN_ID?.trim() || null;
}
export function isReportAdmin(user: { id: string } | null): boolean {
  return !!user && !!reportAdminId() && user.id === reportAdminId();
}
export function assertReportAdmin(userId: string) {
  if (!isReportAdmin({ id: userId }))
    throw new HttpError(
      403,
      "Only the configured security administrator can read this inbox.",
      "forbidden",
    );
}

const evidenceInput = z.object({
  name: z.string().max(120),
  type: z.enum(["image/png", "image/jpeg"]),
  data: z.string().max(1_340_000),
});
const input = z.object({
  title: z.string().trim().min(5).max(160),
  details: z.string().trim().min(20).max(30_000),
  impact: z.string().trim().min(10).max(5000),
  location: z.string().trim().max(1000).default(""),
  anonymous: z.boolean().default(true),
  name: z.string().trim().max(120).optional(),
  contact: z.string().trim().max(320).optional(),
  evidence: z.array(evidenceInput).max(REPORT_MAX_IMAGES).default([]),
});
export type ReportEvidence = z.infer<typeof evidenceInput>;
export type ReportPayload = z.infer<typeof input>;

/** Validate raster signatures and bounded dimensions. Files are served only as downloads. */
export function validateEvidence(raw: unknown): ReportEvidence {
  const image = evidenceInput.parse(raw);
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(image.data) || image.data.length % 4 !== 0)
    throw new HttpError(400, "The image is not valid base64.", "validation");
  const b = Buffer.from(image.data, "base64");
  if (!b.length || b.length > REPORT_IMAGE_BYTES)
    throw new HttpError(
      400,
      "Each image must be no larger than 1 MB.",
      "validation",
    );
  let width = 0,
    height = 0;
  if (image.type === "image/png") {
    if (
      b.length < 45 ||
      !b.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex")) ||
      b.toString("ascii", 12, 16) !== "IHDR" ||
      b.readUInt32BE(8) !== 13 ||
      b.toString("ascii", b.length - 8, b.length - 4) !== "IEND"
    )
      throw new HttpError(
        400,
        "Choose a valid PNG or JPEG image.",
        "validation",
      );
    width = b.readUInt32BE(16);
    height = b.readUInt32BE(20);
  } else {
    if (
      b.length < 12 ||
      b[0] !== 0xff ||
      b[1] !== 0xd8 ||
      b[b.length - 2] !== 0xff ||
      b[b.length - 1] !== 0xd9
    )
      throw new HttpError(
        400,
        "Choose a valid PNG or JPEG image.",
        "validation",
      );
    let p = 2;
    while (p + 4 < b.length) {
      if (b[p++] !== 0xff) break;
      while (b[p] === 0xff) p++;
      const marker = b[p++];
      if (marker === 0xda || marker === 0xd9) break;
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      if (p + 2 > b.length) break;
      const length = b.readUInt16BE(p);
      if (length < 2 || p + length > b.length) break;
      if ([0xc0, 0xc1, 0xc2].includes(marker) && length >= 8) {
        height = b.readUInt16BE(p + 3);
        width = b.readUInt16BE(p + 5);
        break;
      }
      p += length;
    }
  }
  if (
    !width ||
    !height ||
    width > 10_000 ||
    height > 10_000 ||
    width * height > 16_000_000
  )
    throw new HttpError(
      400,
      "Images must contain at most 16 million pixels, with each side at most 10,000 pixels.",
      "validation",
    );
  // Keep a simple label; never reuse an uploaded name as a filesystem path.
  return {
    ...image,
    name:
      image.name.replace(/[^A-Za-z0-9._ -]/g, "_").slice(0, 100) || "evidence",
  };
}

export async function createSecurityReport(
  raw: unknown,
  options: { source?: string | null } = {},
): Promise<string> {
  if (!reportAdminId())
    throw new HttpError(
      503,
      "This instance has not configured its private reporting inbox. Use the private advisory link instead.",
      "not_configured",
    );
  const parsed = input.parse(raw);
  const payload: ReportPayload = {
    ...parsed,
    evidence: parsed.evidence.map(validateEvidence),
  };
  if (payload.anonymous) {
    delete payload.name;
    delete payload.contact;
  }
  const id = newId();
  const payloadEnc = seal(JSON.stringify(payload), `security-report:${id}`);
  const storedBytes = Buffer.byteLength(payloadEnc);
  const db = await getDb();
  const now = new Date();
  // A keyed digest only: the address itself is never stored.
  const source = options.source
    ? keyedDigestHex("report-source", options.source)
    : null;
  let after: { used: number; bytes: number };
  try {
    after = await db.transaction(async (tx) => {
      const totals = await tx
        .select({
          n: count(),
          bytes: sql<number>`coalesce(sum(${schema.securityReports.storedBytes}), 0)`,
        })
        .from(schema.securityReports)
        .get();
      const used = totals?.n ?? 0;
      const bytes = totals?.bytes ?? 0;
      if (used >= REPORT_CAPACITY || bytes + storedBytes > REPORT_STORAGE_BYTES)
        throw new HttpError(503, FULL_MESSAGE, "capacity");

      // Global admission: rolling hour and day, tighter once headroom applies.
      const hourAgo = new Date(now.getTime() - HOUR_MS);
      const dayAgo = new Date(now.getTime() - DAY_MS);
      const lastHour =
        (
          await tx
            .select({ n: count() })
            .from(schema.securityReports)
            .where(gte(schema.securityReports.createdAt, hourAgo))
            .get()
        )?.n ?? 0;
      const lastDay =
        (
          await tx
            .select({ n: count() })
            .from(schema.securityReports)
            .where(gte(schema.securityReports.createdAt, dayAgo))
            .get()
        )?.n ?? 0;
      const tight = capacityOf(used, bytes).low;
      const hourLimit = tight ? REPORT_HEADROOM_HOURLY_LIMIT : REPORT_HOURLY_LIMIT;
      if (lastHour >= hourLimit || lastDay >= REPORT_DAILY_LIMIT)
        throw new HttpError(503, REFUSED_MESSAGE, "capacity");

      // Per-source share of what is left. Source rows are pruned after a day.
      if (source) {
        await tx
          .delete(schema.auditLog)
          .where(
            and(
              eq(schema.auditLog.action, SOURCE_ACTION),
              lt(schema.auditLog.at, dayAgo),
            ),
          );
        const fromSource =
          (
            await tx
              .select({ n: count() })
              .from(schema.auditLog)
              .where(
                and(
                  eq(schema.auditLog.action, SOURCE_ACTION),
                  eq(schema.auditLog.target, source),
                  gte(schema.auditLog.at, dayAgo),
                ),
              )
              .get()
          )?.n ?? 0;
        const share = Math.max(
          1,
          Math.floor((REPORT_CAPACITY - used) * REPORT_SOURCE_SHARE),
        );
        if (fromSource >= share)
          throw new HttpError(
            429,
            "Too many reports from this network today. Please try later or use the private advisory link.",
            "rate_limited",
            { "Retry-After": "3600" },
          );
        await tx.insert(schema.auditLog).values({
          userId: null,
          action: "security_report.source",
          target: source,
          meta: null,
          at: now,
        });
      }

      await tx
        .insert(schema.securityReports)
        .values({ id, payloadEnc, storedBytes, createdAt: now });
      return { used: used + 1, bytes: bytes + storedBytes };
    });
  } catch (err) {
    if (err instanceof Error && /SQLITE_BUSY|SQLITE_LOCKED/.test(err.message))
      throw new HttpError(
        503,
        "The inbox is busy. Please try again shortly.",
        "busy",
      );
    throw err;
  }
  await warnIfCapacityLow(after.used, after.bytes);
  return id;
}

/**
 * Delete source digests older than a day. A submission does this too, but the
 * privacy notice promises one day, so it must not depend on another report arriving.
 */
export async function pruneReportSources(now = new Date()): Promise<void> {
  const db = await getDb();
  await db
    .delete(schema.auditLog)
    .where(and(eq(schema.auditLog.action, SOURCE_ACTION), lt(schema.auditLog.at, new Date(now.getTime() - DAY_MS))));
}

/**
 * Tell the administrator once a day that the inbox is at the headroom share.
 * Written to the audit log under the admin account, so it shows in their
 * activity. Never lets a warning failure reject the report.
 */
async function warnIfCapacityLow(used: number, bytes: number) {
  const adminId = reportAdminId();
  if (!adminId || !capacityOf(used, bytes).low) return;
  try {
    const db = await getDb();
    const recent = await db
      .select({ n: count() })
      .from(schema.auditLog)
      .where(
        and(
          eq(schema.auditLog.action, "security_report.capacity_low"),
          gte(schema.auditLog.at, new Date(Date.now() - DAY_MS)),
        ),
      )
      .get();
    if ((recent?.n ?? 0) > 0) return;
    await audit(adminId, "security_report.capacity_low", null, {
      used,
      limit: REPORT_CAPACITY,
    });
  } catch (err) {
    console.warn(
      "capacity warning failed",
      err instanceof Error ? err.message : err,
    );
  }
}

function unpack(row: typeof schema.securityReports.$inferSelect) {
  const payload = input.parse(
    JSON.parse(open(row.payloadEnc, `security-report:${row.id}`)),
  );
  return { id: row.id, status: row.status, createdAt: row.createdAt, payload };
}
export async function listSecurityReports(userId: string) {
  assertReportAdmin(userId);
  const db = await getDb();
  const rows = await db
    .select()
    .from(schema.securityReports)
    .orderBy(desc(schema.securityReports.createdAt))
    .limit(REPORT_CAPACITY);
  await audit(userId, "security_report.list");
  return rows.map((row) => {
    const r = unpack(row);
    return {
      id: r.id,
      status: r.status,
      createdAt: r.createdAt,
      title: r.payload.title,
      anonymous: r.payload.anonymous,
      evidenceCount: r.payload.evidence.length,
    };
  });
}
export async function getSecurityReport(userId: string, id: string) {
  assertReportAdmin(userId);
  const db = await getDb();
  const row = await db
    .select()
    .from(schema.securityReports)
    .where(eq(schema.securityReports.id, id))
    .get();
  if (!row) throw notFound("Report not found");
  await audit(userId, "security_report.read", id);
  return unpack(row);
}
export async function updateSecurityReport(
  userId: string,
  id: string,
  status: unknown,
) {
  assertReportAdmin(userId);
  const value = z.enum(REPORT_STATUSES).parse(status);
  const db = await getDb();
  const rows = await db
    .update(schema.securityReports)
    .set({ status: value })
    .where(eq(schema.securityReports.id, id))
    .returning({ id: schema.securityReports.id });
  if (!rows.length) throw notFound("Report not found");
  await audit(userId, "security_report.status", id, { status: value });
}
export async function deleteSecurityReport(userId: string, id: string) {
  assertReportAdmin(userId);
  const db = await getDb();
  const rows = await db
    .delete(schema.securityReports)
    .where(eq(schema.securityReports.id, id))
    .returning({ id: schema.securityReports.id });
  if (!rows.length) throw notFound("Report not found");
  await audit(userId, "security_report.delete", id);
}
