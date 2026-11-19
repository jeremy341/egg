import { and, desc, eq, gte, sql } from "drizzle-orm";
import { z } from "zod";
import { featuresForKey } from "@/server/analytics-config";
import { BROWSER_ID, KEY_PREFIX, UNKNOWN_IP, isBot, overProjectWriteLimit, recordPageview, retentionCode, visitorHash } from "@/server/analytics";
import { TRACK_NAME, VITALS, cleanEventName, cleanEventValue, cleanPath, cleanVital } from "@/server/analytics-fields";
import { getDb, schema } from "@/server/db";
import { getReadableProject } from "@/server/projects";
import { MIN_SAMPLE } from "@/server/stats";

/**
 * Opt-in analytics events: clicks, time on page, funnel goals, custom events
 * (a name and an optional value), speed measurements and the live view heartbeat.
 *
 * Click and time events store the project and the UTC day, and a short label or
 * a time bucket. They store no visitor id, no timestamp, no IP address, no
 * cookie and no browser details. A goal event (a funnel step the owner named)
 * also stores the same daily salted visitor hash a page view has, and the time,
 * because a funnel has to count a visitor once and in order. A custom event stores
 * its name, its value and the day. A speed summary stores a declared route template,
 * the time and rounded measurements. A heartbeat stores the project, the time and
 * the salted retention code, and is deleted after an hour.
 */

export const TIME_BUCKETS = ["lt10", "10-60", "60-300", "gt300"] as const;
export type TimeBucket = (typeof TIME_BUCKETS)[number];

export const LABEL_MAX = 40;

/**
 * A click label is an explicit, static instrumentation name. Do not accept
 * visible UI text or arbitrary dynamic strings that could contain personal data.
 */
export function cleanLabel(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const t = raw.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, " ").replace(/\s+/g, " ").trim();
  return t.length <= LABEL_MAX && TRACK_NAME.test(t) ? t : null;
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
  z.object({ e: z.literal("track"), n: z.string().max(100), v: z.string().max(100).optional() }),
  z.object({
    e: z.literal("vitals"),
    p: z.string().max(2000).default("/"),
    pt: z.literal(1).optional(),
    lcp: z.unknown().optional(),
    cls: z.unknown().optional(),
    inp: z.unknown().optional(),
    fcp: z.unknown().optional(),
    ttfb: z.unknown().optional(),
  }),
  z.object({
    e: z.literal("err"),
    m: z.string().max(2000),
    f: z.string().max(400).optional(),
    l: z.unknown().optional(),
  }),
  z.object({ e: z.literal("ping"), i: z.string().max(100) }),
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
 * project has switched the feature on, a click, time, goal, custom event,
 * speed summary or heartbeat. Any other report is dropped, and so is one
 * for a switch that is off.
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
  // Per-address limiting only applies to a real address: the shared unknown one
  // (UNKNOWN_IP) must not throttle the whole project as a single visitor.
  const hold = who.ip === UNKNOWN_IP ? null : `${projectId}|${who.ip}`;
  const t = now.getTime();
  // The per-project cap bounds the total whatever the addresses (it is the only
  // rule with none of them trusted); the per-address one keeps a single visitor
  // from using a project's whole minute.
  const atCapacity = () => overProjectWriteLimit(projectId, t) || (hold ? overLimit(hold, t) : false);
  const e = parsed.data;
  const day = now.toISOString().slice(0, 10);
  const db = await getDb();

  if (e.e === "click") {
    const label = cleanLabel(e.l);
    if (!features.clicks || !label) return false;
    if (atCapacity()) return false;
    await db.insert(schema.analyticsEvents).values({ projectId, day, kind: "click", label });
    return true;
  }
  if (e.e === "time") {
    if (!features.time) return false;
    if (atCapacity()) return false;
    await db.insert(schema.analyticsEvents).values({ projectId, day, kind: "time", bucket: e.b });
    return true;
  }
  if (e.e === "track") {
    const label = cleanEventName(e.n);
    if (!features.events || !label) return false;
    if (atCapacity()) return false;
    // A value that breaks the plain-text rule is dropped; the event is still counted.
    await db.insert(schema.analyticsEvents).values({ projectId, day, kind: "track", label, value: cleanEventValue(e.v) });
    return true;
  }
  if (e.e === "vitals") {
    if (!features.vitals) return false;
    const m = Object.fromEntries(VITALS.map((k) => [k, cleanVital(k, e[k])])) as Record<(typeof VITALS)[number], number | null>;
    if (VITALS.every((k) => m[k] === null)) return false;
    if (atCapacity()) return false;
    await db.insert(schema.analyticsVitals).values({ projectId, at: now, path: e.pt === 1 ? cleanPath(e.p) : "/", ...m });
    return true;
  }
  if (e.e === "err") {
    // Never store exception text: application errors can expose tokens, paths,
    // or user content. Reject legacy event payloads at the collector.
    return false;
  }
  if (e.e === "ping") {
    // A heartbeat only means something with the retention code to count, so it needs both switches.
    if (!features.live || !features.retention || !BROWSER_ID.test(e.i)) return false;
    if (atCapacity()) return false;
    await db.insert(schema.analyticsLive).values({ projectId, at: now, vid: retentionCode({ projectId, browserId: e.i, at: now }) });
    return true;
  }
  // A goal counts only when it is one of the funnel's own named steps.
  const name = e.n.trim();
  if (!features.funnel || !features.steps.some((s) => s.kind === "track" && s.value === name)) return false;
  if (atCapacity()) return false;
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

/** Every UTC day of a window of `days` days that ends today, oldest first. A quiet day is still in the list. */
export function lastDays(days: number, now: Date): string[] {
  const out: string[] = [];
  for (let i = days - 1; i >= 0; i--) out.push(new Date(now.getTime() - i * DAY_MS).toISOString().slice(0, 10));
  return out;
}

export type ClicksSummary = {
  days: number;
  total: number;
  rows: { label: string; clicks: number }[];
};

export async function clicksSummary(userId: string, projectId: string, days = 30, now = new Date()): Promise<ClicksSummary> {
  const project = await getReadableProject(userId, projectId);
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
  const project = await getReadableProject(userId, projectId);
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

// ------------------------------------------------------------ custom events

export type EventsSummary = {
  days: number;
  total: number;
  rows: { name: string; value: string | null; count: number }[];
  /** The same events added up by name alone, the most frequent first. At most 10. */
  byName: { name: string; count: number }[];
  /** Events on each UTC day of the range, quiet days as zero. */
  daily: { day: string; count: number }[];
};

/** Custom events by name and value for the last `days` days, the most frequent first. */
export async function eventsSummary(userId: string, projectId: string, days = 30, now = new Date()): Promise<EventsSummary> {
  const project = await getReadableProject(userId, projectId);
  const db = await getDb();
  const where = and(
    eq(schema.analyticsEvents.projectId, project.id),
    eq(schema.analyticsEvents.kind, "track"),
    gte(schema.analyticsEvents.day, sinceDay(days, now))
  );
  const rows = await db
    .select({ name: schema.analyticsEvents.label, value: schema.analyticsEvents.value, count: sql<number>`count(*)` })
    .from(schema.analyticsEvents)
    .where(where)
    .groupBy(schema.analyticsEvents.label, schema.analyticsEvents.value)
    .orderBy(desc(sql`count(*)`), schema.analyticsEvents.label, schema.analyticsEvents.value)
    .limit(20);
  const total = await db.select({ n: sql<number>`count(*)` }).from(schema.analyticsEvents).where(where).get();
  const byName = await db
    .select({ name: schema.analyticsEvents.label, count: sql<number>`count(*)` })
    .from(schema.analyticsEvents)
    .where(where)
    .groupBy(schema.analyticsEvents.label)
    .orderBy(desc(sql`count(*)`), schema.analyticsEvents.label)
    .limit(10);
  const perDay = await db
    .select({ day: schema.analyticsEvents.day, count: sql<number>`count(*)` })
    .from(schema.analyticsEvents)
    .where(where)
    .groupBy(schema.analyticsEvents.day);
  const counts = new Map(perDay.map((r) => [r.day, Number(r.count)]));
  return {
    days,
    total: Number(total?.n ?? 0),
    rows: rows.map((r) => ({ name: r.name ?? "", value: r.value, count: Number(r.count) })),
    byName: byName.map((r) => ({ name: r.name ?? "", count: Number(r.count) })),
    daily: lastDays(days, now).map((day) => ({ day, count: counts.get(day) ?? 0 })),
  };
}
