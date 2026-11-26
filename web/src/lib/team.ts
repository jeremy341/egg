/**
 * What the Team page says and computes, with no React in it so it can be tested. The role descriptions follow the rules in
 * server/project-roles.ts and docs/backend-efficiency.md: a viewer reads, a developer also runs deployments, and the owner
 * alone keeps configuration, environment, credentials, deletion, files, the terminal and servers.
 */

export type MemberRole = "viewer" | "developer";
export type TeamRole = MemberRole | "owner";

export const ROLE_LABEL: Record<TeamRole, string> = {
  viewer: "Viewer",
  developer: "Developer",
  owner: "Owner",
};

/** One sentence per role: what it can do. */
export const ROLE_NOTE: Record<TeamRole, string> = {
  viewer: "Can read the project, its deployments, analytics and logs.",
  developer: "Can also deploy, redeploy, cancel, roll back and restart.",
  owner: "Also changes settings and environment variables, and uses files and the terminal.",
};

export const ROLES: readonly MemberRole[] = ["viewer", "developer"];

/** The server keeps an invitation for this long (INVITATION_TTL_MS in server/project-roles.ts). */
export const INVITE_DAYS = 7;
/** The most invitations a project can have open at once (the same check in createProjectInvitation). */
export const MAX_OPEN_INVITES = 20;

export type InvitationLike = { acceptedAt: string | null; expiresAt: string };

/** An invitation nobody has used and that has not run out. */
export function isOpenInvitation(invitation: InvitationLike, now: number): boolean {
  return invitation.acceptedAt === null && Date.parse(invitation.expiresAt) > now;
}

/** "Expires in 6 days", "Expires in 5 hours", "Expires in under an hour", or "Expired". */
export function expiryText(expiresAt: string, now: number): string {
  const left = Date.parse(expiresAt) - now;
  if (!(left > 0)) return "Expired";
  const hours = Math.floor(left / 3_600_000);
  if (hours < 1) return "Expires in under an hour";
  if (hours < 48) return `Expires in ${hours} hour${hours === 1 ? "" : "s"}`;
  // Nearest day, so an invitation made a moment ago, which lasts 7 days, does not read "6 days".
  return `Expires in ${Math.round(hours / 24)} days`;
}

/**
 * The link an owner sends. The token sits after the # so it never reaches a server log or a Referer header: the browser
 * does not send the fragment. The accept page reads it from there.
 */
export function inviteLink(origin: string, token: string): string {
  return `${origin.replace(/\/+$/, "")}/invite#token=${encodeURIComponent(token)}`;
}

/** The token in a location.hash such as "#token=abc", or null when there is none. */
export function tokenFromHash(hash: string): string | null {
  const params = new URLSearchParams(hash.replace(/^#/, ""));
  const token = params.get("token");
  return token && token.length <= 256 ? token : null;
}

/** The text under a failed accept. The server answers every refusal the same way, so this lists the real reasons. */
export const INVITE_REFUSED =
  "This invitation did not work. It may have expired, been used or revoked, or it was sent to a different account. " +
  "An invitation sent to an email address only works for a signed-in account with that email, verified.";
