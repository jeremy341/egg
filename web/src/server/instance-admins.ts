import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/server/db";
import { audit } from "@/server/audit";
import { HttpError } from "@/server/http";
import { instanceAdminId, isInstanceAdmin } from "@/server/admin-identity";

/**
 * Granting and removing administrators. Every change needs an administrator who signed in again recently,
 * and every change is recorded in the audit log. The account named in SECURITY_REPORT_ADMIN_ID cannot be removed.
 */

const emailInput = z.object({ email: z.string().trim().toLowerCase().email().max(254) });
const userIdInput = z.object({ userId: z.string().min(1).max(100) });

async function requireAdmin(actorId: string, freshSignIn: boolean): Promise<void> {
  if (!(await isInstanceAdmin(actorId))) {
    throw new HttpError(403, "Only an instance administrator can change administrators.", "forbidden");
  }
  if (!freshSignIn) {
    throw new HttpError(403, "Sign in with Hack Club again to change administrators.", "reauth_required");
  }
}

/** Everyone who administers the instance: the configured account first, then the granted ones. */
export async function listInstanceAdmins(actorId: string) {
  if (!(await isInstanceAdmin(actorId))) {
    throw new HttpError(403, "Only an instance administrator can see administrators.", "forbidden");
  }
  const db = await getDb();
  const granted = await db
    .select({
      userId: schema.instanceAdmins.userId,
      name: schema.users.name,
      email: schema.users.email,
      grantedAt: schema.instanceAdmins.grantedAt,
    })
    .from(schema.instanceAdmins)
    .innerJoin(schema.users, eq(schema.users.id, schema.instanceAdmins.userId))
    .orderBy(asc(schema.instanceAdmins.grantedAt));
  const configured = instanceAdminId();
  const owner = configured ? await db.select({ name: schema.users.name, email: schema.users.email })
    .from(schema.users).where(eq(schema.users.id, configured)).get() : undefined;
  return {
    configured: configured ? { userId: configured, name: owner?.name ?? null, email: owner?.email ?? null } : null,
    granted: granted.filter((g) => g.userId !== configured).map((g) => ({
      userId: g.userId,
      name: g.name,
      email: g.email,
      grantedAt: g.grantedAt.toISOString(),
    })),
  };
}

/**
 * Grant administration to the account whose verified email matches. Email is the only identifier an
 * administrator types, and only a verified address counts, so a typed address cannot claim someone else's account.
 */
export async function grantInstanceAdmin(actorId: string, raw: unknown, freshSignIn: boolean) {
  await requireAdmin(actorId, freshSignIn);
  const { email } = emailInput.parse(raw);
  const db = await getDb();
  const target = await db
    .select({ id: schema.users.id, name: schema.users.name })
    .from(schema.users)
    .where(and(eq(schema.users.email, email), eq(schema.users.emailVerified, true)))
    .get();
  if (!target) {
    throw new HttpError(404, "No account has signed in with that verified email yet.", "not_found");
  }
  const already = await isInstanceAdmin(target.id);
  if (already) return { userId: target.id, name: target.name, changed: false };

  await db.insert(schema.instanceAdmins).values({ userId: target.id, grantedBy: actorId, grantedAt: new Date() });
  await audit(actorId, "admin.grant", target.id);
  return { userId: target.id, name: target.name, changed: true };
}

/** Remove a granted administrator. The configured account is not in the grant table and is refused here. */
export async function revokeInstanceAdmin(actorId: string, raw: unknown, freshSignIn: boolean) {
  await requireAdmin(actorId, freshSignIn);
  const { userId } = userIdInput.parse(raw);
  if (userId === instanceAdminId()) {
    throw new HttpError(400, "The account set in SECURITY_REPORT_ADMIN_ID cannot be removed here.", "invalid");
  }
  const db = await getDb();
  const removed = await db
    .delete(schema.instanceAdmins)
    .where(eq(schema.instanceAdmins.userId, userId))
    .returning({ userId: schema.instanceAdmins.userId });
  if (removed.length === 0) return { userId, changed: false };
  await audit(actorId, "admin.revoke", userId);
  return { userId, changed: true };
}
