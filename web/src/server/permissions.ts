import { and, eq } from "drizzle-orm";
import { audit } from "@/server/audit";
import { getDb, schema } from "@/server/db";
import type { OrgRole, ProjectRole } from "@/server/db/schema";
import { HttpError, notFound } from "@/server/http";

/**
 * Per-server container permissions. Each switch is an opt-in for one of the
 * container features. The server enforces them; the UI only hides what is off.
 *
 * Defaults: every switch is OFF until the owner turns it on, for any server
 * connected from now on. The terminal is a root shell, a file write can change
 * the code the app runs on its next restart, and leftover removal deletes
 * services and folders. File changes were turned off for every existing server
 * once, by migration 0008. After that each switch keeps the value its owner set:
 * a column default only applies to new rows.
 * The guards in permission-guards.ts read the stored value on each request, so a
 * switch that is off stops the very next call. (The browser terminal input and
 * resize routes do not call a guard yet; see docs/design/permissions.md.)
 *
 * Turning the terminal or file changes ON needs a Hack Club sign-in from the last
 * few minutes (see `isFreshAuth` in auth/session.ts). That check is made by the
 * permissions route. Turning a switch off never needs it.
 */
export type ContainerPermission = "terminal" | "fileWrites" | "orphanRemoval";

export type ContainerPermissions = {
  terminal: boolean;
  fileWrites: boolean;
  orphanRemoval: boolean;
};

const COLUMN = {
  terminal: "allowTerminal",
  fileWrites: "allowFileWrites",
  orphanRemoval: "allowOrphanRemoval",
} as const;

const MESSAGE: Record<ContainerPermission, string> = {
  terminal: "The terminal is turned off for this server. Turn it on in Account, under Container permissions.",
  fileWrites: "Changing files is turned off for this server. Turn it on in Account, under Container permissions.",
  orphanRemoval: "Removing leftovers is turned off for this server. Turn it on in Account, under Container permissions.",
};

export function permissionsOf(row: {
  allowTerminal: boolean;
  allowFileWrites: boolean;
  allowOrphanRemoval: boolean;
}): ContainerPermissions {
  return {
    terminal: row.allowTerminal,
    fileWrites: row.allowFileWrites,
    orphanRemoval: row.allowOrphanRemoval,
  };
}

/** Read one server's permissions, only for its owner. Unknown or foreign servers are 404. */
export async function getPermissions(userId: string, serverId: string): Promise<ContainerPermissions> {
  const db = await getDb();
  const row = await db
    .select()
    .from(schema.servers)
    .where(and(eq(schema.servers.id, serverId), eq(schema.servers.userId, userId)))
    .get();
  if (!row) throw notFound("Server not found");
  return permissionsOf(row);
}

/** Throw 403 when the owner has switched this feature off. Call before any SSH work. */
export function assertAllowed(perms: ContainerPermissions, feature: ContainerPermission): void {
  if (perms[feature] !== true) throw new HttpError(403, MESSAGE[feature], "disabled");
}

/** Change one or more switches. Only the owner can, and each change is audited by name only. */
export async function setPermissions(
  userId: string,
  serverId: string,
  patch: Partial<ContainerPermissions>
): Promise<ContainerPermissions> {
  const db = await getDb();
  const row = await db
    .select()
    .from(schema.servers)
    .where(and(eq(schema.servers.id, serverId), eq(schema.servers.userId, userId)))
    .get();
  if (!row) throw notFound("Server not found");

  const values: Partial<Record<(typeof COLUMN)[ContainerPermission], boolean>> = {};
  for (const key of Object.keys(COLUMN) as ContainerPermission[]) {
    if (typeof patch[key] === "boolean") values[COLUMN[key]] = patch[key];
  }
  if (Object.keys(values).length > 0) {
    await db.update(schema.servers).set(values).where(eq(schema.servers.id, row.id));
    await audit(userId, "container.permissions", row.id, {
      changed: Object.keys(values).map((c) => c.replace(/^allow/, "")).join(", "),
    });
  }
  return getPermissions(userId, serverId);
}

/*
 * Project access from roles. Three levels, in order:
 *   view  - see the project and its deployments
 *   edit  - change settings, env vars, deploy
 *   admin - manage members, transfer ownership, move or delete the project
 *
 * Who gets what (decided in projectAccess, tested in permissions-access.test.ts):
 *   - the project owner (projects.user_id) has every level;
 *   - an organization owner or admin has every level on each project in that org;
 *   - an organization member or guest has only what their project role gives:
 *     admin = all three, member = view and edit, viewer = view;
 *   - a project with an org needs an org membership at all: a project role
 *     alone does not survive removal from the organization;
 *   - a personal project (no org) is reachable only by its owner and by project
 *     members, where a project role applies directly.
 * Anyone else gets nothing. Callers answer "not found" for no view, so a
 * private project's existence is not revealed.
 */
export type ProjectLevel = "view" | "edit" | "admin";

export type ProjectAccess = Record<ProjectLevel, boolean>;

export type ProjectAccessInput = {
  /** True when the user is the project's owner. */
  isOwner: boolean;
  /** Whether the project belongs to an organization. */
  hasOrg: boolean;
  /** The user's organization role in the project's org, or null when not a member. */
  orgRole: OrgRole | null;
  /** The user's project role, or null when they have none. */
  projectRole: ProjectRole | null;
};

const NONE: ProjectAccess = { view: false, edit: false, admin: false };
const ALL: ProjectAccess = { view: true, edit: true, admin: true };
const EDIT: ProjectAccess = { view: true, edit: true, admin: false };
const VIEW: ProjectAccess = { view: true, edit: false, admin: false };

/** Pure: the access a user has to one project, given their roles. */
export function projectAccess(input: ProjectAccessInput): ProjectAccess {
  if (input.isOwner) return ALL;
  if (input.hasOrg) {
    if (input.orgRole === "owner" || input.orgRole === "admin") return ALL;
    // Members and guests need a project role, and only while they stay in the org.
    if (input.orgRole === null) return NONE;
  }
  switch (input.projectRole) {
    case "admin":
      return ALL;
    case "member":
      return EDIT;
    case "viewer":
      return VIEW;
    default:
      return NONE;
  }
}

export const canViewProject = (access: ProjectAccess) => access.view;
export const canEditProject = (access: ProjectAccess) => access.edit;
export const canAdminProject = (access: ProjectAccess) => access.admin;

/** Load the user's roles for one project and decide. Unknown project: no access. */
export async function resolveProjectAccess(userId: string, projectId: string): Promise<ProjectAccess> {
  const db = await getDb();
  const project = await db
    .select({ owner: schema.projects.userId, orgId: schema.projects.orgId })
    .from(schema.projects)
    .where(eq(schema.projects.id, projectId))
    .get();
  if (!project) return NONE;

  const orgRole = project.orgId
    ? (
        await db
          .select({ role: schema.orgMembers.role })
          .from(schema.orgMembers)
          .where(and(eq(schema.orgMembers.orgId, project.orgId), eq(schema.orgMembers.userId, userId)))
          .get()
      )?.role ?? null
    : null;
  const projectRole =
    (
      await db
        .select({ role: schema.projectMembers.role })
        .from(schema.projectMembers)
        .where(and(eq(schema.projectMembers.projectId, projectId), eq(schema.projectMembers.userId, userId)))
        .get()
    )?.role ?? null;

  return projectAccess({
    isOwner: project.owner === userId,
    hasOrg: project.orgId !== null,
    orgRole,
    projectRole,
  });
}

/**
 * Server-side gate for a project action. No view: 404, the same as a missing
 * project. View but not enough for `need`: 403.
 */
export async function assertProjectAccess(userId: string, projectId: string, need: ProjectLevel): Promise<ProjectAccess> {
  const access = await resolveProjectAccess(userId, projectId);
  if (!canViewProject(access)) throw notFound("Project not found");
  if (!access[need]) throw new HttpError(403, `You need ${need} access to this project.`, "forbidden");
  return access;
}
