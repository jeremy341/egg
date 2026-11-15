import { and, desc, eq, gte, sql } from "drizzle-orm";
import { z } from "zod";
import { featuresForKey } from "@/server/analytics-config";
import { KEY_PREFIX, isBot, recordPageview, visitorHash } from "@/server/analytics";
import { getDb, schema } from "@/server/db";
import { getProjectForUser } from "@/server/projects";
import { MIN_SAMPLE } from "@/server/stats";

/**
 * Opt-in analytics events: clicks, time on page and funnel goals.
 *
 * Click and time events store the project and the UTC day, and a short label or
 * a time bucket. They store no visitor id, no timestamp, no IP address, no
 * cookie and no browser details. A goal event (a funnel step the owner named)
 * also stores the same daily salted visitor hash a page view has, and the time,
 * because a funnel has to count a visitor once and in order.
 */

export const TIME_BUCKETS = ["lt10", "10-60", "60-300", "gt300"] as const;
export type TimeBucket = (typeof TIME_BUCKETS)[number];

export const LABEL_MAX = 40;

const EMAIL = /[^\s@]+@[^\s@]+\.[^\s@]+/;
const URLISH = /^(?:https?:\/\/|www\.|\/)/i;

/**
 * A click label from whatever the page sent: white space collapsed, a URL's
 * query string and fragment cut off, at most 40 characters. A label that
 * contains an email address is dropped whole, since text like "Signed in as ..."
 * is the likeliest way a person's details reach a button. Null when nothing is left.
 */
export function cleanLabel(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  let t = raw.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, " ").replace(/\s+/g, " ").trim();
  if (!t || EMAIL.test(t)) return null;
  t = t
    .split(" ")
    .map((w) => (URLISH.test(w) || /\?\S*=/.test(w) ? w.split(/[?#]/)[0] : w))
    .join(" ")
    .trim();
  t = Array.from(t).slice(0, LABEL_MAX).join("").trim();
  return t || null;
}

/** True when the request carries Do Not Track or Global Privacy Control. */
export function optedOut(headers: Pick<Headers, "get">): boolean {
  return headers.get("dnt") === "1" || headers.get("sec-gpc") === "1";
}

// ------------------------------------------------------------ collecting

const event = z.discriminatedUnion("e", [
  z.object({ e: z.literal("click"), l: z.string().max(400) }),
  z.object({ e: z.literal("time"), b: z.enum(TIME_BUCKETS) }),
  z.object({ e: z.literal("goal"), n: z.string().max(100) }),
]);

// A person clicks in bursts, so this is looser than the page view limit: 30
// events per 10 seconds for each project and address. Kept in memory only.
const WINDOW_MS = 10_000;
const WINDOW_MAX = 30;
const windows = new Map<string, { start: number; n: number }>();
function overLimit(key: string, now: number): boolean {
  const w = windows.get(key);
  if (!w || now - w.start >= WINDOW_MS) {
    windows.set(key, { start: now, n: 1 });
    if (windows.size > 5000) for (const [k, v] of windows) if (now - v.start >= WINDOW_MS) windows.delete(k);
    return false;
  }
  w.n += 1;
  return w.n > WINDOW_MAX;
}

/**
 * Record one report from the script: a page view (the default) or, when the
 * project has switched the feature on, a click, a time or a goal event. Any
 * other report is dropped, and so is one for a switch that is off.
 */
export async function recordHit(
  key: string,
  raw: unknown,
  who: { ip: string; ua: string },
  now = new Date()
): Promise<boolean> {
  const kind = raw && typeof raw === "object" ? (raw as { e?: unknown }).e : undefined;
  if (kind === undefined) return recordPageview(key, raw, who, now);
  if (!key.startsWith(KEY_PREFIX) || isBot(who.ua)) return false;
  const parsed = event.safeParse(raw);
  if (!parsed.success) return false;
  const found = await featuresForKey(key);
  if (!found) return false;
  const { projectId, features } = found;
  const e = parsed.data;
  const day = now.toISOString().slice(0, 10);
  const db = await getDb();

  if (e.e === "click") {
    const label = cleanLabel(e.l);
    if (!features.clicks || !label) return false;
    if (overLimit(`${projectId}|${who.ip}`, now.getTime())) return false;
    await db.insert(schema.analyticsEvents).values({ projectId, day, kind: "click", label });
    return true;
  }
  if (e.e === "time") {
    if (!features.time) return false;
    if (overLimit(`${projectId}|${who.ip}`, now.getTime())) return false;
    await db.insert(schema.analyticsEvents).values({ projectId, day, kind: "time", bucket: e.b });
    return true;
  }
  // A goal counts only when it is one of the funnel's own named steps.
  const name = e.n.trim();
  if (!features.funnel || !features.steps.some((s) => s.kind === "track" && s.value === name)) return false;
  if (overLimit(`${projectId}|${who.ip}`, now.getTime())) return false;
  await db.insert(schema.analyticsEvents).values({
    projectId,
    day,
    kind: "goal",
    label: name,
    visitor: visitorHash({ projectId, ip: who.ip, ua: who.ua, day }),
    at: now,
  });
  return true;
}

// ------------------------------------------------------------ reading

const DAY_MS = 86_400_000;

/** The first UTC day of a window of `days` days that ends today. */
export function sinceDay(days: number, now: Date): string {
  return new Date(now.getTime() - (days - 1) * DAY_MS).toISOString().slice(0, 10);
}

export type ClicksSummary = {
  days: number;
  total: number;
  rows: { label: string; clicks: number }[];
};

export async function clicksSummary(userId: string, projectId: string, days = 30, now = new Date()): Promise<ClicksSummary> {
  const project = await getProjectForUser(userId, projectId);
  const db = await getDb();
  const where = and(
    eq(schema.analyticsEvents.projectId, project.id),
    eq(schema.analyticsEvents.kind, "click"),
    gte(schema.analyticsEvents.day, sinceDay(days, now))
  );
  const rows = await db
    .select({ label: schema.analyticsEvents.label, clicks: sql<number>`count(*)` })
    .from(schema.analyticsEvents)
    .where(where)
    .groupBy(schema.analyticsEvents.label)
    .orderBy(desc(sql`count(*)`), schema.analyticsEvents.label)
    .limit(10);
  const total = await db
    .select({ n: sql<number>`count(*)` })
    .from(schema.analyticsEvents)
    .where(where)
    .get();
  return {
    days,
    total: Number(total?.n ?? 0),
    rows: rows.map((r) => ({ label: r.label ?? "", clicks: Number(r.clicks) })),
  };
}

// ------------------------------------------------------------ time on page

export const TIME_BUCKET_LABELS: Record<TimeBucket, string> = {
  lt10: "Under 10 seconds",
  "10-60": "10 to 60 seconds",
  "60-300": "1 to 5 minutes",
  gt300: "Over 5 minutes",
};

export type TimeSummary = {
  days: number;
  /** Visits that reported a time. */
  total: number;
  /** Shares, the median and the percentages need at least this many visits. */
  minimum: number;
  enough: boolean;
  /** The bucket that holds the middle visit, or null below the minimum. */
  median: TimeBucket | null;
  buckets: { bucket: TimeBucket; label: string; visits: number; percent: number | null }[];
};

/**
 * Bucket counts as shares and a median. Below MIN_SAMPLE visits the counts stay
 * but the shares and the median are withheld. A share is never rounded up to 100
 * while another bucket has visits, or down to 0 while its own has. Pure.
 */
export function summariseTime(counts: Record<TimeBucket, number>): TimeSummary {
  const total = TIME_BUCKETS.reduce((n, b) => n + (counts[b] || 0), 0);
  const enough = total >= MIN_SAMPLE;
  let median: TimeBucket | null = null;
  if (enough) {
    let seen = 0;
    for (const b of TIME_BUCKETS) {
      seen += counts[b] || 0;
      if (seen * 2 >= total) {
        median = b;
        break;
      }
    }
  }
  return {
    days: 0,
    total,
    minimum: MIN_SAMPLE,
    enough,
    median,
    buckets: TIME_BUCKETS.map((bucket) => {
      const visits = counts[bucket] || 0;
      let percent: number | null = null;
      if (enough) {
        percent = Math.round((visits / total) * 100);
        if (percent === 100 && visits < total) percent = 99;
        if (percent === 0 && visits > 0) percent = 1;
      }
      return { bucket, label: TIME_BUCKET_LABELS[bucket], visits, percent };
    }),
  };
}

export async function timeSummary(userId: string, projectId: string, days = 30, now = new Date()): Promise<TimeSummary> {
  const project = await getProjectForUser(userId, projectId);
  const db = await getDb();
  const rows = await db
    .select({ bucket: schema.analyticsEvents.bucket, n: sql<number>`count(*)` })
    .from(schema.analyticsEvents)
    .where(
      and(
        eq(schema.analyticsEvents.projectId, project.id),
        eq(schema.analyticsEvents.kind, "time"),
        gte(schema.analyticsEvents.day, sinceDay(days, now))
      )
    )
    .groupBy(schema.analyticsEvents.bucket);
  const counts: Record<TimeBucket, number> = { lt10: 0, "10-60": 0, "60-300": 0, gt300: 0 };
  for (const r of rows) if ((TIME_BUCKETS as readonly string[]).includes(r.bucket ?? "")) counts[r.bucket as TimeBucket] = Number(r.n);
  return { ...summariseTime(counts), days };
}
