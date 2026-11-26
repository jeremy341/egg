import { and, eq, inArray } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import { audit } from "@/server/audit";
import { getDb, schema } from "@/server/db";
import { ORG_ROLES, type OrgRole } from "@/server/db/schema";
import { HttpError, notFound } from "@/server/http";

/** Higher number, more power. Used for "at least admin" checks. */
const RANK: Record<OrgRole, number> = { guest: 0, member: 1, admin: 2, owner: 3 };

export function orgRoleAtLeast(role: OrgRole | null, minimum: OrgRole): boolean {
  return role !== null && RANK[role] >= RANK[minimum];
}

export async function orgRoleOf(userId: string, orgId: string): Promise<OrgRole | null> {
  const db = await getDb();
  const row = await db
    .select({ role: schema.orgMembers.role })
    .from(schema.orgMembers)
    .where(and(eq(schema.orgMembers.orgId, orgId), eq(schema.orgMembers.userId, userId)))
    .get();
  return row?.role ?? null;
}

/**
 * Gate for organization actions. Not a member: 404 (the organization is not
 * revealed). A member below `minimum`: 403.
 */
export async function assertOrgRole(userId: string, orgId: string, minimum: OrgRole): Promise<OrgRole> {
  const role = await orgRoleOf(userId, orgId);
  if (role === null) throw notFound("Organization not found");
  if (!orgRoleAtLeast(role, minimum)) throw new HttpError(403, `You need the ${minimum} role in this organization.`, "forbidden");
  return role;
}

export function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return base || "org";
}

function cleanName(name: string): string {
  const trimmed = name.trim();
  if (trimmed.length < 1 || trimmed.length > 80) throw new HttpError(400, "Organization name must be 1 to 80 characters.", "invalid");
  return trimmed;
}

/** Create an organization. The creator becomes its owner. */
export async function createOrganization(userId: string, name: string, now = new Date()): Promise<{ id: string; slug: string }> {
  const trimmed = cleanName(name);
  const db = await getDb();
  const id = randomBytes(12).toString("hex");
  const slug = `${slugify(trimmed)}-${id.slice(0, 6)}`;
  await db.transaction(async (tx) => {
    await tx.insert(schema.organizations).values({ id, name: trimmed, slug, ownerId: userId, createdAt: now, updatedAt: now });
    await tx.insert(schema.orgMembers).values({ orgId: id, userId, role: "owner", createdAt: now });
  });
  await audit(userId, "org.create", id, undefined, { level: "organization", orgId: id });
  return { id, slug };
}

export type OrgSummary = { id: string; name: string; slug: string; role: OrgRole; createdAt: Date };

/** The organizations the user belongs to, with their role in each. */
export async function listOrganizationsFor(userId: string): Promise<OrgSummary[]> {
  const db = await getDb();
  return db
    .select({
      id: schema.organizations.id,
      name: schema.organizations.name,
      slug: schema.organizations.slug,
      role: schema.orgMembers.role,
      createdAt: schema.organizations.createdAt,
    })
    .from(schema.orgMembers)
    .innerJoin(schema.organizations, eq(schema.organizations.id, schema.orgMembers.orgId))
    .where(eq(schema.orgMembers.userId, userId))
    .orderBy(schema.organizations.name);
}

/** One organization, for any member (guests included). Non-members get 404. */
export async function getOrganizationFor(userId: string, orgId: string): Promise<OrgSummary> {
  const role = await assertOrgRole(userId, orgId, "guest");
  const db = await getDb();
  const org = await db
    .select({
      id: schema.organizations.id,
      name: schema.organizations.name,
      slug: schema.organizations.slug,
      createdAt: schema.organizations.createdAt,
    })
    .from(schema.organizations)
    .where(eq(schema.organizations.id, orgId))
    .get();
  if (!org) throw notFound("Organization not found");
  return { ...org, role };
}

/** Rename an organization. Owners and admins. */
export async function updateOrganizationName(actorId: string, orgId: string, name: string, now = new Date()): Promise<void> {
  await assertOrgRole(actorId, orgId, "admin");
  const trimmed = cleanName(name);
  const db = await getDb();
  await db.update(schema.organizations).set({ name: trimmed, updatedAt: now }).where(eq(schema.organizations.id, orgId));
  await audit(actorId, "org.rename", orgId, undefined, { level: "organization", orgId });
}

export type OrgMemberRow = { userId: string; name: string; email: string | null; role: OrgRole; joinedAt: Date };

/** Everyone in an organization. Any member can see the list; guests included. */
export async function listOrgMembers(actorId: string, orgId: string): Promise<OrgMemberRow[]> {
  await assertOrgRole(actorId, orgId, "guest");
  const db = await getDb();
  return db
    .select({
      userId: schema.orgMembers.userId,
      name: schema.users.name,
      email: schema.users.email,
      role: schema.orgMembers.role,
      joinedAt: schema.orgMembers.createdAt,
    })
    .from(schema.orgMembers)
    .innerJoin(schema.users, eq(schema.users.id, schema.orgMembers.userId))
    .where(eq(schema.orgMembers.orgId, orgId))
    .orderBy(schema.orgMembers.createdAt);
}

async function memberRow(orgId: string, userId: string) {
  const db = await getDb();
  const row = await db
    .select({ role: schema.orgMembers.role })
    .from(schema.orgMembers)
    .where(and(eq(schema.orgMembers.orgId, orgId), eq(schema.orgMembers.userId, userId)))
    .get();
  if (!row) throw notFound("Member not found");
  return row;
}

async function countOwners(orgId: string): Promise<number> {
  const db = await getDb();
  const rows = await db
    .select({ userId: schema.orgMembers.userId })
    .from(schema.orgMembers)
    .where(and(eq(schema.orgMembers.orgId, orgId), eq(schema.orgMembers.role, "owner")));
  return rows.length;
}

/** Projects the person owns in this organization. They must hand them over before leaving or being removed. */
async function ownedProjectCount(orgId: string, userId: string): Promise<number> {
  const db = await getDb();
  const rows = await db
    .select({ id: schema.projects.id })
    .from(schema.projects)
    .where(and(eq(schema.projects.orgId, orgId), eq(schema.projects.userId, userId)));
  return rows.length;
}

/** Change a member's role. Owners only. The organization always keeps at least one owner. */
export async function changeMemberRole(actorId: string, orgId: string, targetId: string, role: OrgRole): Promise<void> {
  await assertOrgRole(actorId, orgId, "owner");
  if (!(ORG_ROLES as readonly string[]).includes(role)) throw new HttpError(400, "Unknown role.", "invalid");
  const target = await memberRow(orgId, targetId);
  if (target.role === role) return;
  if (target.role === "owner" && (await countOwners(orgId)) <= 1) {
    throw new HttpError(409, "An organization needs at least one owner. Make someone else an owner first.", "conflict");
  }
  const db = await getDb();
  await db
    .update(schema.orgMembers)
    .set({ role })
    .where(and(eq(schema.orgMembers.orgId, orgId), eq(schema.orgMembers.userId, targetId)));
  await audit(actorId, "org.member.role", targetId, { from: target.role, to: role }, { level: "organization", orgId });
}

/** Delete the membership and any project roles the person held in this organization's projects. */
async function dropMembership(orgId: string, userId: string): Promise<void> {
  const db = await getDb();
  await db.transaction(async (tx) => {
    const orgProjectIds = tx.select({ id: schema.projects.id }).from(schema.projects).where(eq(schema.projects.orgId, orgId));
    await tx
      .delete(schema.projectMembers)
      .where(and(eq(schema.projectMembers.userId, userId), inArray(schema.projectMembers.projectId, orgProjectIds)));
    await tx.delete(schema.orgMembers).where(and(eq(schema.orgMembers.orgId, orgId), eq(schema.orgMembers.userId, userId)));
  });
}

/**
 * Remove someone from the organization. Owners can remove anyone. Admins can
 * remove members and guests only. Nobody removes themselves here (use leave).
 */
export async function removeOrgMember(actorId: string, orgId: string, targetId: string): Promise<void> {
  const actorRole = await assertOrgRole(actorId, orgId, "admin");
  if (targetId === actorId) throw new HttpError(400, "Use leave to remove yourself.", "invalid");
  const target = await memberRow(orgId, targetId);
  if (actorRole !== "owner" && RANK[target.role] >= RANK.admin) {
    throw new HttpError(403, "Only an owner can remove an admin or an owner.", "forbidden");
  }
  if (target.role === "owner" && (await countOwners(orgId)) <= 1) {
    throw new HttpError(409, "An organization needs at least one owner. Make someone else an owner first.", "conflict");
  }
  if ((await ownedProjectCount(orgId, targetId)) > 0) {
    throw new HttpError(409, "This person owns projects in the organization. Transfer or move them first.", "conflict");
  }
  await dropMembership(orgId, targetId);
  await audit(actorId, "org.member.remove", targetId, { role: target.role }, { level: "organization", orgId });
}

/**
 * Leave an organization. Owners cannot leave while they hold the owner role:
 * they make another member an owner (or step down, if another owner remains)
 * first. Owned projects must be handed over before leaving.
 */
export async function leaveOrganization(userId: string, orgId: string): Promise<void> {
  const member = await memberRow(orgId, userId);
  if (member.role === "owner") {
    throw new HttpError(409, "Owners must hand over the owner role before leaving. Make another member an owner first.", "conflict");
  }
  if ((await ownedProjectCount(orgId, userId)) > 0) {
    throw new HttpError(409, "You own projects in this organization. Transfer or move them before leaving.", "conflict");
  }
  await dropMembership(orgId, userId);
  await audit(userId, "org.leave", orgId, undefined, { level: "organization", orgId });
}
