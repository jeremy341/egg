import { eq } from "drizzle-orm";
import { z } from "zod";
import { audit } from "@/server/audit";
import { getDb, schema } from "@/server/db";
import { HttpError } from "@/server/http";
import { getProjectForUser } from "@/server/projects";
import { cleanPath } from "@/server/analytics";

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
};

export const NO_FEATURES: AnalyticsFeatures = { clicks: false, time: false, funnel: false, steps: [] };

export const MIN_STEPS = 2;
export const MAX_STEPS = 6;

/** A data-nd-track name: short, plain, and safe to put inside a script. */
export const TRACK_NAME = /^[A-Za-z0-9][A-Za-z0-9 _.:-]{0,39}$/;

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
  return { clicks: row.clicks, time: row.time, funnel: row.funnel && steps.length >= MIN_STEPS, steps };
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
  };
  if (next.funnel && next.steps.length < MIN_STEPS) {
    throw new HttpError(400, `A funnel needs at least ${MIN_STEPS} steps`, "validation");
  }
  const values = {
    clicks: next.clicks,
    time: next.time,
    funnel: next.funnel,
    funnelSteps: next.steps.length ? JSON.stringify(next.steps) : null,
    updatedAt: new Date(),
  };
  await db
    .insert(schema.analyticsSettings)
    .values({ projectId: project.id, ...values })
    .onConflictDoUpdate({ target: schema.analyticsSettings.projectId, set: values });
  const changed = (["clicks", "time", "funnel"] as const).filter((k) => next[k] !== (row?.[k] ?? false));
  if (changed.length || patch.steps) {
    await audit(userId, "analytics.settings", project.id, {
      clicks: next.clicks,
      time: next.time,
      funnel: next.funnel,
      steps: next.steps.length,
    });
  }
  return fromRow({ projectId: project.id, ...values });
}
