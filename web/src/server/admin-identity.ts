import { eq } from "drizzle-orm";
import { getDb, schema, type Db } from "@/server/db";

/**
 * The one account named in the environment. It is always an administrator and cannot be removed in the app,
 * so a lost database can still be recovered. Never infer it from a name or an email.
 */
export function instanceAdminId(): string | null {
  return process.env.SECURITY_REPORT_ADMIN_ID?.trim() || null;
}

/**
 * True for the configured account and for any account an administrator has granted.
 * This is the only admin check. Use it everywhere, and never compare ids directly.
 * Inside a write transaction, pass that transaction as `db`: a second connection would wait on the open write lock.
 */
export async function isInstanceAdmin(userId: string | null | undefined, db?: Pick<Db, "select">): Promise<boolean> {
  if (!userId) return false;
  const configured = instanceAdminId();
  if (configured && userId === configured) return true;
  const grant = await (db ?? (await getDb()))
    .select({ userId: schema.instanceAdmins.userId })
    .from(schema.instanceAdmins)
    .where(eq(schema.instanceAdmins.userId, userId))
    .get();
  return !!grant;
}
