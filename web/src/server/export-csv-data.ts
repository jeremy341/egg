import { desc, eq } from "drizzle-orm";
import type { ActivityFilters, ActivityItem } from "@/server/activity";
import { queryActivity } from "@/server/activity-query";
import { getDb, schema } from "@/server/db";
import { EXPORT_ROW_LIMIT, type DeploymentExportRow } from "@/server/export-csv";
import { HttpError } from "@/server/http";
import { getProjectForUser } from "@/server/projects";
import { rateLimiter } from "@/server/rate-limit";

/**
 * What the CSV exports read. Exports are reads, so nothing here is audited,
 * and nothing secret is selected in the first place.
 */

export type Export<T> = { rows: T[]; truncated: boolean };

/** Exports read up to 5000 rows each, so they get a small allowance: per user, per minute. */
export const EXPORT_RATE = { limit: 10, windowMs: 60_000 } as const;

export function enforceExportRate(userId: string): void {
  const result = rateLimiter().check(`export:${userId}`, EXPORT_RATE.limit, EXPORT_RATE.windowMs);
  if (result.allowed) return;
  const s = result.retryAfterSeconds;
  throw new HttpError(429, `Too many exports. Wait ${s} second${s === 1 ? "" : "s"} and try again.`, "rate_limited", {
    "Retry-After": String(s),
  });
}

/** Pages the activity query reads per round trip; its own maximum. */
const ACTIVITY_PAGE = 200;

/**
 * The signed-in user's activity with the page's filters, newest first. It goes
 * through the same query as the page, so the same entries and the same
 * secret-hiding rules (`cleanMeta`) apply. `now` is fixed for every page, so a
 * range filter does not shift halfway through.
 */
export async function exportActivity(userId: string, filters: ActivityFilters, now = new Date()): Promise<Export<ActivityItem>> {
  const items: ActivityItem[] = [];
  let cursor: string | null = null;
  let capped = false;
  for (;;) {
    const page = await queryActivity(userId, filters, { limit: ACTIVITY_PAGE, cursor, now });
    items.push(...page.items);
    capped = page.capped;
    if (!page.nextCursor || items.length > EXPORT_ROW_LIMIT) break;
    cursor = page.nextCursor;
  }
  // A search that hit its scan limit may have older matches it never looked at.
  return { rows: items.slice(0, EXPORT_ROW_LIMIT), truncated: items.length > EXPORT_ROW_LIMIT || capped };
}

/** One project's deployments, newest first. 404 unless the user owns it. Only the exported columns are read. */
export async function exportDeployments(
  userId: string,
  projectId: string
): Promise<Export<DeploymentExportRow> & { slug: string }> {
  const project = await getProjectForUser(userId, projectId);
  const db = await getDb();
  const d = schema.deployments;
  const rows = await db
    .select({
      id: d.id,
      createdAt: d.createdAt,
      commitSha: d.commitSha,
      branch: d.branch,
      env: d.env,
      state: d.state,
      startedAt: d.startedAt,
      finishedAt: d.finishedAt,
    })
    .from(d)
    .where(eq(d.projectId, project.id))
    .orderBy(desc(d.createdAt), desc(d.id))
    .limit(EXPORT_ROW_LIMIT + 1);
  return { slug: project.slug, rows: rows.slice(0, EXPORT_ROW_LIMIT), truncated: rows.length > EXPORT_ROW_LIMIT };
}

/** A CSV download. Never cached, never sniffed into something a browser would render. */
export function csvResponse(csv: string, filename: string, truncated: boolean): Response {
  return new Response(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      // csvFilename only produces [A-Za-z0-9_.-], so the plain form is safe as is.
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
      "x-export-truncated": String(truncated),
    },
  });
}
