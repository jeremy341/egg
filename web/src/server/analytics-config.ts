import { eq } from "drizzle-orm";
import { z } from "zod";
import { parseAnalyticsDefaults, type AnalyticsDefaults } from "@/lib/analytics-defaults";
import { audit } from "@/server/audit";
import { getDb, schema } from "@/server/db";
import { HttpError } from "@/server/http";
import { getProjectForUser } from "@/server/projects";
import {
  EMPTY_UTM_ALLOWLIST,
  TRACK_NAME,
  UTM_ALLOWLIST_MAX,
  UTM_KEYS,
  UTM_ALLOWLIST_VALUE,
  cleanPath,
  parseUtmAllowlist,
  type UtmAllowlist,
} from "@/server/analytics-fields";

/**
 * Which opt-in analytics features a project has switched on. Everything is off
 * until the owner turns it on. The script and the collector both read this, so a
 * stale copy of the script cannot record something the owner has since turned off.
 */

export type FunnelStep = { kind: "page" | "track"; value: string };

export type AnalyticsFeatures = {
  clicks: boolean;
  time: boolean;
  funnel: boolean;
  steps: FunnelStep[];
  /** The host of the referring site of a page view. Campaign values are a separate switch. */
  referrers: boolean;
  /** UTM tracking is a separate opt-in with exact allowlisted campaign labels. */
  campaigns: boolean;
  utmAllowlist: UtmAllowlist;
  /** Capped at 90 days to match the visitor-id key rotation period. */
  retentionDays: 30 | 60 | 90;
  /** Web vitals. */
  vitals: boolean;
  /** Custom events with an optional value. */
  events: boolean;
  /** The "on the site now" numbers. */
  live: boolean;
  /** A random id in the visitor's browser, for new versus returning visitors. */
  retention: boolean;
  /** The visitor's country (two letters only, never the address), looked up offline. */
  locations: boolean;
};

export const NO_FEATURES: AnalyticsFeatures = {
  clicks: false,
  time: false,
  funnel: false,
  steps: [],
  referrers: false,
  campaigns: false,
  utmAllowlist: { ...EMPTY_UTM_ALLOWLIST },
  retentionDays: 90,
  vitals: false,
  events: false,
  live: false,
  retention: false,
  locations: false,
};

const SWITCHES = ["clicks", "time", "funnel", "referrers", "campaigns", "vitals", "events", "live", "retention", "locations"] as const;

export const MIN_STEPS = 2;
export const MAX_STEPS = 6;

export { TRACK_NAME };

const step = z
  .object({ kind: z.enum(["page", "track"]), value: z.string().trim().min(1).max(200) })
  .transform((s, ctx): FunnelStep => {
    if (s.kind === "page") {
      if (!s.value.startsWith("/")) {
        ctx.addIssue({ code: "custom", message: `A page step starts with "/", like /pricing` });
        return z.NEVER;
      }
      return { kind: "page", value: cleanPath(s.value) };
    }
    if (!TRACK_NAME.test(s.value)) {
      ctx.addIssue({
        code: "custom",
        message: "A tracked name uses letters, numbers, spaces and - _ . : and is at most 40 characters",
      });
      return z.NEVER;
    }
    return { kind: "track", value: s.value };
  });

export const featuresPatch = z.object({
  clicks: z.boolean().optional(),
  time: z.boolean().optional(),
  funnel: z.boolean().optional(),
  referrers: z.boolean().optional(),
  campaigns: z.boolean().optional(),
  utmAllowlist: z.object({
    source: z.array(z.string().regex(UTM_ALLOWLIST_VALUE, "Use short static labels with letters, numbers, dot, dash or underscore.")).max(UTM_ALLOWLIST_MAX).optional(),
    medium: z.array(z.string().regex(UTM_ALLOWLIST_VALUE, "Use short static labels with letters, numbers, dot, dash or underscore.")).max(UTM_ALLOWLIST_MAX).optional(),
    campaign: z.array(z.string().regex(UTM_ALLOWLIST_VALUE, "Use short static labels with letters, numbers, dot, dash or underscore.")).max(UTM_ALLOWLIST_MAX).optional(),
  }).strict().optional(),
  retentionDays: z.union([z.literal(30), z.literal(60), z.literal(90)]).optional(),
  vitals: z.boolean().optional(),
  events: z.boolean().optional(),
  live: z.boolean().optional(),
  retention: z.boolean().optional(),
  locations: z.boolean().optional(),
  steps: z.array(step).max(MAX_STEPS, `A funnel has at most ${MAX_STEPS} steps`).optional(),
});
export type FeaturesPatch = z.input<typeof featuresPatch>;

/** The steps stored as JSON, or none when the text is missing or damaged. */
export function parseSteps(json: string | null | undefined): FunnelStep[] {
  if (!json) return [];
  try {
    const parsed = z.array(step).safeParse(JSON.parse(json));
    return parsed.success ? parsed.data.slice(0, MAX_STEPS) : [];
  } catch {
    return [];
  }
}

function fromRow(row: typeof schema.analyticsSettings.$inferSelect | undefined): AnalyticsFeatures {
  if (!row) return { ...NO_FEATURES, steps: [] };
  const steps = parseSteps(row.funnelSteps);
  // A funnel with fewer than two steps measures nothing, so it counts as off.
  return {
    clicks: row.clicks,
    time: row.time,
    funnel: row.funnel && steps.length >= MIN_STEPS,
    steps,
    referrers: row.referrers,
    campaigns: row.campaigns,
    utmAllowlist: parseUtmAllowlist(row.utmAllowlist),
    retentionDays: row.retentionDays === 30 || row.retentionDays === 60 ? row.retentionDays : 90,
    vitals: row.vitals,
    events: row.events,
    live: row.live,
    retention: row.retention,
    locations: row.locations,
  };
}

/**
 * The features a person wants on for projects they turn analytics on for from now
 * on. Empty (everything off) when they have saved nothing.
 */
export async function getAnalyticsDefaults(userId: string): Promise<AnalyticsDefaults> {
  const db = await getDb();
  const row = await db
    .select({ analyticsDefaults: schema.userPreferences.analyticsDefaults })
    .from(schema.userPreferences)
    .where(eq(schema.userPreferences.userId, userId))
    .get();
  return parseAnalyticsDefaults(row?.analyticsDefaults);
}

/** The switches for a project. No permission check: for internal callers that already have one. */
export async function getFeatures(projectId: string): Promise<AnalyticsFeatures> {
  const db = await getDb();
  const row = await db
    .select()
    .from(schema.analyticsSettings)
    .where(eq(schema.analyticsSettings.projectId, projectId))
    .get();
  return fromRow(row);
}

/** The project that owns an analytics key and its switches, or null for an unknown key. */
export async function featuresForKey(key: string): Promise<{ projectId: string; features: AnalyticsFeatures } | null> {
  const db = await getDb();
  const project = await db
    .select({ id: schema.projects.id })
    .from(schema.projects)
    .where(eq(schema.projects.analyticsKey, key))
    .get();
  if (!project) return null;
  return { projectId: project.id, features: await getFeatures(project.id) };
}

export async function featuresForUser(userId: string, projectId: string): Promise<AnalyticsFeatures> {
  const project = await getProjectForUser(userId, projectId);
  return getFeatures(project.id);
}

/** Change some of the switches. Anything left out keeps its value. */
export async function updateFeatures(userId: string, projectId: string, raw: FeaturesPatch): Promise<AnalyticsFeatures> {
  const parsed = featuresPatch.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw new HttpError(400, first?.message ?? "Invalid analytics settings", "validation");
  }
  const patch = parsed.data;
  const project = await getProjectForUser(userId, projectId);
  const db = await getDb();
  const row = await db
    .select()
    .from(schema.analyticsSettings)
    .where(eq(schema.analyticsSettings.projectId, project.id))
    .get();
  const next = {
    clicks: patch.clicks ?? row?.clicks ?? false,
    time: patch.time ?? row?.time ?? false,
    funnel: patch.funnel ?? row?.funnel ?? false,
    steps: patch.steps ?? parseSteps(row?.funnelSteps),
    referrers: patch.referrers ?? row?.referrers ?? false,
    campaigns: patch.campaigns ?? row?.campaigns ?? false,
    utmAllowlist: parseUtmAllowlist(row?.utmAllowlist),
    retentionDays: patch.retentionDays ?? (row?.retentionDays === 30 || row?.retentionDays === 60 ? row.retentionDays : 90),
    vitals: patch.vitals ?? row?.vitals ?? false,
    events: patch.events ?? row?.events ?? false,
    live: patch.live ?? row?.live ?? false,
    retention: patch.retention ?? row?.retention ?? false,
    locations: patch.locations ?? row?.locations ?? false,
  };
  if (patch.utmAllowlist) {
    const merged = Object.fromEntries(UTM_KEYS.map((key) => [key, patch.utmAllowlist?.[key] ?? next.utmAllowlist[key]]));
    next.utmAllowlist = parseUtmAllowlist(merged);
  }
  if (next.campaigns && UTM_KEYS.every((key) => next.utmAllowlist[key].length === 0)) {
    throw new HttpError(400, "Allow at least one safe campaign label before turning campaigns on.", "validation");
  }
  // A funnel switched on by the account defaults has no steps yet and waits for them, so
  // only a change to the funnel itself is held to the two-step minimum.
  if ((patch.funnel !== undefined || patch.steps !== undefined) && next.funnel && next.steps.length < MIN_STEPS) {
    throw new HttpError(400, `A funnel needs at least ${MIN_STEPS} steps`, "validation");
  }
  const values = {
    clicks: next.clicks,
    time: next.time,
    funnel: next.funnel,
    funnelSteps: next.steps.length ? JSON.stringify(next.steps) : null,
    referrers: next.referrers,
    campaigns: next.campaigns,
    utmAllowlist: JSON.stringify(next.utmAllowlist),
    retentionDays: next.retentionDays,
    vitals: next.vitals,
    events: next.events,
    live: next.live,
    retention: next.retention,
    locations: next.locations,
    updatedAt: new Date(),
  };
  await db
    .insert(schema.analyticsSettings)
    .values({ projectId: project.id, ...values })
    .onConflictDoUpdate({ target: schema.analyticsSettings.projectId, set: values });
  // Turning retention off deletes the codes already stored, so "off" also means "forgotten".
  if (row?.retention && !next.retention) {
    await db.update(schema.pageviews).set({ vid: null }).where(eq(schema.pageviews.projectId, project.id));
    await db.delete(schema.analyticsLive).where(eq(schema.analyticsLive.projectId, project.id));
  }
  // Turning countries off deletes the codes already stored, so "off" also means "forgotten".
  if (row?.locations && !next.locations) {
    await db.update(schema.pageviews).set({ country: null }).where(eq(schema.pageviews.projectId, project.id));
  }
  // The same for referrers (the stored host) and for campaigns (the three utm values).
  if (row?.referrers && !next.referrers) {
    await db.update(schema.pageviews).set({ referrer: null }).where(eq(schema.pageviews.projectId, project.id));
  }
  if (row?.campaigns && !next.campaigns) {
    await db
      .update(schema.pageviews)
      .set({ utmSource: null, utmMedium: null, utmCampaign: null })
      .where(eq(schema.pageviews.projectId, project.id));
  }
  const changed = SWITCHES.filter((k) => next[k] !== (row?.[k] ?? false));
  if (changed.length || patch.steps) {
    await audit(userId, "analytics.settings", project.id, {
      clicks: next.clicks,
      time: next.time,
      funnel: next.funnel,
      steps: next.steps.length,
      referrers: next.referrers,
      campaigns: next.campaigns,
      retentionDays: next.retentionDays,
      vitals: next.vitals,
      events: next.events,
      live: next.live,
      retention: next.retention,
      locations: next.locations,
    });
  }
  return fromRow({ projectId: project.id, ...values });
}
