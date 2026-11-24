import { count, desc, sql } from "drizzle-orm";
import { getDb, schema } from "@/server/db";
import { isInstanceAdmin } from "@/server/admin-identity";
import { maintenanceState } from "@/server/maintenance";
import { HttpError } from "@/server/http";
import { describeAction } from "@/server/audit";

export async function adminOverview(userId: string) {
  if (!(await isInstanceAdmin(userId))) throw new HttpError(403, "Only an instance administrator can open this dashboard.", "forbidden");
  const db = await getDb();
  const [users, projects, servers, jobs, reports, cleanup, events, maintenance] = await Promise.all([
    db.select({ count: count() }).from(schema.users).get(),
    db.select({ count: count() }).from(schema.projects).get(),
    db.select({ count: count() }).from(schema.servers).get(),
    db.select({ state: schema.jobs.state, count: count() }).from(schema.jobs).groupBy(schema.jobs.state),
    db.select({ state: schema.securityReports.status, count: count() }).from(schema.securityReports).groupBy(schema.securityReports.status),
    db.select({ state: schema.cleanupJobs.state, count: count() }).from(schema.cleanupJobs).groupBy(schema.cleanupJobs.state),
    db.select({ id: schema.auditLog.id, action: schema.auditLog.action, at: schema.auditLog.at }).from(schema.auditLog).where(sql`${schema.auditLog.action} like 'admin.%'`).orderBy(desc(schema.auditLog.at)).limit(20),
    maintenanceState(),
  ]);
  return { users: users?.count ?? 0, projects: projects?.count ?? 0, servers: servers?.count ?? 0, jobs, reports, cleanup, events: events.map((e) => ({ ...e, label: describeAction(e.action), at: e.at.toISOString() })), maintenance };
}
