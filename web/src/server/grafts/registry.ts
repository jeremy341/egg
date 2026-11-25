import { eq } from "drizzle-orm";
import { audit } from "@/server/audit";
import { getDb, schema } from "@/server/db";
import { isInstanceAdmin } from "@/server/admin-identity";
import { HttpError, notFound } from "@/server/http";

/**
 * This list is the complete set of code Egg can load as a graft. Install state
 * only turns these compiled modules on or off; database rows never name code,
 * import paths, routes, or executable configuration.
 */
export const FIRST_PARTY_GRAFTS = [
  {
    id: "announcements",
    name: "Announcements",
    description: "Publish instance-wide notices and let each person dismiss them.",
    href: "/grafts/announcements",
  },
  {
    id: "forum",
    name: "Forum",
    description: "Collect questions, bug reports, and ideas with replies and votes.",
    href: "/grafts/forum",
  },
  {
    id: "greenhouse",
    name: "Greenhouse",
    description: "Keep project workspaces, goals, branch references, and review notes together.",
    href: "/grafts/greenhouse",
  },
] as const;

export type GraftId = (typeof FIRST_PARTY_GRAFTS)[number]["id"];
export type GraftListing = (typeof FIRST_PARTY_GRAFTS)[number] & { enabled: boolean; changedAt: string | null };

const registryById = new Map<string, (typeof FIRST_PARTY_GRAFTS)[number]>(
  FIRST_PARTY_GRAFTS.map((graft) => [graft.id, graft])
);

export function isGraftId(value: string): value is GraftId {
  return registryById.has(value);
}

export function graftDescriptor(id: GraftId) {
  return registryById.get(id)!;
}

export async function listGrafts(): Promise<GraftListing[]> {
  const db = await getDb();
  const installed = await db.select().from(schema.graftInstallations);
  const byId = new Map(installed.map((row) => [row.graftId, row]));
  return FIRST_PARTY_GRAFTS.map((graft) => {
    const row = byId.get(graft.id);
    return {
      ...graft,
      enabled: row?.enabled === true,
      changedAt: row?.changedAt.toISOString() ?? null,
    };
  });
}

export async function graftIsEnabled(id: GraftId): Promise<boolean> {
  const db = await getDb();
  const row = await db
    .select({ enabled: schema.graftInstallations.enabled })
    .from(schema.graftInstallations)
    .where(eq(schema.graftInstallations.graftId, id))
    .get();
  return row?.enabled === true;
}

export async function requireGraftEnabled(id: GraftId): Promise<void> {
  if (!(await graftIsEnabled(id))) throw notFound("This Egg app is not enabled on this instance.");
}

export async function requireGraftAdmin(userId: string): Promise<void> {
  if (!(await isInstanceAdmin(userId))) {
    throw new HttpError(403, "Only an instance administrator can manage Egg apps.", "forbidden");
  }
}

export async function setGraftEnabled(actorId: string, id: GraftId, enabled: boolean): Promise<GraftListing> {
  await requireGraftAdmin(actorId);
  const db = await getDb();
  const current = await db
    .select({ enabled: schema.graftInstallations.enabled })
    .from(schema.graftInstallations)
    .where(eq(schema.graftInstallations.graftId, id))
    .get();
  if (current?.enabled !== enabled) {
    const now = new Date();
    await db
      .insert(schema.graftInstallations)
      .values({ graftId: id, enabled, changedBy: actorId, changedAt: now, createdAt: now })
      .onConflictDoUpdate({
        target: schema.graftInstallations.graftId,
        set: { enabled, changedBy: actorId, changedAt: now },
      });
    await audit(actorId, enabled ? "graft.enable" : "graft.disable", id, { name: graftDescriptor(id).name }, { level: "instance" });
  }
  return (await listGrafts()).find((graft) => graft.id === id)!;
}
