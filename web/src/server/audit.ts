import { desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/server/db";

/**
 * Who did what. Written next to the change itself and never allowed to break
 * it: if the log cannot be written, the action still goes through.
 */
export async function audit(
  userId: string | null,
  action: string,
  target?: string | null,
  meta?: Record<string, string | number | boolean | null>
) {
  try {
    const db = await getDb();
    await db.insert(schema.auditLog).values({
      userId,
      action,
      target: target ?? null,
      meta: meta ? JSON.stringify(meta) : null,
      at: new Date(),
    });
  } catch (err) {
    console.warn("audit write failed", err instanceof Error ? err.message : err);
  }
}

/** Plain-language text for each action. Unknown actions fall back to the raw name. */
export const LABELS: Record<string, string> = {
  "project.create": "Created project",
  "project.update": "Changed settings for",
  "project.delete": "Deleted project",
  "project.restart": "Restarted",
  "project.workflow.publish": "Opened a pull request that adds the build workflow to",
  "env.set": "Saved environment variable on",
  "env.delete": "Removed environment variable from",
  "env.replace": "Replaced environment variables on",
  "deploy.redeploy": "Redeployed",
  "deploy.rollback": "Rolled back",
  "deploy.cancel": "Canceled a deployment of",
  "deploy.preview_delete": "Deleted a preview deployment of",
  "hook.trigger": "Deployed through the deploy hook for",
  "hook.create": "Created a deploy hook for",
  "hook.revoke": "Revoked the deploy hook for",
  "job.create": "Added a scheduled job to",
  "job.update": "Changed a scheduled job of",
  "job.delete": "Removed a scheduled job from",
  "job.run": "Ran a scheduled job of",
  // Written by the single upload token that GitHub builds used before scoped credentials; kept so old rows still read well.
  "build_token.create": "Made a new build upload token for",
  "build_credentials.create": "Made new build credentials for",
  "build_credentials.revoke": "Removed the build credentials of",
  "domain.add": "Added domain",
  "domain.remove": "Removed domain",
  "server.rotate_key": "Replaced the SSH key for",
  "server.build_memory": "Changed the build memory limit for",
  "server.build_cpu": "Changed the build CPU limit for",
  "project.cleanup_request": "Scheduled project cleanup for",
  "account.cleanup_request": "Scheduled account cleanup",
  "account.cleanup_cancel_failed": "Dropped a failed cleanup after acknowledging possibly-unremoved projects",
  "admin.maintenance": "Changed maintenance settings",
  "admin.grant": "Made someone an administrator",
  "admin.revoke": "Removed an administrator",
  "security_report.list": "Viewed the security report inbox",
  "security_report.read": "Read a security report",
  "security_report.status": "Changed a security report status",
  "security_report.delete": "Deleted a security report",
  "security_report.capacity_low": "Warned that the security report inbox is nearly full",
  "security_report.source": "Counted an anonymous security report submission",
  "server.disconnect": "Disconnected",
  "domain.update": "Changed domain",
  "analytics.enable": "Turned on analytics for",
  "analytics.disable": "Turned off analytics for",
  "analytics.settings": "Changed what analytics records for",
  "statistics.settings": "Changed which statistics show for",
  "status.enable": "Published a status page for",
  "status.disable": "Unpublished the status page for",
  "homepage_feed.enable": "Showed on the Egg homepage the deployments of",
  "homepage_feed.disable": "Stopped showing on the Egg homepage the deployments of",
  "account.session_revoke": "Signed out another browser",
  "account.sessions_revoke_all": "Signed out all other browsers",
  "monitor.down": "Detected downtime on",
  "monitor.up": "Detected recovery of",
  "container.orphan_remove": "Removed a leftover from the container",
  "terminal.open": "Opened a terminal on",
  "terminal.close": "Closed a terminal on",
  "token.create": "Created an access token",
  "token.revoke": "Revoked an access token",
  "token.update": "Edited an access token",
  "auth.reauth": "Confirmed sign-in with Hack Club",
  "deploy.trigger": "Started a deployment of",
  "deploy.reconcile": "Recovered a missed GitHub deployment of",
  "adoption.plan": "Planned an existing app import for",
  "adoption.confirm_attempt": "Confirmed an existing app import for",
  "adoption.complete": "Imported an existing app into",
  "adoption.failed": "Recorded a failed app import for",
  "admin.recovery.inspect": "Inspected interrupted backend work",
  "admin.recovery.attempt": "Started recovery of interrupted work",
  "admin.recovery.complete": "Recovered interrupted backend work",
  "admin.recovery.failed": "Recorded an unsuccessful recovery",
  "file.write": "Saved a file on",
  "file.mkdir": "Created a folder on",
  "file.rename": "Renamed a file on",
  "file.delete": "Deleted a file on",
  "container.permissions": "Changed container permissions for",
  "terminal.revoked": "Closed a terminal after a sign-out on",
  "webhook.create": "Created a webhook",
  "webhook.update": "Changed a webhook",
  "webhook.delete": "Deleted a webhook",
  "webhook.rotate": "Replaced the secret of a webhook",
  "webhook.test": "Sent a test message to a webhook",
  "provider.disconnect": "Disconnected a provider",
};

export function describeAction(action: string): string {
  return LABELS[action] ?? action;
}

export type ActivityEntry = {
  id: number;
  action: string;
  label: string;
  target: string | null;
  detail: string | null;
  at: string;
};

/** The signed-in user's own recent activity, newest first. */
export async function listActivity(userId: string, limit = 100): Promise<ActivityEntry[]> {
  const db = await getDb();
  const rows = await db
    .select()
    .from(schema.auditLog)
    .where(eq(schema.auditLog.userId, userId))
    .orderBy(desc(schema.auditLog.at), desc(schema.auditLog.id))
    .limit(Math.min(Math.max(limit, 1), 500));

  // Targets are project ids for most actions; show names instead.
  const projects = await db
    .select({ id: schema.projects.id, name: schema.projects.name })
    .from(schema.projects)
    .where(eq(schema.projects.userId, userId));
  const names = new Map(projects.map((p) => [p.id, p.name]));

  return rows.map((r) => {
    let detail: string | null = null;
    if (r.meta) {
      try {
        const m = JSON.parse(r.meta) as Record<string, unknown>;
        detail = Object.entries(m)
          .map(([k, v]) => `${k}: ${String(v)}`)
          .join(", ");
      } catch {
        detail = null;
      }
    }
    return {
      id: r.id,
      action: r.action,
      label: describeAction(r.action),
      target: r.target ? (names.get(r.target) ?? r.target) : null,
      detail,
      at: r.at.toISOString(),
    };
  });
}
