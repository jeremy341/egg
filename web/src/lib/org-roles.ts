/**
 * Which organization controls to show for a role. This only hides buttons; the
 * server checks every one of these rules again on each request.
 */
export type OrgRoleName = "owner" | "admin" | "member" | "guest";

export const ORG_ROLE_LABELS: Record<OrgRoleName, string> = {
  owner: "Owner",
  admin: "Admin",
  member: "Member",
  guest: "Guest",
};

/** Roles an actor may hand out: owners any role, admins admin, member and guest. */
export function assignableRoles(actor: OrgRoleName): OrgRoleName[] {
  if (actor === "owner") return ["owner", "admin", "member", "guest"];
  if (actor === "admin") return ["admin", "member", "guest"];
  return [];
}

/** Only owners change roles. */
export function canChangeRoles(actor: OrgRoleName): boolean {
  return actor === "owner";
}

/** Owners remove anyone else. Admins remove members and guests only. Nobody removes themselves here. */
export function canRemoveMember(actor: OrgRoleName, target: OrgRoleName, isSelf: boolean): boolean {
  if (isSelf) return false;
  if (actor === "owner") return true;
  if (actor === "admin") return target === "member" || target === "guest";
  return false;
}

/** Admins and owners invite and manage invitations. */
export function canInvite(actor: OrgRoleName): boolean {
  return actor === "owner" || actor === "admin";
}
