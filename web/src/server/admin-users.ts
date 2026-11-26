import { and, desc, eq, inArray, like, or } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/server/db";
import { HttpError } from "@/server/http";
import { instanceAdminId, isInstanceAdmin } from "@/server/admin-identity";
import { accountStanding, graceEndFor } from "@/server/account-standing";
import { describeAction } from "@/server/audit";
import {
  grantInstanceAdminById,
  requireAdmin,
  revokeInstanceAdmin,
} from "@/server/instance-admins";

/**
 * Account administration: find a user, see their standing and history, ban or lift a ban, and change
 * administrators. Every function checks administration on the server, whatever the page shows. Every ban,
 * unban and administrator change writes an audit row. Bans and lifts write it in the same transaction as the
 * status change, so the log cannot miss one.
 */

export const USER_ACTIONS = ["admin.ban", "admin.unban", "admin.grant", "admin.revoke"] as const;
const reasonInput = z.object({
  reason: z.string().trim().min(5, "Give a reason of at least 5 characters.").max(500),
});
const administratorInput = z.object({ administrator: z.boolean() });

async function assertInstanceAdmin(actorId: string): Promise<void> {
  if (!(await isInstanceAdmin(actorId))) {
    throw new HttpError(403, "Only an instance administrator can manage accounts.", "forbidden");
  }
}

/** Search by name (a fragment) or by Hack Club id (exact). LIKE wildcards are removed so the search is literal. */
export async function listUsersForAdmin(actorId: string, rawQuery?: string | null, limit = 50) {
  await assertInstanceAdmin(actorId);
  const query = (rawQuery ?? "").trim().slice(0, 100).replace(/[%_\\]/g, "");
  const db = await getDb();
  const rows = await db
    .select({
      id: schema.users.id,
      name: schema.users.name,
      hackClubId: schema.users.hackClubId,
      email: schema.users.email,
      status: schema.users.status,
      suspendedAt: schema.users.suspendedAt,
      graceEndsAt: schema.users.graceEndsAt,
      createdAt: schema.users.createdAt,
    })
    .from(schema.users)
    .where(query ? or(like(schema.users.name, `%${query}%`), eq(schema.users.hackClubId, query)) : undefined)
    .orderBy(desc(schema.users.createdAt), desc(schema.users.id))
    .limit(Math.min(Math.max(limit, 1), 100));

  const ids = rows.map((r) => r.id);
  const granted = ids.length
    ? new Set((await db.select({ userId: schema.instanceAdmins.userId }).from(schema.instanceAdmins).where(inArray(schema.instanceAdmins.userId, ids))).map((g) => g.userId))
    : new Set<string>();
  const configured = instanceAdminId();
  const now = new Date();
  return {
    users: rows.map((r) => ({
      id: r.id,
      name: r.name,
      hackClubId: r.hackClubId,
      email: r.email,
      administrator: r.id === configured || granted.has(r.id),
      standing: accountStanding(r, now).state,
      createdAt: r.createdAt.toISOString(),
    })),
  };
}

export async function userDetailForAdmin(actorId: string, userId: string) {
  await assertInstanceAdmin(actorId);
  const db = await getDb();
  const row = await db
    .select({
      id: schema.users.id,
      name: schema.users.name,
      hackClubId: schema.users.hackClubId,
      email: schema.users.email,
      status: schema.users.status,
      suspendedAt: schema.users.suspendedAt,
      graceEndsAt: schema.users.graceEndsAt,
      suspensionReason: schema.users.suspensionReason,
      createdAt: schema.users.createdAt,
    })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .get();
  if (!row) throw new HttpError(404, "No account has that id.", "not_found");

  const history = await db
    .select({ id: schema.auditLog.id, actor: schema.auditLog.userId, action: schema.auditLog.action, at: schema.auditLog.at, meta: schema.auditLog.meta })
    .from(schema.auditLog)
    .where(and(eq(schema.auditLog.target, userId), inArray(schema.auditLog.action, [...USER_ACTIONS])))
    .orderBy(desc(schema.auditLog.at), desc(schema.auditLog.id))
    .limit(100);
  const actorIds = [...new Set(history.map((h) => h.actor).filter((a): a is string => !!a))];
  const actors = actorIds.length
    ? new Map((await db.select({ id: schema.users.id, name: schema.users.name }).from(schema.users).where(inArray(schema.users.id, actorIds))).map((a) => [a.id, a.name]))
    : new Map<string, string>();

  const standing = accountStanding(row, new Date());
  return {
    user: {
      id: row.id,
      name: row.name,
      hackClubId: row.hackClubId,
      email: row.email,
      createdAt: row.createdAt.toISOString(),
      suspendedAt: row.suspendedAt?.toISOString() ?? null,
      suspensionReason: row.suspensionReason,
    },
    standing: { state: standing.state, graceEndsAt: standing.state === "active" ? null : standing.graceEndsAt.toISOString() },
    administrator: row.id === instanceAdminId() || (await isInstanceAdmin(row.id)),
    configuredAdministrator: row.id === instanceAdminId(),
    history: history.map((h) => ({
      id: h.id,
      action: h.action,
      label: describeAction(h.action),
      at: h.at.toISOString(),
      actor: h.actor ? (actors.get(h.actor) ?? "Unknown account") : "Unknown account",
      reason: reasonFromMeta(h.meta),
    })),
  };
}

function reasonFromMeta(meta: string | null): string | null {
  if (!meta) return null;
  try {
    const value = (JSON.parse(meta) as Record<string, unknown>).reason;
    return typeof value === "string" ? value : null;
  } catch {
    return null;
  }
}

/**
 * Ban an account with a reason. The account keeps working for 15 days, then its writes are refused. An
 * administrator cannot be banned, and nobody can ban their own account.
 */
export async function banUser(actorId: string, userId: string, raw: unknown, freshSignIn: boolean) {
  await requireAdmin(actorId, freshSignIn);
  const { reason } = reasonInput.parse(raw);
  if (userId === actorId) throw new HttpError(400, "You cannot ban your own account.", "invalid");
  if (await isInstanceAdmin(userId)) {
    throw new HttpError(400, "Remove administration from this account before banning it.", "invalid");
  }
  const db = await getDb();
  const now = new Date();
  return db.transaction(async (tx) => {
    const target = await tx
      .select({ id: schema.users.id, status: schema.users.status, graceEndsAt: schema.users.graceEndsAt })
      .from(schema.users)
      .where(eq(schema.users.id, userId))
      .get();
    if (!target) throw new HttpError(404, "No account has that id.", "not_found");
    if (target.status === "suspended") {
      return { userId, changed: false, graceEndsAt: target.graceEndsAt?.toISOString() ?? null };
    }
    const graceEndsAt = graceEndFor(now);
    await tx
      .update(schema.users)
      .set({ status: "suspended", suspendedAt: now, graceEndsAt, suspensionReason: reason })
      .where(eq(schema.users.id, userId));
    await tx.insert(schema.auditLog).values({
      userId: actorId,
      action: "admin.ban",
      target: userId,
      meta: JSON.stringify({ reason, graceEndsAt: graceEndsAt.toISOString() }),
      at: now,
    });
    return { userId, changed: true, graceEndsAt: graceEndsAt.toISOString() };
  });
}

/** Lift a ban at any time. The reason for the lift is recorded next to the reason for the ban. */
export async function liftBan(actorId: string, userId: string, raw: unknown, freshSignIn: boolean) {
  await requireAdmin(actorId, freshSignIn);
  const { reason } = reasonInput.parse(raw);
  const db = await getDb();
  const now = new Date();
  return db.transaction(async (tx) => {
    const target = await tx
      .select({ id: schema.users.id, status: schema.users.status, suspensionReason: schema.users.suspensionReason })
      .from(schema.users)
      .where(eq(schema.users.id, userId))
      .get();
    if (!target) throw new HttpError(404, "No account has that id.", "not_found");
    if (target.status !== "suspended") return { userId, changed: false };
    await tx
      .update(schema.users)
      .set({ status: "active", suspendedAt: null, graceEndsAt: null, suspensionReason: null })
      .where(eq(schema.users.id, userId));
    await tx.insert(schema.auditLog).values({
      userId: actorId,
      action: "admin.unban",
      target: userId,
      meta: JSON.stringify({ reason, banReason: target.suspensionReason ?? "" }),
      at: now,
    });
    return { userId, changed: true };
  });
}

/** Make an account an administrator, or remove that. The configured account cannot be removed. */
export async function setAdministrator(actorId: string, userId: string, raw: unknown, freshSignIn: boolean) {
  const { administrator } = administratorInput.parse(raw);
  if (administrator) return grantInstanceAdminById(actorId, { userId }, freshSignIn);
  return revokeInstanceAdmin(actorId, { userId }, freshSignIn);
}
