import { and, desc, eq, gte, lte } from "drizzle-orm";
import { getFeatures } from "@/server/analytics-config";
import { getDb, schema } from "@/server/db";
import { getReadableProject } from "@/server/projects";

/**
 * How visits move through the site, for a three-column flow chart:
 * where the visit came from, the first page, and the second page.
 *
 * A visit is every page view of one visitor value on one UTC day, in time order.
 * The visitor value is a daily hash, so it already changes each day. Read-only:
 * no visitor value is returned, only counts.
 */

export type FlowLink = { source: string; target: string; value: number };

export type FlowSummary = {
  days: number;
  /** False when the project does not record referrers; then `links` is empty. */
  enabled: boolean;
  /** Visits counted: one per visitor per UTC day. */
  visits: number;
  links: FlowLink[];
};

export type FlowRow = { visitor: string; at: number; path: string; referrer: string | null };

const MAX_ROW_LOAD = 50_000;
const TOP_REFERRERS = 5;
const TOP_PAGES = 6;
const DAY_MS = 86_400_000;

const DIRECT = "from:Direct";
const LEFT = "next:Left";

/** Keeps the `limit` most common values (ties by name) and maps the rest to `other`. */
function topKeep(counts: Map<string, number>, limit: number, other: string): (value: string) => string {
  const top = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .slice(0, limit)
    .map(([value]) => value);
  const keep = new Set(top);
  return (value) => (keep.has(value) ? value : other);
}

/**
 * Counts the visits and the flow links from raw page views. Pure: the caller loads the rows.
 * Visits are grouped by visitor and UTC day. `Direct` and `Left` are always kept and do not
 * count toward the limits of 5 referrers and 6 pages per column.
 */
export function summariseFlow(rows: FlowRow[], days: number): FlowSummary {
  const byVisit = new Map<string, FlowRow[]>();
  for (const row of rows) {
    const key = `${row.visitor}|${new Date(row.at).toISOString().slice(0, 10)}`;
    const list = byVisit.get(key);
    if (list) list.push(row);
    else byVisit.set(key, [row]);
  }

  const visits: { from: string; first: string; next: string }[] = [];
  for (const views of byVisit.values()) {
    const ordered = [...views].sort((a, b) => a.at - b.at);
    const [first, second] = ordered;
    visits.push({
      from: first.referrer ? `from:${first.referrer}` : DIRECT,
      first: `first:${first.path}`,
      next: second ? `next:${second.path}` : LEFT,
    });
  }

  const countOf = (pick: (v: (typeof visits)[number]) => string, skip: string | null) => {
    const counts = new Map<string, number>();
    for (const v of visits) {
      const value = pick(v);
      if (value === skip) continue;
      counts.set(value, (counts.get(value) ?? 0) + 1);
    }
    return counts;
  };

  const fromNode = topKeep(countOf((v) => v.from, DIRECT), TOP_REFERRERS, "from:Other");
  const firstNode = topKeep(countOf((v) => v.first, null), TOP_PAGES, "first:Other");
  const nextNode = topKeep(countOf((v) => v.next, LEFT), TOP_PAGES, "next:Other");

  const linkCounts = new Map<string, FlowLink>();
  const add = (source: string, target: string) => {
    const key = `${source}\u0000${target}`;
    const link = linkCounts.get(key);
    if (link) link.value += 1;
    else linkCounts.set(key, { source, target, value: 1 });
  };
  for (const v of visits) {
    const from = v.from === DIRECT ? DIRECT : fromNode(v.from);
    const first = firstNode(v.first);
    const next = v.next === LEFT ? LEFT : nextNode(v.next);
    add(from, first);
    add(first, next);
  }

  const links = [...linkCounts.values()].sort(
    (a, b) => b.value - a.value || a.source.localeCompare(b.source) || a.target.localeCompare(b.target)
  );
  return { days, enabled: true, visits: visits.length, links };
}

/** The visit flow of the project for the last `days` days. Empty when the referrers switch is off. */
export async function flowSummary(userId: string, projectId: string, days = 30, now = new Date()): Promise<FlowSummary> {
  const project = await getReadableProject(userId, projectId);
  const features = await getFeatures(project.id);
  if (!features.referrers) return { days, enabled: false, visits: 0, links: [] };

  const db = await getDb();
  const since = new Date(now.getTime() - days * DAY_MS);
  const rows = await db
    .select({
      visitor: schema.pageviews.visitor,
      at: schema.pageviews.at,
      path: schema.pageviews.path,
      referrer: schema.pageviews.referrer,
    })
    .from(schema.pageviews)
    .where(
      and(
        eq(schema.pageviews.projectId, project.id),
        gte(schema.pageviews.at, since),
        lte(schema.pageviews.at, now)
      )
    )
    .orderBy(desc(schema.pageviews.at))
    .limit(MAX_ROW_LOAD);
  return summariseFlow(
    rows.map((r) => ({ visitor: r.visitor, at: r.at.getTime(), path: r.path, referrer: r.referrer })),
    days
  );
}
