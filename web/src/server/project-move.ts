import { and, eq, inArray } from "drizzle-orm";
import { createHash } from "node:crypto";
import { audit } from "@/server/audit";
import { getDb, schema } from "@/server/db";
import type { OrgRole } from "@/server/db/schema";
import { HttpError, notFound } from "@/server/http";
import { orgRoleAtLeast, orgRoleOf } from "@/server/organizations";
import { assertProjectAccess, projectAccess, type ProjectAccess } from "@/server/permissions";

/**
 * Moving a project into or out of an organization changes who can reach it.
 * The move is two steps: `previewProjectMove` says what would change, and
 * `confirmProjectMove` applies it only if the preview is still the same. The
 * preview carries a digest; confirm recomputes and refuses on any difference,
 * so a stale screen cannot confirm a different change.
 */

export type LevelName = "admin" | "edit" | "view" | "none";

export type AccessChange = {
  userId: string;
  before: LevelName;
  after: LevelName;
  /** Why this person had access before: "owner", "org", or "project". */
  via: "owner" | "org" | "project";
};

export type MovePreview = {
  projectId: string;
  fromOrgId: string | null;
  toOrgId: string | null;
  /** People whose access would shrink. Gains are not listed. */
  losing: AccessChange[];
  /** Backups that would stop. This codebase has no backup feature yet, so this is always empty. */
  backups: { id: string; name: string }[];
  digest: string;
};

function levelOf(access: ProjectAccess): LevelName {
  if (access.admin) return "admin";
  if (access.edit) return "edit";
  if (access.view) return "view";
  return "none";
}

const RANK: Record<LevelName, number> = { none: 0, view: 1, edit: 2, admin: 3 };

/** Who may move a project: project admin, and admin+ in each organization the move touches (or the owner). */
async function assertMayMove(actorId: string, projectId: string, owner: string, fromOrgId: string | null, toOrgId: string | null) {
  await assertProjectAccess(actorId, projectId, "admin");
  if (fromOrgId !== null && actorId !== owner && !orgRoleAtLeast(await orgRoleOf(actorId, fromOrgId), "admin")) {
    throw new HttpError(403, "Only an owner or admin of the current organization can move this project out of it.", "forbidden");
  }
  if (toOrgId !== null && !orgRoleAtLeast(await orgRoleOf(actorId, toOrgId), "admin")) {
    throw new HttpError(403, "You need the admin role in the organization you are moving to.", "forbidden");
  }
}

/** Compute the preview. Pure reads; nothing is changed. */
export async function previewProjectMove(actorId: string, projectId: string, toOrgId: string | null): Promise<MovePreview> {
  const db = await getDb();
  const project = await db
    .select({ owner: schema.projects.userId, orgId: schema.projects.orgId })
    .from(schema.projects)
    .where(eq(schema.projects.id, projectId))
    .get();
  if (!project) throw notFound("Project not found");
  const fromOrgId = project.orgId;
  if (fromOrgId === toOrgId) throw new HttpError(400, "The project is already in that place.", "invalid");
  if (toOrgId !== null) {
    const target = await db.select({ id: schema.organizations.id }).from(schema.organizations).where(eq(schema.organizations.id, toOrgId)).get();
    // A target the actor cannot see looks the same as a missing one.
    if (!target) throw notFound("Organization not found");
  }
  await assertMayMove(actorId, projectId, project.owner, fromOrgId, toOrgId);

  // Everyone whose access could change: direct project members, and the source org's owners and admins.
  const projectRows = await db
    .select({ userId: schema.projectMembers.userId, role: schema.projectMembers.role })
    .from(schema.projectMembers)
    .where(eq(schema.projectMembers.projectId, projectId));
  const sourceAdmins =
    fromOrgId === null
      ? []
      : await db
          .select({ userId: schema.orgMembers.userId, role: schema.orgMembers.role })
          .from(schema.orgMembers)
          .where(and(eq(schema.orgMembers.orgId, fromOrgId), inArray(schema.orgMembers.role, ["owner", "admin"])));

  const projectRoleOf = new Map<string, "admin" | "member" | "viewer">();
  for (const row of projectRows) projectRoleOf.set(row.userId, row.role);
  const candidates = new Set<string>([...projectRoleOf.keys(), ...sourceAdmins.map((r) => r.userId)]);
  candidates.delete(project.owner);

  const orgRoleIn = async (orgId: string | null, userId: string): Promise<OrgRole | null> => {
    if (orgId === null) return null;
    return orgRoleOf(userId, orgId);
  };

  const losing: AccessChange[] = [];
  for (const userId of [...candidates].sort()) {
    const projectRole = projectRoleOf.get(userId) ?? null;
    const beforeRole = await orgRoleIn(fromOrgId, userId);
    const afterRole = await orgRoleIn(toOrgId, userId);
    const before = projectAccess({ isOwner: false, hasOrg: fromOrgId !== null, orgRole: beforeRole, projectRole });
    const after = projectAccess({ isOwner: false, hasOrg: toOrgId !== null, orgRole: afterRole, projectRole });
    if (RANK[levelOf(after)] < RANK[levelOf(before)]) {
      losing.push({
        userId,
        before: levelOf(before),
        after: levelOf(after),
        via: beforeRole === "owner" || beforeRole === "admin" ? "org" : "project",
      });
    }
  }

  const backups: { id: string; name: string }[] = [];
  const digest = createHash("sha256")
    .update(JSON.stringify({ projectId, fromOrgId, toOrgId, losing, backups }))
    .digest("hex");
  return { projectId, fromOrgId, toOrgId, losing, backups, digest };
}

/**
 * Apply the move, but only if the preview still matches. A changed digest means
 * someone's access or the org set changed since the preview was shown.
 */
export async function confirmProjectMove(
  actorId: string,
  projectId: string,
  toOrgId: string | null,
  digest: string,
  now = new Date()
): Promise<{ fromOrgId: string | null; toOrgId: string | null }> {
  const preview = await previewProjectMove(actorId, projectId, toOrgId);
  if (preview.digest !== digest) {
    throw new HttpError(409, "The access picture changed since you looked at it. Review the move again.", "conflict");
  }
  const db = await getDb();
  await db.update(schema.projects).set({ orgId: toOrgId, updatedAt: now }).where(eq(schema.projects.id, projectId));
  // Filed under the organization the project is leaving, or else the one it joins.
  await audit(
    actorId,
    "project.move",
    projectId,
    { from: preview.fromOrgId ?? "personal", to: toOrgId ?? "personal", losing: preview.losing.length },
    { level: "organization", orgId: preview.fromOrgId ?? toOrgId }
  );
  return { fromOrgId: preview.fromOrgId, toOrgId };
}
