import { and, eq, gt, inArray, lte, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import { audit } from "@/server/audit";
import { newId, randomToken, sha256Hex } from "@/server/crypto";
import { getDb, schema } from "@/server/db";
import { HttpError, notFound } from "@/server/http";

export type ProjectRole = "owner" | "developer" | "viewer";
type MemberRole = Exclude<ProjectRole, "owner">;
const memberRole = z.enum(["viewer", "developer"]);
export const invitationInput = z.union([
  z.object({ email: z.string().trim().email().max(320), role: memberRole }).strict(),
  z.object({ userId: z.string().min(1).max(128), role: memberRole }).strict(),
]);
const normaliseEmail = (email: string) => email.trim().toLowerCase();
const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
type Tx = Parameters<Parameters<Awaited<ReturnType<typeof getDb>>["transaction"]>[0]>[0];

/** Revocation wins against work that has not crossed the activation boundary. */
async function cancelMemberWork(tx: Tx, projectId: string, memberId: string) {
  const canceled = await tx.update(schema.deployments).set({ state: "canceled", error: "Project role revoked", finishedAt: new Date() })
    .where(and(eq(schema.deployments.projectId, projectId), eq(schema.deployments.triggeredBy, memberId),
      inArray(schema.deployments.state, ["queued", "building", "deploying"]), isNull(schema.deployments.activationStartedAt)))
    .returning({ id: schema.deployments.id });
  if (canceled.length) await tx.update(schema.jobs).set({ state: "failed", error: "Project role revoked" })
    .where(and(eq(schema.jobs.state, "queued"), inArray(schema.jobs.deploymentId, canceled.map(d => d.id))));
}

/** A correlated predicate for queries already joined to projects. */
export function projectReadableBy(userId: string) {
  return or(eq(schema.projects.userId, userId), sql`exists (select 1 from project_members pm where pm.project_id = ${schema.projects.id} and pm.user_id = ${userId} and pm.role in ('viewer', 'developer'))`);
}

export async function getProjectRole(userId: string, projectId: string): Promise<ProjectRole | null> {
  const db = await getDb();
  const project = await db.select({ owner: schema.projects.userId }).from(schema.projects).where(eq(schema.projects.id, projectId)).get();
  if (!project) return null;
  if (project.owner === userId) return "owner";
  const member = await db.select({ role: schema.projectMembers.role }).from(schema.projectMembers)
    .where(and(eq(schema.projectMembers.projectId, projectId), eq(schema.projectMembers.userId, userId))).get();
  return member?.role === "viewer" || member?.role === "developer" ? member.role : null;
}

export async function requireProjectRole(userId: string, projectId: string, minimum: ProjectRole) {
  const role = await getProjectRole(userId, projectId);
  const rank: Record<ProjectRole, number> = { viewer: 1, developer: 2, owner: 3 };
  if (!role || rank[role] < rank[minimum]) throw notFound("Project not found");
  return role;
}

export async function createProjectInvitation(userId: string, projectId: string, raw: unknown, now = new Date()) {
  await requireProjectRole(userId, projectId, "owner");
  const input = invitationInput.parse(raw);
  const token = randomToken();
  const invitation = { id: newId(), projectId, email: "email" in input ? normaliseEmail(input.email) : "",
    invitedUserId: "userId" in input ? input.userId : null, role: input.role,
    createdAt: now, expiresAt: new Date(now.getTime() + INVITATION_TTL_MS), acceptedAt: null };
  const db = await getDb();
  await db.transaction(async (tx) => {
    if (invitation.invitedUserId) {
      const recipient = await tx.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.id, invitation.invitedUserId)).get();
      if (!recipient || recipient.id === userId) throw notFound("Recipient not found");
    }
    await tx.delete(schema.projectInvitations).where(and(eq(schema.projectInvitations.projectId, projectId), lte(schema.projectInvitations.expiresAt, now)));
    const [active] = await tx.select({ n: sql<number>`count(*)` }).from(schema.projectInvitations).where(and(
      eq(schema.projectInvitations.projectId, projectId), isNull(schema.projectInvitations.acceptedAt), gt(schema.projectInvitations.expiresAt, now)));
    if (active.n >= 20) throw new HttpError(409, "This project has too many active invitations.", "limit");
    await tx.insert(schema.projectInvitations).values({ ...invitation, tokenHash: sha256Hex(token) });
  });
  await audit(userId, "project.invitation.create", projectId, { invitationId: invitation.id, role: input.role });
  return { invitation, token };
}

export async function listProjectInvitations(userId: string, projectId: string) {
  await requireProjectRole(userId, projectId, "owner");
  const db = await getDb();
  return db.select({ id: schema.projectInvitations.id, email: schema.projectInvitations.email, invitedUserId: schema.projectInvitations.invitedUserId,
    role: schema.projectInvitations.role, createdAt: schema.projectInvitations.createdAt,
    expiresAt: schema.projectInvitations.expiresAt, acceptedAt: schema.projectInvitations.acceptedAt })
    .from(schema.projectInvitations).where(eq(schema.projectInvitations.projectId, projectId));
}

export async function revokeProjectInvitation(userId: string, projectId: string, id: string) {
  await requireProjectRole(userId, projectId, "owner");
  const db = await getDb();
  const rows = await db.delete(schema.projectInvitations).where(and(eq(schema.projectInvitations.id, id), eq(schema.projectInvitations.projectId, projectId))).returning({ id: schema.projectInvitations.id });
  if (!rows.length) throw notFound("Invitation not found");
  await audit(userId, "project.invitation.revoke", projectId, { invitationId: id });
}

export async function acceptProjectInvitation(userId: string, token: string, now = new Date()) {
  if (typeof token !== "string" || token.length > 256 || !token) throw notFound("Invitation not found");
  const db = await getDb();
  const { projectId, alreadyMember } = await db.transaction(async (tx) => {
    const user = await tx.select({ email: schema.users.email, emailVerified: schema.users.emailVerified }).from(schema.users).where(eq(schema.users.id, userId)).get();
    const invite = await tx.select().from(schema.projectInvitations).where(and(
      eq(schema.projectInvitations.tokenHash, sha256Hex(token)), isNull(schema.projectInvitations.acceptedAt), gt(schema.projectInvitations.expiresAt, now)
    )).get();
    if (!invite || !user || (invite.invitedUserId ? invite.invitedUserId !== userId :
      !user.emailVerified || !user.email || normaliseEmail(user.email) !== invite.email)) throw notFound("Invitation not found");
    const project = await tx.select({ owner: schema.projects.userId }).from(schema.projects).where(eq(schema.projects.id, invite.projectId)).get();
    if (!project || project.owner === userId) throw notFound("Invitation not found");
    const claimed = await tx.update(schema.projectInvitations).set({ acceptedAt: now }).where(and(
      eq(schema.projectInvitations.id, invite.id), isNull(schema.projectInvitations.acceptedAt), gt(schema.projectInvitations.expiresAt, now)
    )).returning({ id: schema.projectInvitations.id });
    if (!claimed.length) throw notFound("Invitation not found");
    // Existing membership is never upgraded by accepting an older invitation.
    const joined = await tx.insert(schema.projectMembers).values({ projectId: invite.projectId, userId, role: invite.role, createdAt: now })
      .onConflictDoNothing().returning({ userId: schema.projectMembers.userId });
    return { projectId: invite.projectId, alreadyMember: joined.length === 0 };
  });
  await audit(userId, "project.invitation.accept", projectId);
  return { projectId, alreadyMember };
}

export async function listProjectMembers(userId: string, projectId: string) {
  await requireProjectRole(userId, projectId, "owner");
  const db = await getDb();
  return db.select({ userId: schema.projectMembers.userId, role: schema.projectMembers.role, createdAt: schema.projectMembers.createdAt,
    name: schema.users.name, email: schema.users.email }).from(schema.projectMembers)
    .innerJoin(schema.users, eq(schema.users.id, schema.projectMembers.userId)).where(eq(schema.projectMembers.projectId, projectId));
}

export async function setProjectMemberRole(userId: string, projectId: string, memberId: string, role: MemberRole) {
  await requireProjectRole(userId, projectId, "owner");
  if (memberId === userId) throw notFound("Member not found");
  const parsed = memberRole.parse(role);
  const db = await getDb();
  await db.transaction(async tx => {
    const rows = await tx.update(schema.projectMembers).set({ role: parsed }).where(and(eq(schema.projectMembers.projectId, projectId), eq(schema.projectMembers.userId, memberId))).returning({ id: schema.projectMembers.userId });
    if (!rows.length) throw notFound("Member not found");
    if (parsed === "viewer") await cancelMemberWork(tx, projectId, memberId);
  });
  await audit(userId, "project.member.role", projectId, { memberId, role: parsed });
}

export async function removeProjectMember(userId: string, projectId: string, memberId: string) {
  await requireProjectRole(userId, projectId, "owner");
  if (memberId === userId) throw notFound("Member not found");
  const db = await getDb();
  await db.transaction(async (tx) => {
    const member = await tx.select({ email: schema.users.email }).from(schema.projectMembers)
      .innerJoin(schema.users, eq(schema.users.id, schema.projectMembers.userId))
      .where(and(eq(schema.projectMembers.projectId, projectId), eq(schema.projectMembers.userId, memberId))).get();
    if (!member) throw notFound("Member not found");
    await tx.delete(schema.projectMembers).where(and(eq(schema.projectMembers.projectId, projectId), eq(schema.projectMembers.userId, memberId)));
    await cancelMemberWork(tx, projectId, memberId);
    await tx.delete(schema.projectInvitations).where(and(
      eq(schema.projectInvitations.projectId, projectId),
      or(eq(schema.projectInvitations.invitedUserId, memberId), member.email ? eq(schema.projectInvitations.email, normaliseEmail(member.email)) : undefined),
      isNull(schema.projectInvitations.acceptedAt)
    ));
  });
  await audit(userId, "project.member.remove", projectId, { memberId });
}
