import { and, eq } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import { audit } from "@/server/audit";
import { getDb, schema } from "@/server/db";
import type { OrgRole } from "@/server/db/schema";
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

/** Create an organization. The creator becomes its owner. */
export async function createOrganization(userId: string, name: string, now = new Date()): Promise<{ id: string; slug: string }> {
  const trimmed = name.trim();
  if (trimmed.length < 1 || trimmed.length > 80) throw new HttpError(400, "Organization name must be 1 to 80 characters.", "invalid");
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
