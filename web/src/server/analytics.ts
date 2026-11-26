import { createHmac } from "node:crypto";
import { and, desc, eq, gte, lt, sql, type AnyColumn } from "drizzle-orm";
import { z } from "zod";
import { featuresForKey, getAnalyticsDefaults } from "@/server/analytics-config";
import { cleanPath, cleanReferrer, allowlistedUtm } from "@/server/analytics-fields";
import { countryToStore } from "@/server/analytics-locations";
import { audit } from "@/server/audit";
import { config } from "@/server/config";
import { randomToken, sha256Hex } from "@/server/crypto";
import { getDb, schema } from "@/server/db";
import { HttpError } from "@/server/http";
import { getProjectForUser, getReadableProject } from "@/server/projects";

export { cleanPath, cleanReferrer };

/**
 * Page-view analytics for the apps people deploy.
 *
 * Nest does not give us the proxy's access log, so the numbers come from a
 * small script the owner adds to their site. It reports the path and the
 * referring site and nothing else. We store no IP address and set no cookie.
 * The visitor id is a hash of IP, browser and project that is salted with the
 * date, so it can count one day's visitors but cannot follow a person.
 *
 * Everything beyond the path is a switch the owner turns on: referrers and
 * campaigns, clicks, time, a funnel, speed and errors, custom events, the live
 * view and retention. The collector reads the switches too, so it stores nothing
 * for a feature that is off, whatever a copy of the script sends.
 */

export const KEY_PREFIX = "nda_";
export const PAGEVIEW_KEEP_MS = 90 * 24 * 60 * 60 * 1000;
/** Live view heartbeats are deleted after an hour. */
export const LIVE_KEEP_MS = 60 * 60 * 1000;
/** The live view counts what happened in this window. */
export const LIVE_WINDOW_MS = 5 * 60 * 1000;

export function snippet(key: string): string {
  const base = config().APP_URL.replace(/\/$/, "");
  // The key is in the address too, so the server can send a script that only
  // contains the features this project has switched on.
  return `<script defer data-key="${key}" src="${base}/api/analytics/script?key=${key}"></script>`;
}

export async function enableAnalytics(userId: string, projectId: string) {
  const project = await getProjectForUser(userId, projectId);
  if (project.analyticsKey) return { key: project.analyticsKey, snippet: snippet(project.analyticsKey) };
  const key = KEY_PREFIX + randomToken(12);
  const db = await getDb();
  await db
    .update(schema.projects)
    .set({ analyticsKey: key, updatedAt: new Date() })
    .where(eq(schema.projects.id, project.id));
  // A project that has never had settings starts from the person's account defaults
  // (all off unless they chose otherwise). One that already has settings keeps them.
  const defaults = await getAnalyticsDefaults(userId);
  if (Object.values(defaults).some(Boolean)) {
    await db
      .insert(schema.analyticsSettings)
      .values({
        projectId: project.id,
        clicks: defaults.clicks ?? false,
        time: defaults.time ?? false,
        funnel: defaults.funnel ?? false,
        referrers: defaults.referrers ?? false,
        vitals: defaults.vitals ?? false,
        events: defaults.events ?? false,
        live: defaults.live ?? false,
        retention: defaults.retention ?? false,
        updatedAt: new Date(),
      })
      .onConflictDoNothing();
  }
  await audit(userId, "analytics.enable", project.id);
  return { key, snippet: snippet(key) };
}

/** Stop collecting. Existing numbers stay until they age out. */
export async function disableAnalytics(userId: string, projectId: string) {
  const project = await getProjectForUser(userId, projectId);
  const db = await getDb();
  await db
    .update(schema.projects)
    .set({ analyticsKey: null, updatedAt: new Date() })
    .where(eq(schema.projects.id, project.id));
  await audit(userId, "analytics.disable", project.id);
}

// ------------------------------------------------------------ collecting

const BOT = /bot|crawl|spider|slurp|preview|monitor|headless|lighthouse|curl|wget|python-requests/i;

export function isBot(ua: string): boolean {
  return BOT.test(ua);
}

/**
 * The stand-in address for a visitor whose real address is not trusted
 * (TRUST_PROXY off / nothing trustworthy behind the proxy). All such visitors
 * share it, so per-address throttling skips it: otherwise the whole project's
 * traffic would count as one visitor.
 */
export const UNKNOWN_IP = "0.0.0.0";

export function visitorHash(args: { projectId: string; ip: string; ua: string; day: string }): string {
  return sha256Hex(`${config().APP_SECRET}|${args.day}|${args.projectId}|${args.ip}|${args.ua}`).slice(0, 16);
}

export const RETENTION_PERIOD_MS = 90 * 24 * 60 * 60 * 1000;

/** The id in the visitor's browser: random letters and digits, as the script makes it. */
export const BROWSER_ID = /^[A-Za-z0-9]{16,64}$/;

/**
 * The code stored for a visitor who has the retention switch on: an HMAC-SHA256 of
 * the random id in their browser and the project. The key is derived from the server
 * secret and the number of the current 90 day period, so it changes every 90 days
 * and the codes of one period cannot be matched with those of the next. The raw id
 * is never stored. 32 hex characters.
 */
export function retentionCode(args: { projectId: string; browserId: string; at: Date }): string {
  const period = Math.floor(args.at.getTime() / RETENTION_PERIOD_MS);
  const key = createHmac("sha256", config().APP_SECRET).update(`analytics retention v1|${period}`).digest();
  return createHmac("sha256", key).update(`${args.projectId}|${args.browserId}`).digest("hex").slice(0, 32);
}

const hit = z.object({
  p: z.string().max(2000).default("/"),
  /** Added by the current first-party snippet; legacy snippets' raw paths are discarded. */
  pt: z.literal(1).optional(),
  r: z.string().max(2000).optional(),
  us: z.string().max(400).optional(),
  um: z.string().max(400).optional(),
  uc: z.string().max(400).optional(),
  i: z.string().max(100).optional(),
});

// One page view per second per project and address is generous for a person and
// stops a loop from filling the database.
const recent = new Map<string, number>();
function tooFast(key: string, now: number): boolean {
  const last = recent.get(key) ?? 0;
  if (now - last < 1000) return true;
  recent.set(key, now);
  if (recent.size > 5000) for (const [k, t] of recent) if (now - t > 60_000) recent.delete(k);
  return false;
}

export async function recordPageview(
  key: string,
  raw: unknown,
  who: { ip: string; ua: string },
  now = new Date()
): Promise<boolean> {
  if (!key.startsWith(KEY_PREFIX) || isBot(who.ua)) return false;
  const parsed = hit.safeParse(raw);
  if (!parsed.success) throw new HttpError(400, "Bad page view", "validation");
  const db = await getDb();
  const found = await featuresForKey(key);
  if (!found) return false;
  const project = { id: found.projectId };
  const f = found.features;
  // Per-address throttling only applies to a real address: the shared unknown
  // one must not throttle the whole project as a single visitor.
  if (who.ip !== UNKNOWN_IP && tooFast(`${project.id}|${who.ip}`, now.getTime())) return false;
  const d = parsed.data;
  // Each extra is stored only while its switch is on.
  const utm = f.campaigns ? allowlistedUtm({ source: d.us, medium: d.um, campaign: d.uc }, f.utmAllowlist) : null;
  await db.insert(schema.pageviews).values({
    projectId: project.id,
    at: now,
    path: d.pt === 1 ? cleanPath(d.p) : "/",
    referrer: f.referrers ? cleanReferrer(d.r) : null,
    utmSource: utm?.source ?? null,
    utmMedium: utm?.medium ?? null,
    utmCampaign: utm?.campaign ?? null,
    country: await countryToStore(f.locations, who.ip),
    vid: f.retention && d.i && BROWSER_ID.test(d.i) ? retentionCode({ projectId: project.id, browserId: d.i, at: now }) : null,
    visitor: visitorHash({
      projectId: project.id,
      ip: who.ip,
      ua: who.ua,
      day: now.toISOString().slice(0, 10),
    }),
  });
  return true;
}

export async function prunePageviews(now = new Date()) {
  const db = await getDb();
  // Per-project retention overrides are read in the delete query; projects that
  // predate this setting keep the existing 90-day policy. Event days are coarse
  // UTC buckets, so event rows may stay up to one extra day at the boundary.
  const retention = (projectId: AnyColumn) => sql`coalesce((select ${schema.analyticsSettings.retentionDays}
    from ${schema.analyticsSettings} where ${schema.analyticsSettings.projectId} = ${projectId}), 90)`;
  const pageviewCutoff = sql`${now.getTime()} - ${retention(schema.pageviews.projectId)} * 86400000`;
  const eventCutoff = sql`date(${Math.floor(now.getTime() / 1000)}, 'unixepoch', '-' || ${retention(schema.analyticsEvents.projectId)} || ' days')`;
  const vitalCutoff = sql`${now.getTime()} - ${retention(schema.analyticsVitals.projectId)} * 86400000`;
  const errorCutoff = sql`${now.getTime()} - ${retention(schema.analyticsErrors.projectId)} * 86400000`;
  await db.delete(schema.pageviews).where(sql`${schema.pageviews.at} < (${pageviewCutoff})`);
  await db.delete(schema.analyticsEvents).where(sql`${schema.analyticsEvents.day} < (${eventCutoff})`);
  await db.delete(schema.analyticsVitals).where(sql`${schema.analyticsVitals.at} < (${vitalCutoff})`);
  await db.delete(schema.analyticsErrors).where(sql`${schema.analyticsErrors.at} < (${errorCutoff})`);
  // Heartbeats are only for the last few minutes, so they go after an hour.
  await db.delete(schema.analyticsLive).where(lt(schema.analyticsLive.at, new Date(now.getTime() - LIVE_KEEP_MS)));
}

// ------------------------------------------------------------ reading

export type AnalyticsSummary = {
  days: number;
  views: number;
  /** Distinct visitors per day, added up. The same person on two days counts twice. */
  visitors: number;
  daily: { day: string; views: number; visitors: number }[];
  pages: { path: string; views: number }[];
  referrers: { host: string; views: number }[];
};

const dayExpr = sql<string>`strftime('%Y-%m-%d', ${schema.pageviews.at} / 1000, 'unixepoch')`;

export async function analyticsSummary(
  userId: string,
  projectId: string,
  days = 30,
  now = new Date()
): Promise<AnalyticsSummary> {
  const project = await getReadableProject(userId, projectId);
  const db = await getDb();
  // Midnight of the daily series' first day (sinceDay-style), so the pages and
  // referrers lists cover the same days as the chart and not a rolling window.
  const since = new Date(
    `${new Date(now.getTime() - (days - 1) * 86_400_000).toISOString().slice(0, 10)}T00:00:00Z`
  );
  const where = and(eq(schema.pageviews.projectId, project.id), gte(schema.pageviews.at, since));

  const rows = await db
    .select({
      day: dayExpr,
      views: sql<number>`count(*)`,
      visitors: sql<number>`count(distinct ${schema.pageviews.visitor})`,
    })
    .from(schema.pageviews)
    .where(where)
    .groupBy(dayExpr);
  const byDay = new Map(rows.map((r) => [r.day, r]));

  // Every day in the range, so a quiet day is a zero and not a missing bar.
  const daily: AnalyticsSummary["daily"] = [];
  for (let i = days - 1; i >= 0; i--) {
    const day = new Date(now.getTime() - i * 86_400_000).toISOString().slice(0, 10);
    const r = byDay.get(day);
    daily.push({ day, views: Number(r?.views ?? 0), visitors: Number(r?.visitors ?? 0) });
  }

  const pages = await db
    .select({ path: schema.pageviews.path, views: sql<number>`count(*)` })
    .from(schema.pageviews)
    .where(where)
    .groupBy(schema.pageviews.path)
    .orderBy(desc(sql`count(*)`))
    .limit(10);
  const referrers = await db
    .select({ host: schema.pageviews.referrer, views: sql<number>`count(*)` })
    .from(schema.pageviews)
    .where(and(where, sql`${schema.pageviews.referrer} is not null`))
    .groupBy(schema.pageviews.referrer)
    .orderBy(desc(sql`count(*)`))
    .limit(10);

  return {
    days,
    views: daily.reduce((n, d) => n + d.views, 0),
    visitors: daily.reduce((n, d) => n + d.visitors, 0),
    daily,
    pages: pages.map((p) => ({ path: p.path, views: Number(p.views) })),
    referrers: referrers.map((r) => ({ host: r.host ?? "", views: Number(r.views) })),
  };
}

export type CampaignsSummary = {
  days: number;
  rows: { campaign: string; source: string | null; medium: string | null; views: number }[];
};

/** The top campaigns (the utm_campaign of a page view) with their source and medium, for the last `days` days. */
export async function campaignsSummary(
  userId: string,
  projectId: string,
  days = 30,
  now = new Date()
): Promise<CampaignsSummary> {
  const project = await getReadableProject(userId, projectId);
  const db = await getDb();
  const since = new Date(now.getTime() - days * 86_400_000);
  const rows = await db
    .select({
      campaign: schema.pageviews.utmCampaign,
      source: schema.pageviews.utmSource,
      medium: schema.pageviews.utmMedium,
      views: sql<number>`count(*)`,
    })
    .from(schema.pageviews)
    .where(
      and(
        eq(schema.pageviews.projectId, project.id),
        gte(schema.pageviews.at, since),
        sql`${schema.pageviews.utmCampaign} is not null`
      )
    )
    .groupBy(schema.pageviews.utmCampaign, schema.pageviews.utmSource, schema.pageviews.utmMedium)
    .orderBy(desc(sql`count(*)`), schema.pageviews.utmCampaign)
    .limit(10);
  return {
    days,
    rows: rows.map((r) => ({ campaign: r.campaign ?? "", source: r.source, medium: r.medium, views: Number(r.views) })),
  };
}
