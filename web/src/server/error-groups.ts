import { and, desc, eq, gte } from "drizzle-orm";
import { getDb, schema } from "@/server/db";
import { audit } from "@/server/audit";
import { getReadableProject } from "@/server/projects";
import { getProjectRole, requireProjectRole } from "@/server/project-roles";
import { HttpError, notFound } from "@/server/http";
import { displayMessage, fingerprintOf, normalizeFile } from "@/server/error-fingerprint";
import {
  nextErrorStatus,
  type ErrorGroupAction,
  type ErrorGroupStatus,
} from "@/lib/error-status";

export type ErrorGroupView = {
  fingerprint: string;
  message: string;
  file: string;
  count: number;
  firstSeen: number;
  lastSeen: number;
  status: ErrorGroupStatus;
  assigneeId: string | null;
};

/** Errors read for grouping. Newer rows are kept if a project is over this. */
const GROUP_ROW_LIMIT = 20_000;

/**
 * Error groups of the last `days` days, newest first. Groups are computed here
 * from the raw error rows, so no grouping has to be stored. A group's status
 * and assignee come from `analytics_error_groups`.
 */
export async function errorGroups(
  userId: string,
  projectId: string,
  days = 30,
  now = new Date()
): Promise<ErrorGroupView[]> {
  const project = await getReadableProject(userId, projectId);
  const db = await getDb();
  const since = new Date(now.getTime() - days * 86_400_000);
  const rows = await db
    .select({
      message: schema.analyticsErrors.message,
      file: schema.analyticsErrors.file,
      at: schema.analyticsErrors.at,
    })
    .from(schema.analyticsErrors)
    .where(and(eq(schema.analyticsErrors.projectId, project.id), gte(schema.analyticsErrors.at, since)))
    .orderBy(desc(schema.analyticsErrors.at))
    .limit(GROUP_ROW_LIMIT);

  const groups = new Map<string, ErrorGroupView>();
  for (const r of rows) {
    const fingerprint = fingerprintOf(r.message, r.file);
    const at = r.at.getTime();
    const g = groups.get(fingerprint);
    if (g) {
      g.count += 1;
      g.firstSeen = Math.min(g.firstSeen, at);
      g.lastSeen = Math.max(g.lastSeen, at);
    } else {
      groups.set(fingerprint, {
        fingerprint,
        message: displayMessage(r.message),
        file: normalizeFile(r.file),
        count: 1,
        firstSeen: at,
        lastSeen: at,
        status: "open",
        assigneeId: null,
      });
    }
  }

  if (groups.size > 0) {
    const states = await db
      .select()
      .from(schema.analyticsErrorGroups)
      .where(eq(schema.analyticsErrorGroups.projectId, project.id));
    for (const s of states) {
      const g = groups.get(s.fingerprint);
      if (g) {
        g.status = s.status;
        g.assigneeId = s.assigneeId;
      }
    }
  }
  return [...groups.values()].sort((a, b) => b.lastSeen - a.lastSeen);
}

export const FINGERPRINT_PATTERN = /^[0-9a-f]{16}$/;

/**
 * Resolve, reopen, ignore or assign one group. Only the project's owner can
 * change triage (write access). An assignee must be a member of the project.
 * An action that does not apply to the current status is a 409.
 */
export async function changeErrorGroup(
  userId: string,
  projectId: string,
  fingerprint: string,
  action: ErrorGroupAction,
  assigneeId: string | null = null,
  now = new Date()
): Promise<{ status: ErrorGroupStatus; assigneeId: string | null }> {
  await requireProjectRole(userId, projectId, "owner");
  const project = await getReadableProject(userId, projectId);
  if (!FINGERPRINT_PATTERN.test(fingerprint)) throw notFound("Error group not found");
  const db = await getDb();

  const current = await db
    .select()
    .from(schema.analyticsErrorGroups)
    .where(and(eq(schema.analyticsErrorGroups.projectId, project.id), eq(schema.analyticsErrorGroups.fingerprint, fingerprint)))
    .get();
  const status: ErrorGroupStatus = current?.status ?? "open";
  let nextAssignee = current?.assigneeId ?? null;

  if (action === "assign") {
    if (assigneeId !== null) {
      const role = await getProjectRole(assigneeId, project.id);
      if (!role) throw new HttpError(400, "That person is not a member of this project.", "bad_assignee");
    }
    nextAssignee = assigneeId;
  }

  const nextStatus = nextErrorStatus(status, action);
  if (nextStatus === null) {
    throw new HttpError(409, `This error group is already ${status}.`, "bad_transition");
  }

  await db
    .insert(schema.analyticsErrorGroups)
    .values({
      projectId: project.id,
      fingerprint,
      status: nextStatus,
      assigneeId: nextAssignee,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [schema.analyticsErrorGroups.projectId, schema.analyticsErrorGroups.fingerprint],
      set: { status: nextStatus, assigneeId: nextAssignee, updatedAt: now },
    });

  await audit(userId, `errors.${action}`, project.id, { fingerprint });
  return { status: nextStatus, assigneeId: nextAssignee };
}
