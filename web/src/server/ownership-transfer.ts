import { and, eq, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { audit } from "@/server/audit";
import { getDb, schema } from "@/server/db";
import { HttpError, notFound } from "@/server/http";
import { orgRoleOf } from "@/server/organizations";

/**
 * Moving a project to another person. The current owner asks; the recipient
 * accepts. The recipient must already be a project member, and must still be
 * one (and, for an organization project, still in that organization) when they
 * accept. A request lasts 7 days.
 *
 * On acceptance the previous owner keeps admin access to the project as a
 * project member, so the change does not lock them out. The project's server
 * is not moved. That is an open product question: the new owner cannot manage
 * the server through the Servers page until it is decided.
 */
export const TRANSFER_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

type TransferState = "pending" | "accepted" | "declined" | "cancelled" | "expired";

async function loadProject(projectId: string) {
  const db = await getDb();
  const row = await db
    .select({ id: schema.projects.id, owner: schema.projects.userId, orgId: schema.projects.orgId })
    .from(schema.projects)
    .where(eq(schema.projects.id, projectId))
    .get();
  if (!row) throw notFound("Project not found");
  return row;
}

async function loadTransfer(transferId: string) {
  const db = await getDb();
  const row = await db.select().from(schema.ownershipTransfers).where(eq(schema.ownershipTransfers.id, transferId)).get();
  if (!row) throw notFound("Transfer not found");
  return row;
}

/** Recipient check used at request and at accept. Returns null when they qualify. */
async function recipientProblem(projectId: string, orgId: string | null, toUserId: string): Promise<string | null> {
  const db = await getDb();
  const member = await db
    .select({ role: schema.projectMembers.role })
    .from(schema.projectMembers)
    .where(and(eq(schema.projectMembers.projectId, projectId), eq(schema.projectMembers.userId, toUserId)))
    .get();
  if (!member) return "The new owner must already be a member of this project.";
  if (orgId !== null && (await orgRoleOf(toUserId, orgId)) === null) {
    return "The new owner must still be a member of this project's organization.";
  }
  return null;
}

/** The current owner asks to hand the project to a project member. */
export async function requestTransfer(
  actorId: string,
  projectId: string,
  toUserId: string,
  now = new Date()
): Promise<{ id: string; expiresAt: Date }> {
  const project = await loadProject(projectId);
  // Only the owner can start a transfer. Everyone else gets "not found", as with any project action.
  if (project.owner !== actorId) throw notFound("Project not found");
  if (toUserId === actorId) throw new HttpError(400, "You already own this project.", "invalid");

  const problem = await recipientProblem(projectId, project.orgId, toUserId);
  if (problem) throw new HttpError(400, problem, "invalid");

  const db = await getDb();
  // Pending requests past their expiry no longer block a new one.
  await db
    .update(schema.ownershipTransfers)
    .set({ state: "expired", resolvedAt: now })
    .where(and(eq(schema.ownershipTransfers.projectId, projectId), eq(schema.ownershipTransfers.state, "pending"), sql`${schema.ownershipTransfers.expiresAt} <= ${now.getTime()}`));
  const open = await db
    .select({ id: schema.ownershipTransfers.id })
    .from(schema.ownershipTransfers)
    .where(and(eq(schema.ownershipTransfers.projectId, projectId), eq(schema.ownershipTransfers.state, "pending")))
    .get();
  if (open) throw new HttpError(409, "A transfer for this project is already waiting for a reply.", "conflict");

  const id = randomUUID();
  const expiresAt = new Date(now.getTime() + TRANSFER_DAYS * DAY_MS);
  await db.insert(schema.ownershipTransfers).values({
    id,
    projectId,
    fromUserId: actorId,
    toUserId,
    state: "pending",
    expiresAt,
    createdAt: now,
  });
  await audit(actorId, "project.transfer.request", projectId, { to: toUserId });
  return { id, expiresAt };
}

/** Only the recipient can see the request they were sent. */
export async function pendingTransfersFor(userId: string, now = new Date()) {
  const db = await getDb();
  return db
    .select({
      id: schema.ownershipTransfers.id,
      projectId: schema.ownershipTransfers.projectId,
      fromUserId: schema.ownershipTransfers.fromUserId,
      expiresAt: schema.ownershipTransfers.expiresAt,
    })
    .from(schema.ownershipTransfers)
    .where(
      and(
        eq(schema.ownershipTransfers.toUserId, userId),
        eq(schema.ownershipTransfers.state, "pending"),
        sql`${schema.ownershipTransfers.expiresAt} > ${now.getTime()}`
      )
    );
}

/** The request must be the recipient's, still pending, and in date. */
function assertRecipientCanAct(transfer: typeof schema.ownershipTransfers.$inferSelect, userId: string, now: Date) {
  if (transfer.toUserId !== userId) throw notFound("Transfer not found");
  if (transfer.state !== "pending") throw new HttpError(410, `This transfer is already ${transfer.state}.`, "gone");
  if (transfer.expiresAt.getTime() <= now.getTime()) throw new HttpError(410, "This transfer has expired.", "gone");
}

/** The recipient declines. The owner keeps the project. */
export async function declineTransfer(userId: string, transferId: string, now = new Date()): Promise<void> {
  const transfer = await loadTransfer(transferId);
  assertRecipientCanAct(transfer, userId, now);
  const db = await getDb();
  const done = await db
    .update(schema.ownershipTransfers)
    .set({ state: "declined", resolvedAt: now })
    .where(and(eq(schema.ownershipTransfers.id, transferId), eq(schema.ownershipTransfers.state, "pending")))
    .returning({ id: schema.ownershipTransfers.id });
  if (done.length !== 1) throw new HttpError(410, "This transfer is no longer pending.", "gone");
  await audit(userId, "project.transfer.decline", transfer.projectId);
}

/** The owner withdraws a pending request. */
export async function cancelTransfer(actorId: string, transferId: string, now = new Date()): Promise<void> {
  const transfer = await loadTransfer(transferId);
  const project = await loadProject(transfer.projectId);
  if (project.owner !== actorId) throw notFound("Transfer not found");
  const db = await getDb();
  const done = await db
    .update(schema.ownershipTransfers)
    .set({ state: "cancelled", resolvedAt: now })
    .where(and(eq(schema.ownershipTransfers.id, transferId), eq(schema.ownershipTransfers.state, "pending")))
    .returning({ id: schema.ownershipTransfers.id });
  if (done.length !== 1) throw new HttpError(410, "This transfer is no longer pending.", "gone");
  await audit(actorId, "project.transfer.cancel", transfer.projectId);
}

/**
 * The recipient accepts. Re-checks everything at this moment: the request is
 * still pending and in date, the project is still owned by the sender, and the
 * recipient is still a project member (and in the organization, if any).
 */
export async function acceptTransfer(userId: string, transferId: string, now = new Date()): Promise<{ projectId: string }> {
  const transfer = await loadTransfer(transferId);
  assertRecipientCanAct(transfer, userId, now);

  const project = await loadProject(transfer.projectId);
  if (project.owner !== transfer.fromUserId) {
    throw new HttpError(409, "The project owner has changed since this request was made.", "conflict");
  }
  const problem = await recipientProblem(transfer.projectId, project.orgId, userId);
  if (problem) throw new HttpError(409, problem, "conflict");

  const db = await getDb();
  let won = false;
  await db.transaction(async (tx) => {
    const claimed = await tx
      .update(schema.ownershipTransfers)
      .set({ state: "accepted", resolvedAt: now })
      .where(
        and(
          eq(schema.ownershipTransfers.id, transferId),
          eq(schema.ownershipTransfers.state, "pending"),
          sql`${schema.ownershipTransfers.expiresAt} > ${now.getTime()}`
        )
      )
      .returning({ id: schema.ownershipTransfers.id });
    if (claimed.length !== 1) return;
    won = true;
    // The owner row moves to the recipient. The recipient's old member row goes; the previous owner stays as admin.
    await tx.update(schema.projects).set({ userId, updatedAt: now }).where(eq(schema.projects.id, transfer.projectId));
    await tx.delete(schema.projectMembers).where(and(eq(schema.projectMembers.projectId, transfer.projectId), eq(schema.projectMembers.userId, userId)));
    await tx
      .insert(schema.projectMembers)
      .values({ projectId: transfer.projectId, userId: transfer.fromUserId, role: "admin", createdAt: now })
      .onConflictDoUpdate({ target: [schema.projectMembers.projectId, schema.projectMembers.userId], set: { role: "admin" } });
  });
  if (!won) throw new HttpError(410, "This transfer is no longer pending.", "gone");
  await audit(userId, "project.transfer.accept", transfer.projectId, { from: transfer.fromUserId });
  return { projectId: transfer.projectId };
}
