import { sql } from "drizzle-orm";
import { getDb, schema } from "@/server/db";
import { withMaintenanceLease } from "@/server/maintenance-leases";

export function deploymentLogRetentionDays(raw = process.env.DEPLOY_LOG_RETENTION_DAYS): number {
  if (raw === "0") return 0;
  const value = Number(raw ?? 90);
  return Number.isInteger(value) && value >= 1 && value <= 3650 ? value : 90;
}

/** Bounded batches avoid monopolizing the shared database; active deployments are retained. */
export async function pruneDeploymentLogs(now = new Date()) {
  const days = deploymentLogRetentionDays();
  if (!days) return 0;
  return await withMaintenanceLease("deployment-log-retention", async () => {
    const db = await getDb();
    const cutoff = new Date(now.getTime() - days * 86400_000);
    let removed = 0;
    for (let i = 0; i < 10; i++) {
      const batch = await db.delete(schema.deploymentLogs).where(sql`${schema.deploymentLogs.id} in (
        select l.id from deployment_logs l join deployments d on d.id = l.deployment_id
        where l.at < ${cutoff.getTime()} and d.state in ('ready','error','canceled')
        and not exists (select 1 from jobs j where j.deployment_id = d.id and j.state = 'running') limit 1000
      )`).returning({ id: schema.deploymentLogs.id });
      removed += batch.length;
      if (batch.length < 1000) break;
    }
    return removed;
  }) ?? 0;
}
