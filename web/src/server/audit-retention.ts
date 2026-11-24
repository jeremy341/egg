import { lt, sql } from "drizzle-orm";
import { getDb, schema } from "@/server/db";
import { withMaintenanceLease } from "@/server/maintenance-leases";

/** Audit entries older than this are deleted. Every level (app, organization, instance) follows the same window. */
export const AUDIT_KEEP_DAYS = 180;
const DAY_MS = 24 * 60 * 60 * 1000;
const BATCH = 1000;

/** Delete audit entries older than AUDIT_KEEP_DAYS, in bounded batches. Runs under a maintenance lease. */
export async function pruneAuditLog(now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - AUDIT_KEEP_DAYS * DAY_MS);
  return (
    (await withMaintenanceLease("audit-log-retention", async () => {
      const db = await getDb();
      let removed = 0;
      for (let i = 0; i < 100; i++) {
        const batch = await db
          .delete(schema.auditLog)
          .where(sql`${schema.auditLog.id} in (select id from ${schema.auditLog} where ${lt(schema.auditLog.at, cutoff)} limit ${BATCH})`)
          .returning({ id: schema.auditLog.id });
        removed += batch.length;
        if (batch.length < BATCH) break;
      }
      return removed;
    })) ?? 0
  );
}
