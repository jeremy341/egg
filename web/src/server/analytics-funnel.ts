import { and, eq, gte, inArray, sql } from "drizzle-orm";
import { getFeatures, type FunnelStep } from "@/server/analytics-config";
import { sinceDay } from "@/server/analytics-events";
import { getDb, schema } from "@/server/db";
import { getReadableProject } from "@/server/projects";
import { MIN_SAMPLE } from "@/server/stats";

/**
 * Funnels: an ordered list of steps (a page path, or a data-egg-track name) and
 * how many visitors got to each one.
 *
 * A visitor counts at a step only after reaching the steps before it, in order,
 * on the same UTC day. Visitors are the daily salted hash a page view already
 * carries, so one person is counted once per day and the same person on two
 * days counts twice, as everywhere else on the page.
 */

export type FunnelEvent = { visitor: string; kind: FunnelStep["kind"]; value: string; at: number };

/**
 * Visitors who reached each step. Each visitor's events are walked in time
 * order and move them on one step when they match the next step, so skipping a
 * step, or doing them in the wrong order, stops the count there. Pure.
 */
export function countFunnel(steps: FunnelStep[], events: FunnelEvent[]): number[] {
  const reached = steps.map(() => 0);
  const byVisitor = new Map<string, FunnelEvent[]>();
  for (const e of events) {
    const list = byVisitor.get(e.visitor);
    if (list) list.push(e);
    else byVisitor.set(e.visitor, [e]);
  }
  for (const list of byVisitor.values()) {
    list.sort((a, b) => a.at - b.at);
    let next = 0;
    for (const e of list) {
      const step = steps[next];
      if (step && step.kind === e.kind && step.value === e.value) {
        reached[next] += 1;
        next += 1;
      }
    }
  }
  return reached;
}

export type FunnelSummary = {
  days: number;
  /** Percentages need at least this many visitors at the step before. */
  minimum: number;
  /** True when enough visitors started the funnel for its overall figure to be shown. */
  enough: boolean;
  steps: {
    kind: FunnelStep["kind"];
    value: string;
    visitors: number;
    /** Visitors who reached the step before but not this one. Null for the first step. */
    dropped: number | null;
    /** Share of the step before that did not reach this one, or null below the minimum. */
    dropPercent: number | null;
  }[];
  /** Visitors who reached the first step. */
  started: number;
  /** Visitors who reached the last step. */
  completed: number;
  /** Share of those who started that completed, or null below the minimum. */
  conversionPercent: number | null;
};

/** A share of `part` in `whole`, never 0 while part is above 0 or 100 while it is below `whole`. */
export function share(part: number, whole: number): number {
  let p = Math.round((part / whole) * 100);
  if (p === 100 && part < whole) p = 99;
  if (p === 0 && part > 0) p = 1;
  return p;
}

/** Counts per step as dropped visitors and percentages, withholding any percentage below MIN_SAMPLE. Pure. */
export function summariseFunnel(steps: FunnelStep[], reached: number[], days = 30): FunnelSummary {
  const started = reached[0] ?? 0;
  const completed = reached.length ? reached[reached.length - 1] : 0;
  const enough = started >= MIN_SAMPLE;
  return {
    days,
    minimum: MIN_SAMPLE,
    enough,
    started,
    completed,
    conversionPercent: enough ? share(completed, started) : null,
    steps: steps.map((s, i) => {
      const visitors = reached[i] ?? 0;
      if (i === 0) return { ...s, visitors, dropped: null, dropPercent: null };
      const before = reached[i - 1] ?? 0;
      const dropped = Math.max(0, before - visitors);
      return {
        ...s,
        visitors,
        dropped,
        dropPercent: before >= MIN_SAMPLE ? share(dropped, before) : null,
      };
    }),
  };
}

export async function funnelSummary(userId: string, projectId: string, days = 30, now = new Date()): Promise<FunnelSummary> {
  const project = await getReadableProject(userId, projectId);
  const { funnel, steps } = await getFeatures(project.id);
  if (!funnel) return summariseFunnel([], [], days);

  const db = await getDb();
  const from = sinceDay(days, now);
  const events: FunnelEvent[] = [];

  const paths = [...new Set(steps.filter((s) => s.kind === "page").map((s) => s.value))];
  if (paths.length) {
    const rows = await db
      .select({ visitor: schema.pageviews.visitor, path: schema.pageviews.path, at: schema.pageviews.at })
      .from(schema.pageviews)
      .where(
        and(
          eq(schema.pageviews.projectId, project.id),
          gte(schema.pageviews.at, new Date(`${from}T00:00:00Z`)),
          inArray(schema.pageviews.path, paths)
        )
      );
    for (const r of rows) events.push({ visitor: r.visitor, kind: "page", value: r.path, at: r.at.getTime() });
  }

  const names = [...new Set(steps.filter((s) => s.kind === "track").map((s) => s.value))];
  if (names.length) {
    const rows = await db
      .select({ visitor: schema.analyticsEvents.visitor, label: schema.analyticsEvents.label, at: schema.analyticsEvents.at })
      .from(schema.analyticsEvents)
      .where(
        and(
          eq(schema.analyticsEvents.projectId, project.id),
          eq(schema.analyticsEvents.kind, "goal"),
          gte(schema.analyticsEvents.day, from),
          inArray(schema.analyticsEvents.label, names),
          sql`${schema.analyticsEvents.visitor} is not null`
        )
      );
    for (const r of rows) {
      if (r.visitor && r.label && r.at) events.push({ visitor: r.visitor, kind: "track", value: r.label, at: r.at.getTime() });
    }
  }

  return summariseFunnel(steps, countFunnel(steps, events), days);
}
