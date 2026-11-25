import { createHash } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/server/db";
import type { ServiceStatus } from "@/server/service-status";
import { getReadableProject } from "@/server/projects";
import { notFound } from "@/server/http";
import { journalTail } from "@/server/deploy/remote";
import { maskSecrets, secretNeedles } from "@/server/deploy/redact";
import type { NestSession } from "@/server/ssh/connection";

const MAX_CRASH_REPORTS = 50;
const MAX_REPORT_BYTES = 40 * 1024;

type CrashReportSession = Pick<NestSession, "script">;

function crashId(projectId: string, releaseId: string, status: ServiceStatus) {
  const eventId = status.invocationId?.trim() || [
    status.restarts ?? "unknown",
    status.lastExit?.reason ?? status.result ?? status.detail ?? "failed",
    status.lastExit?.code ?? "unknown",
  ].join(":");
  const digest = createHash("sha256").update(projectId).update("\0").update(releaseId).update("\0").update(eventId).digest("hex");
  return `cr_${digest}`;
}

/** Capture one failed unit invocation while the monitor's SSH session is open. */
export async function captureFailedUnit(args: {
  projectId: string;
  releaseId: string;
  unit: string;
  status: ServiceStatus;
  session: CrashReportSession;
  at?: Date;
}): Promise<boolean> {
  if (args.status.state !== "failed") return false;

  const id = crashId(args.projectId, args.releaseId, args.status);
  const db = await getDb();
  const existing = await db.select({ id: schema.crashReports.id })
    .from(schema.crashReports)
    .where(eq(schema.crashReports.id, id))
    .get();
  if (existing) return false;

  const journal = await args.session.script(journalTail(args.unit, 200), {
    timeoutMs: 20_000,
    maxOutputBytes: 4 * 1024 * 1024,
  });
  if (journal.code !== 0) return false;

  // Use the same decrypted production environment values the deploy logger masks.
  // If they cannot be read, fail closed and do not store unredacted remote text.
  const { envForDeployment } = await import("@/server/deploy/pipeline");
  const env = await envForDeployment(args.projectId, "production");
  const needles = secretNeedles(Object.values(env));
  const lines = journal.stdout.replace(/\r?\n$/, "").split(/\r?\n/).slice(-200);
  const capturedLines = lines.map((line) => maskSecrets(line, needles)).join("\n");
  const reason = (args.status.lastExit?.reason || args.status.result || args.status.detail || "failed").slice(0, 200);
  const inserted = await db.insert(schema.crashReports).values({
    id,
    projectId: args.projectId,
    releaseId: args.releaseId,
    createdAt: args.at ?? new Date(),
    reason,
    capturedLines,
  }).onConflictDoNothing().returning({ id: schema.crashReports.id });
  return inserted.length > 0;
}

export type CrashReportSummary = {
  id: string;
  projectId: string;
  releaseId: string;
  createdAt: string;
  reason: string;
};

/** List a project's owned crash reports, newest first, with one bounded page. */
export async function listCrashReports(userId: string, projectId: string, limit = 20) {
  await getReadableProject(userId, projectId);
  const requested = Number.isFinite(limit) ? Math.floor(limit) : 20;
  const pageSize = Math.min(MAX_CRASH_REPORTS, Math.max(1, requested));
  const db = await getDb();
  const rows = await db.select({
    id: schema.crashReports.id,
    projectId: schema.crashReports.projectId,
    releaseId: schema.crashReports.releaseId,
    createdAt: schema.crashReports.createdAt,
    reason: schema.crashReports.reason,
  }).from(schema.crashReports)
    .where(eq(schema.crashReports.projectId, projectId))
    .orderBy(desc(schema.crashReports.createdAt), desc(schema.crashReports.id))
    .limit(pageSize + 1);
  return {
    projectId,
    reports: rows.slice(0, pageSize).map((row): CrashReportSummary => ({
      ...row,
      createdAt: row.createdAt.toISOString(),
    })),
    more: rows.length > pageSize,
  };
}

/** Read a report only through its project's owner boundary. */
export async function getCrashReport(userId: string, reportId: string) {
  const db = await getDb();
  const row = await db.select({
    id: schema.crashReports.id,
    projectId: schema.crashReports.projectId,
    releaseId: schema.crashReports.releaseId,
    createdAt: schema.crashReports.createdAt,
    reason: schema.crashReports.reason,
    capturedLines: schema.crashReports.capturedLines,
  }).from(schema.crashReports)
    .innerJoin(schema.projects, eq(schema.projects.id, schema.crashReports.projectId))
    .where(and(eq(schema.crashReports.id, reportId), eq(schema.projects.userId, userId)))
    .get();
  if (!row) throw notFound("Crash report not found");

  const fields = {
    id: row.id,
    projectId: row.projectId,
    releaseId: row.releaseId,
    createdAt: row.createdAt.toISOString(),
    reason: row.reason,
  };
  const response = (capturedLines: string, truncated: boolean) => ({ ...fields, capturedLines, truncated });
  if (Buffer.byteLength(JSON.stringify(response(row.capturedLines, false)), "utf8") <= MAX_REPORT_BYTES) {
    return response(row.capturedLines, false);
  }

  let low = 0;
  let high = 1;
  let best = "";
  for (let attempt = 0; attempt < 24; attempt++) {
    const ratio = (low + high) / 2;
    const candidate = row.capturedLines.slice(0, Math.floor(row.capturedLines.length * ratio));
    if (Buffer.byteLength(JSON.stringify(response(candidate, true)), "utf8") <= MAX_REPORT_BYTES) {
      best = candidate;
      low = ratio;
    } else {
      high = ratio;
    }
  }
  return response(best, true);
}
