import { and, eq, sql } from "drizzle-orm";
import { audit } from "@/server/audit";
import { getDb, schema } from "@/server/db";
import { PROJECT_ROLES, type ProjectRole } from "@/server/db/schema";
import { HttpError, notFound } from "@/server/http";
import { orgRoleOf } from "@/server/organizations";
import { assertProjectAccess } from "@/server/permissions";

/**
 * Project members, with the roles from permissions.ts: admin (everything),
 * member (view and edit), viewer (view). Only a project admin manages members.
 * On an organization project the person must already belong to the organization;
 * removing them from the organization removes their access regardless.
 */

export type ProjectMemberRow = { userId: string; name: string; email: string | null; role: ProjectRole; addedAt: Date };

function isProjectRole(role: string): role is ProjectRole {
  return (PROJECT_ROLES as readonly string[]).includes(role);
}

async function projectRow(projectId: string) {
  const db = await getDb();
  const row = await db
    .select({ id: schema.projects.id, owner: schema.projects.userId, orgId: schema.projects.orgId })
    .from(schema.projects)
    .where(eq(schema.projects.id, projectId))
    .get();
  if (!row) throw notFound("Project not found");
  return row;
}

/** Everyone with a project role. Anyone who can view the project can see the list. */
export async function listProjectMembers(actorId: string, projectId: string): Promise<ProjectMemberRow[]> {
  await assertProjectAccess(actorId, projectId, "view");
  const db = await getDb();
  return db
    .select({
      userId: schema.projectMembers.userId,
      name: schema.users.name,
      email: schema.users.email,
      role: schema.projectMembers.role,
      addedAt: schema.projectMembers.createdAt,
    })
    .from(schema.projectMembers)
    .innerJoin(schema.users, eq(schema.users.id, schema.projectMembers.userId))
    .where(eq(schema.projectMembers.projectId, projectId))
    .orderBy(schema.projectMembers.createdAt);
}

/**
 * Add a person by their account email. Unknown email: 404. The owner cannot be
 * added (they already have every level). On an organization project the person
 * must already be in the organization.
 */
export async function addProjectMember(
  actorId: string,
  projectId: string,
  input: { email: string; role: string },
  now = new Date()
): Promise<{ userId: string; role: ProjectRole }> {
  await assertProjectAccess(actorId, projectId, "admin");
  if (!isProjectRole(input.role)) throw new HttpError(400, "Unknown project role.", "invalid");
  const project = await projectRow(projectId);
  const email = input.email.trim().toLowerCase();
  const db = await getDb();
  const target = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(sql`lower(${schema.users.email}) = ${email}`)
    .get();
  if (!target) throw notFound("No account has that email address.");
  if (target.id === project.owner) throw new HttpError(400, "That person already owns this project.", "invalid");
  if (project.orgId !== null && (await orgRoleOf(target.id, project.orgId)) === null) {
    throw new HttpError(400, "Add this person to the organization first.", "invalid");
  }
  const existing = await db
    .select({ role: schema.projectMembers.role })
    .from(schema.projectMembers)
    .where(and(eq(schema.projectMembers.projectId, projectId), eq(schema.projectMembers.userId, target.id)))
    .get();
  if (existing) throw new HttpError(409, "That person already has a role on this project. Change it instead.", "conflict");

  await db.insert(schema.projectMembers).values({ projectId, userId: target.id, role: input.role, createdAt: now });
  await audit(actorId, "project.member.add", projectId, { user: target.id, role: input.role });
  return { userId: target.id, role: input.role };
}

async function memberRole(projectId: string, userId: string): Promise<ProjectRole> {
  const db = await getDb();
  const row = await db
    .select({ role: schema.projectMembers.role })
    .from(schema.projectMembers)
    .where(and(eq(schema.projectMembers.projectId, projectId), eq(schema.projectMembers.userId, userId)))
    .get();
  if (!row) throw notFound("Member not found");
  return row.role;
}

export async function changeProjectMemberRole(actorId: string, projectId: string, userId: string, role: string): Promise<void> {
  await assertProjectAccess(actorId, projectId, "admin");
  if (!isProjectRole(role)) throw new HttpError(400, "Unknown project role.", "invalid");
  const before = await memberRole(projectId, userId);
  if (before === role) return;
  const db = await getDb();
  await db
    .update(schema.projectMembers)
    .set({ role })
    .where(and(eq(schema.projectMembers.projectId, projectId), eq(schema.projectMembers.userId, userId)));
  await audit(actorId, "project.member.role", projectId, { user: userId, from: before, to: role });
}

export async function removeProjectMember(actorId: string, projectId: string, userId: string): Promise<void> {
  await assertProjectAccess(actorId, projectId, "admin");
  const role = await memberRole(projectId, userId);
  const db = await getDb();
  await db
    .delete(schema.projectMembers)
    .where(and(eq(schema.projectMembers.projectId, projectId), eq(schema.projectMembers.userId, userId)));
  await audit(actorId, "project.member.remove", projectId, { user: userId, role });
}
