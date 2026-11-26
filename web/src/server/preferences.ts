import { cache } from "react";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/server/db";
import { HttpError } from "@/server/http";
import { ANALYTICS_FEATURES, parseAnalyticsDefaults, serializeAnalyticsDefaults } from "@/lib/analytics-defaults";
import {
  ACCENTS,
  AVATAR_IDS,
  DEFAULT_PREFERENCES,
  DENSITIES,
  MOTIONS,
  THEMES,
  isValidBranchName,
  type Preferences,
} from "@/lib/preferences";

/**
 * Per-person interface choices. One row per user; a person with no row gets
 * the defaults. Everything that comes in is validated here, because the row
 * is read back into HTML attributes and the top bar.
 */

// Control characters, and the invisible and direction-changing characters that
// let a name look like something else.
const HIDDEN = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u2064\u2066-\u2069\ufeff]/;

/** Empty means "not set". */
const optionalText = (max: number, what: string) =>
  z
    .string()
    .trim()
    .max(max, `${what} can be at most ${max} characters`)
    .nullable()
    .transform((v) => (v === "" ? null : v));

export const preferencesPatch = z
  .object({
    theme: z.enum(THEMES),
    accent: z.enum(ACCENTS),
    density: z.enum(DENSITIES),
    reducedMotion: z.enum(MOTIONS),
    defaultBranch: optionalText(100, "The branch name").refine(
      (v) => v === null || isValidBranchName(v),
      "That is not a valid git branch name"
    ),
    displayName: optionalText(40, "The display name").refine(
      (v) => v === null || !HIDDEN.test(v),
      "The display name cannot contain control or invisible characters"
    ),
    avatar: z.enum(AVATAR_IDS, "Pick one of the characters in the list"),
    analyticsDefaults: z
      .object(Object.fromEntries(ANALYTICS_FEATURES.map((k) => [k, z.boolean()])) as Record<(typeof ANALYTICS_FEATURES)[number], z.ZodBoolean>)
      .partial()
      .strict(),
  })
  .partial()
  .strict();

export type PreferencesPatch = z.infer<typeof preferencesPatch>;

function fromRow(row: typeof schema.userPreferences.$inferSelect | undefined): Preferences {
  if (!row) return { ...DEFAULT_PREFERENCES };
  // A value that is no longer in a list (an old row) falls back, so the page never breaks on it.
  const pick = <T extends string>(list: readonly T[], v: string, fallback: T): T =>
    (list as readonly string[]).includes(v) ? (v as T) : fallback;
  return {
    theme: pick(THEMES, row.theme, DEFAULT_PREFERENCES.theme),
    accent: pick(ACCENTS, row.accent, DEFAULT_PREFERENCES.accent),
    density: pick(DENSITIES, row.density, DEFAULT_PREFERENCES.density),
    reducedMotion: pick(MOTIONS, row.reducedMotion, DEFAULT_PREFERENCES.reducedMotion),
    defaultBranch: row.defaultBranch,
    displayName: row.displayName,
    avatar: pick(AVATAR_IDS as readonly string[], row.avatar, DEFAULT_PREFERENCES.avatar),
    analyticsDefaults: parseAnalyticsDefaults(row.analyticsDefaults),
  };
}

async function load(userId: string): Promise<Preferences> {
  const db = await getDb();
  const row = await db
    .select()
    .from(schema.userPreferences)
    .where(eq(schema.userPreferences.userId, userId))
    .get();
  return fromRow(row);
}

/**
 * The saved preferences, or the defaults. Read once per request however many
 * components ask (the shell, the top bar and the page all do).
 */
export const getPreferences = cache(load);

/** Validate a partial update and save it. Returns the full preferences afterwards. */
export async function updatePreferences(userId: string, raw: unknown): Promise<Preferences> {
  const parsed = preferencesPatch.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    const where = first?.path.length ? `${first.path.join(".")}: ` : "";
    throw new HttpError(400, `${where}${first?.message ?? "Invalid preferences"}`, "validation");
  }
  const patch = parsed.data;
  const next: Preferences = { ...(await load(userId)) };
  if (patch.theme !== undefined) next.theme = patch.theme;
  if (patch.accent !== undefined) next.accent = patch.accent;
  if (patch.density !== undefined) next.density = patch.density;
  if (patch.reducedMotion !== undefined) next.reducedMotion = patch.reducedMotion;
  if (patch.defaultBranch !== undefined) next.defaultBranch = patch.defaultBranch;
  if (patch.displayName !== undefined) next.displayName = patch.displayName;
  if (patch.avatar !== undefined) next.avatar = patch.avatar;
  // Switches in the patch are merged over the saved ones; one left out keeps its value.
  if (patch.analyticsDefaults !== undefined) {
    next.analyticsDefaults = parseAnalyticsDefaults({ ...next.analyticsDefaults, ...patch.analyticsDefaults });
  }

  const db = await getDb();
  const values = { ...next, analyticsDefaults: serializeAnalyticsDefaults(next.analyticsDefaults), updatedAt: new Date() };
  await db
    .insert(schema.userPreferences)
    .values({ userId, ...values })
    .onConflictDoUpdate({ target: schema.userPreferences.userId, set: values });
  return next;
}
