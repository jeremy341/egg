import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { randomBytes, randomUUID } from "node:crypto";
import { audit } from "@/server/audit";
import { config } from "@/server/config";
import { sha256Hex } from "@/server/crypto";
import { getDb, schema } from "@/server/db";
import type { OrgRole } from "@/server/db/schema";
import { mailConfigured, sendMail } from "@/server/mail";
import { HttpError, notFound } from "@/server/http";
import { assertOrgRole, orgRoleOf } from "@/server/organizations";

/**
 * Email invitations to an organization.
 *
 * - The token is 32 random bytes. Only its SHA-256 is stored, so the database
 *   never holds a usable link.
 * - With no email transport configured, the link is returned once, to the
 *   inviting admin, and cannot be read back later. Resending issues a new token
 *   and kills the old link.
 * - A token works once: acceptedAt is set in the same conditional UPDATE that
 *   checks the invitation is still valid, so two concurrent accepts cannot both win.
 * - It expires after 7 days and dies when cancelled.
 * - Accepting requires a signed-in account whose verified email matches the
 *   invited address. The token alone is not enough.
 */
export const INVITATION_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type InvitationDelivery = { delivery: "email" } | { delivery: "link"; link: string };

export type IssuedInvitation = InvitationDelivery & {
  id: string;
  email: string;
  role: OrgRole;
  expiresAt: Date;
};

function newToken(): string {
  return randomBytes(32).toString("base64url");
}

function linkFor(token: string): string {
  return `${config().APP_URL.replace(/\/$/, "")}/invite/${token}`;
}

function normalizeEmail(input: string): string {
  const email = input.trim().toLowerCase();
  if (email.length > 254 || !EMAIL_RE.test(email)) throw new HttpError(400, "Enter a valid email address.", "invalid");
  return email;
}

/** Send the link by email when a transport exists. Otherwise, or if sending fails, return it once. */
async function deliver(to: string, orgName: string, token: string): Promise<InvitationDelivery> {
  const link = linkFor(token);
  if (mailConfigured()) {
    const sent = await sendMail({
      to,
      subject: `You are invited to ${orgName} on Egg`,
      text: `You have been invited to join ${orgName} on Egg.\n\nAccept within ${INVITATION_DAYS} days by opening this link while signed in with ${to}:\n${link}\n`,
    });
    if (sent) return { delivery: "email" };
  }
  return { delivery: "link", link };
}

async function orgName(orgId: string): Promise<string> {
  const db = await getDb();
  const row = await db.select({ name: schema.organizations.name }).from(schema.organizations).where(eq(schema.organizations.id, orgId)).get();
  if (!row) throw notFound("Organization not found");
  return row.name;
}

async function findInvitation(invitationId: string) {
  const db = await getDb();
  const row = await db.select().from(schema.invitations).where(eq(schema.invitations.id, invitationId)).get();
  if (!row) throw notFound("Invitation not found");
  return row;
}

/** Invite by email. Owners can grant any role; admins can grant admin, member or guest. */
export async function createInvitation(
  actorId: string,
  orgId: string,
  input: { email: string; role: OrgRole },
  now = new Date()
): Promise<IssuedInvitation> {
  const actorRole = await assertOrgRole(actorId, orgId, "admin");
  if (input.role === "owner" && actorRole !== "owner") throw new HttpError(403, "Only an owner can invite an owner.", "forbidden");
  const email = normalizeEmail(input.email);

  const db = await getDb();
  const existing = await db
    .select({ userId: schema.orgMembers.userId })
    .from(schema.orgMembers)
    .innerJoin(schema.users, eq(schema.users.id, schema.orgMembers.userId))
    .where(and(eq(schema.orgMembers.orgId, orgId), sql`lower(${schema.users.email}) = ${email}`))
    .get();
  if (existing) throw new HttpError(409, "That person is already a member of this organization.", "conflict");

  const token = newToken();
  const id = randomUUID();
  const expiresAt = new Date(now.getTime() + INVITATION_DAYS * DAY_MS);
  await db.insert(schema.invitations).values({
    id,
    orgId,
    email,
    role: input.role,
    tokenHash: sha256Hex(token),
    invitedBy: actorId,
    expiresAt,
    createdAt: now,
    updatedAt: now,
  });
  const delivery = await deliver(email, await orgName(orgId), token);
  await audit(actorId, "org.invite", id, { role: input.role, delivery: delivery.delivery }, { level: "organization", orgId });
  return { id, email, role: input.role, expiresAt, ...delivery };
}

/** Issue a fresh token for a pending invitation. The old link stops working at once. */
export async function resendInvitation(actorId: string, invitationId: string, now = new Date()): Promise<IssuedInvitation> {
  const row = await findInvitation(invitationId);
  await assertOrgRole(actorId, row.orgId, "admin");
  if (row.acceptedAt) throw new HttpError(409, "This invitation was already accepted.", "conflict");
  if (row.cancelledAt) throw new HttpError(409, "This invitation was cancelled.", "conflict");

  const token = newToken();
  const expiresAt = new Date(now.getTime() + INVITATION_DAYS * DAY_MS);
  const db = await getDb();
  await db
    .update(schema.invitations)
    .set({ tokenHash: sha256Hex(token), expiresAt, updatedAt: now })
    .where(eq(schema.invitations.id, row.id));
  const delivery = await deliver(row.email, await orgName(row.orgId), token);
  await audit(actorId, "org.invite.resend", row.id, { delivery: delivery.delivery }, { level: "organization", orgId: row.orgId });
  return { id: row.id, email: row.email, role: row.role, expiresAt, ...delivery };
}

export async function cancelInvitation(actorId: string, invitationId: string, now = new Date()): Promise<void> {
  const row = await findInvitation(invitationId);
  await assertOrgRole(actorId, row.orgId, "admin");
  if (row.acceptedAt) throw new HttpError(409, "This invitation was already accepted.", "conflict");
  const db = await getDb();
  await db
    .update(schema.invitations)
    .set({ cancelledAt: row.cancelledAt ?? now, updatedAt: now })
    .where(eq(schema.invitations.id, row.id));
  await audit(actorId, "org.invite.cancel", row.id, undefined, { level: "organization", orgId: row.orgId });
}

/** Every invitation for an organization, newest first. Admins only. Never includes a token or link. */
export async function listInvitations(actorId: string, orgId: string) {
  await assertOrgRole(actorId, orgId, "admin");
  const db = await getDb();
  return db
    .select({
      id: schema.invitations.id,
      email: schema.invitations.email,
      role: schema.invitations.role,
      expiresAt: schema.invitations.expiresAt,
      acceptedAt: schema.invitations.acceptedAt,
      cancelledAt: schema.invitations.cancelledAt,
      createdAt: schema.invitations.createdAt,
    })
    .from(schema.invitations)
    .where(eq(schema.invitations.orgId, orgId))
    .orderBy(desc(schema.invitations.createdAt));
}

/** Invitations that can still be accepted: not accepted, not cancelled, not expired. Admins only. */
export async function pendingInvitations(actorId: string, orgId: string, now = new Date()) {
  const rows = await listInvitations(actorId, orgId);
  return rows.filter((r) => !r.acceptedAt && !r.cancelledAt && r.expiresAt.getTime() > now.getTime());
}

/** An invitation id from another organization is not found here. Call after the caller's role check. */
export async function assertInvitationInOrg(invitationId: string, orgId: string): Promise<void> {
  const row = await findInvitation(invitationId);
  if (row.orgId !== orgId) throw notFound("Invitation not found");
}

export type AcceptResult = { orgId: string; role: OrgRole };

/** Accept with the token from the link, while signed in with the invited email address. */
export async function acceptInvitation(userId: string, token: string, now = new Date()): Promise<AcceptResult> {
  const db = await getDb();
  const row = await db.select().from(schema.invitations).where(eq(schema.invitations.tokenHash, sha256Hex(token))).get();
  if (!row) throw notFound("Invitation not found");

  const user = await db
    .select({ email: schema.users.email, emailVerified: schema.users.emailVerified })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .get();
  if (!user?.email || user.email.trim().toLowerCase() !== row.email) {
    throw new HttpError(403, "This invitation was sent to a different email address.", "forbidden");
  }
  // An unverified address proves nothing about who is signed in.
  if (!user.emailVerified) throw new HttpError(403, "Verify your email address before accepting an invitation.", "forbidden");
  if (row.acceptedAt) throw new HttpError(410, "This invitation was already used.", "gone");
  if (row.cancelledAt) throw new HttpError(410, "This invitation was cancelled.", "gone");
  if (row.expiresAt.getTime() <= now.getTime()) throw new HttpError(410, "This invitation has expired. Ask for a new one.", "gone");

  let won = false;
  await db.transaction(async (tx) => {
    const claimed = await tx
      .update(schema.invitations)
      .set({ acceptedAt: now, acceptedBy: userId, updatedAt: now })
      .where(
        and(
          eq(schema.invitations.id, row.id),
          isNull(schema.invitations.acceptedAt),
          isNull(schema.invitations.cancelledAt),
          sql`${schema.invitations.expiresAt} > ${now.getTime()}`
        )
      )
      .returning({ id: schema.invitations.id });
    if (claimed.length !== 1) return;
    won = true;
    // An existing member keeps their current role. Accepting never demotes anyone.
    await tx.insert(schema.orgMembers).values({ orgId: row.orgId, userId, role: row.role, createdAt: now }).onConflictDoNothing();
  });
  if (!won) throw new HttpError(410, "This invitation was already used.", "gone");

  const role = (await orgRoleOf(userId, row.orgId)) ?? row.role;
  await audit(userId, "org.join", row.orgId, { role: row.role }, { level: "organization", orgId: row.orgId });
  return { orgId: row.orgId, role };
}
