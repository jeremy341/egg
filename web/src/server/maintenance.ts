import { eq } from "drizzle-orm";
import { z } from "zod";
import { audit } from "@/server/audit";
import { getDb, schema, type Db } from "@/server/db";
import { HttpError } from "@/server/http";
import { isInstanceAdmin } from "@/server/admin-identity";

const date = z.string().datetime({ offset: true }).nullable().optional();
const input = z.object({
  enabled: z.boolean(),
  message: z.string().trim().max(500).default(""),
  startsAt: date,
  endsAt: date,
});
export type MaintenanceState = {
  enabled: boolean;
  active: boolean;
  message: string;
  startsAt: string | null;
  endsAt: string | null;
  updatedAt: string | null;
};

export async function maintenanceState(now = new Date(), db?: Pick<Db, "select">): Promise<MaintenanceState> {
  const query = db ?? await getDb();
  const row = await query.select().from(schema.instanceSettings).where(eq(schema.instanceSettings.id, "maintenance")).get();
  if (!row) return { enabled: false, active: false, message: "", startsAt: null, endsAt: null, updatedAt: null };
  return {
    enabled: row.enabled,
    active: row.enabled && (!row.startsAt || row.startsAt <= now) && (!row.endsAt || row.endsAt > now),
    message: row.message,
    startsAt: row.startsAt?.toISOString() ?? null,
    endsAt: row.endsAt?.toISOString() ?? null,
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function maintenanceBlocksUser(userId: string | null | undefined, db?: Pick<Db, "select">): Promise<boolean> {
  if (isInstanceAdmin(userId)) return false;
  return (await maintenanceState(new Date(), db)).active;
}

export function maintenanceError(): HttpError {
  return new HttpError(503, "Egg is temporarily read-only for maintenance. You can keep viewing your data; try this action after maintenance ends.", "maintenance", { "Retry-After": "60" });
}

export async function saveMaintenance(userId: string, raw: unknown) {
  if (!isInstanceAdmin(userId)) throw new HttpError(403, "Only the configured instance administrator can change maintenance settings.", "forbidden");
  const parsed = input.parse(raw);
  const startsAt = parsed.startsAt ? new Date(parsed.startsAt) : null;
  const endsAt = parsed.endsAt ? new Date(parsed.endsAt) : null;
  if (endsAt && endsAt <= (startsAt ?? new Date())) throw new HttpError(400, "The end must be after the start and in the future.", "validation");
  const db = await getDb();
  const values = { id: "maintenance", enabled: parsed.enabled, message: parsed.message, startsAt, endsAt, updatedAt: new Date(), updatedBy: userId };
  await db.insert(schema.instanceSettings).values(values).onConflictDoUpdate({ target: schema.instanceSettings.id, set: values });
  await audit(userId, "admin.maintenance", null, { enabled: parsed.enabled, startsAt: startsAt?.toISOString() ?? null, endsAt: endsAt?.toISOString() ?? null });
  return maintenanceState();
}

/** These paths preserve sign-in, reporting, cancellation, revocation and cleanup recovery. */
export function maintenanceExemptRequest(path: string, method: string): boolean {
  if (["GET", "HEAD", "OPTIONS"].includes(method)) return true;
  return /^\/api\/(?:auth(?:\/|$)|admin(?:\/|$)|security-reports(?:\/|$)|collect\/|mcp$)/.test(path)
    || /^\/api\/(?:v1\/)?deployments\/[^/]+\/cancel$/.test(path)
    || path === "/api/deployments/bulk-cancel"
    || (["PATCH", "DELETE"].includes(method) && /^\/api\/cleanup\/[^/]+$/.test(path))
    || (method === "DELETE" && (/^\/api\/account\/sessions(?:\/|$)/.test(path) || /^\/api\/tokens\/[^/]+$/.test(path) || /^\/api\/(?:v1\/)?projects\/[^/]+\/terminal\/[^/]+$/.test(path)));
}
