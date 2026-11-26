import { cache } from "react";
import { eq, inArray, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/server/db";
import { HttpError } from "@/server/http";
import { invalidatePublicFeed } from "@/server/public-feed-tags";
import { invalidateStatusPage } from "@/server/status-tags";
import {
  ANALYTICS_FEATURES,
  parseAnalyticsDefaults,
  serializeAnalyticsDefaults,
  type AnalyticsFeatureKey,
} from "@/lib/analytics-defaults";
import {
  AVATAR_IDS,
  DARK_PRESET_IDS,
  DEFAULT_PREFERENCES,
  DENSITIES,
  LIGHT_PRESET_IDS,
  MOTIONS,
  PRESET_IDS,
  isCustomPreset,
  isValidBranchName,
  PUBLIC_FALLBACK_NAME,
  publicName,
  themeChoiceFromLegacy,
  type DarkPreset,
  type LightPreset,
  type Preferences,
  type Preset,
  type Scheme,
} from "@/lib/preferences";
import { themeSchemes } from "@/server/custom-themes";

/**
 * Per-person interface choices. One row per user; a person with no row gets
 * the defaults. Everything that comes in is validated here, because the row
 * is read back into HTML attributes and the top bar.
 */

/**
 * What the `theme` column holds once a row has been saved with the theme choice
 * (match_device, light_preset, dark_preset, and the fixed theme in `accent`).
 * A row that still says light, dark or system has not been converted: it is read
 * once as the choice it meant (themeChoiceFromLegacy), and the next save writes
 * this marker. A brand-new row says "system" with the default accent, which reads
 * as the defaults.
 */
const CONVERTED = "choice";

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
    // Match my device: the light theme by day and the dark theme by night.
    matchDevice: z.boolean(),
    // A light theme cannot be the dark one, nor the reverse. A custom theme (`custom:<id>`) is
    // accepted here by shape and checked against the person's own themes in updatePreferences.
    lightPreset: z.custom<LightPreset>(
      (v) => typeof v === "string" && ((LIGHT_PRESET_IDS as readonly string[]).includes(v) || isCustomPreset(v)),
      "Pick one of the light themes in the list"
    ),
    darkPreset: z.custom<DarkPreset>(
      (v) => typeof v === "string" && ((DARK_PRESET_IDS as readonly string[]).includes(v) || isCustomPreset(v)),
      "Pick one of the dark themes in the list"
    ),
    // The theme that stays when Match my device is off. It is saved in the `accent` column.
    preset: z.custom<Preset>(
      (v) => typeof v === "string" && ((PRESET_IDS as readonly string[]).includes(v) || isCustomPreset(v)),
      "Pick one of the colour themes in the list"
    ),
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
    showNamePublic: z.boolean(),
    avatar: z.enum(AVATAR_IDS, "Pick one of the characters in the list"),
    analyticsDefaults: z
      .object(Object.fromEntries(ANALYTICS_FEATURES.map((k) => [k, z.boolean()])) as Record<(typeof ANALYTICS_FEATURES)[number], z.ZodBoolean>)
      .partial()
      .strict(),
  })
  .partial()
  .strict();

export type PreferencesPatch = z.infer<typeof preferencesPatch>;

function fromRow(
  row: typeof schema.userPreferences.$inferSelect | undefined,
  /** The person's custom themes and their schemes. A custom theme not in here is gone, and its choice falls back. */
  customs: ReadonlyMap<string, Scheme> = new Map()
): Preferences {
  if (!row) return { ...DEFAULT_PREFERENCES };
  // A value that is no longer in a list (an old row) falls back, so the page never breaks on it.
  const pick = <T extends string>(list: readonly T[], v: string, fallback: T): T =>
    (list as readonly string[]).includes(v) ? (v as T) : fallback;
  // A saved row holds the choice itself; an older one is converted here, once.
  // A custom theme stays only while it exists, and in a slot only while it has that slot's scheme.
  const custom = <T extends Preset>(v: string, scheme: Scheme | null): T | null =>
    isCustomPreset(v) && customs.has(v) && (scheme === null || customs.get(v) === scheme) ? (v as T) : null;
  const choice =
    row.theme === CONVERTED
      ? {
          matchDevice: row.matchDevice,
          lightPreset:
            custom<LightPreset>(row.lightPreset, "light") ?? pick(LIGHT_PRESET_IDS, row.lightPreset, DEFAULT_PREFERENCES.lightPreset),
          darkPreset:
            custom<DarkPreset>(row.darkPreset, "dark") ?? pick(DARK_PRESET_IDS, row.darkPreset, DEFAULT_PREFERENCES.darkPreset),
          preset: custom<Preset>(row.accent, null) ?? pick(PRESET_IDS, row.accent, DEFAULT_PREFERENCES.preset),
        }
      : themeChoiceFromLegacy(row.theme, row.accent);
  return {
    ...choice,
    density: pick(DENSITIES, row.density, DEFAULT_PREFERENCES.density),
    reducedMotion: pick(MOTIONS, row.reducedMotion, DEFAULT_PREFERENCES.reducedMotion),
    defaultBranch: row.defaultBranch,
    displayName: row.displayName,
    showNamePublic: row.showNamePublic,
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
  return fromRow(row, row ? await themeSchemes(userId) : undefined);
}

/**
 * The saved preferences, or the defaults. Read once per request however many
 * components ask (the shell, the top bar and the page all do).
 */
export const getPreferences = cache(load);

/**
 * A custom theme can only be chosen if it is the person's own, and a slot only
 * takes a theme of its scheme (the light slot a light theme). Someone else's
 * theme id is the same error as one that does not exist.
 */
async function checkCustomChoices(userId: string, patch: PreferencesPatch) {
  const wanted: [string | undefined, Scheme | null][] = [
    [patch.lightPreset, "light"],
    [patch.darkPreset, "dark"],
    [patch.preset, null],
  ];
  if (!wanted.some(([v]) => isCustomPreset(v))) return;
  const mine = await themeSchemes(userId);
  for (const [value, scheme] of wanted) {
    if (!isCustomPreset(value)) continue;
    const have = mine.get(value);
    if (!have) throw new HttpError(400, "That custom theme does not exist", "validation");
    if (scheme && have !== scheme) throw new HttpError(400, `Pick a ${scheme} theme for the ${scheme} slot`, "validation");
  }
}

/**
 * The stored analytics text as a JSON object, or "{}" when it is not one. Damaged text reads
 * as every switch off, and the next write replaces it. Read inside the update statement
 * below, this is what keeps two quick saves from losing each other's switches.
 */
const storedDefaults = sql`CASE WHEN json_valid(${schema.userPreferences.analyticsDefaults}) THEN CASE WHEN json_type(${schema.userPreferences.analyticsDefaults}) = 'object' THEN ${schema.userPreferences.analyticsDefaults} ELSE '{}' END ELSE '{}' END`;

/** The columns an update writes; the analytics merge is an SQL expression, not a string. */
type PreferencesSet = Partial<Omit<typeof schema.userPreferences.$inferInsert, "analyticsDefaults">> & {
  analyticsDefaults?: string | SQL;
};

/** Validate a partial update and save it. Returns the full preferences afterwards. */
export async function updatePreferences(userId: string, raw: unknown): Promise<Preferences> {
  const parsed = preferencesPatch.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    const where = first?.path.length ? `${first.path.join(".")}: ` : "";
    throw new HttpError(400, `${where}${first?.message ?? "Invalid preferences"}`, "validation");
  }
  const patch = parsed.data;
  await checkCustomChoices(userId, patch);

  const db = await getDb();
  const now = new Date();
  const current = await db
    .select({ theme: schema.userPreferences.theme, accent: schema.userPreferences.accent })
    .from(schema.userPreferences)
    .where(eq(schema.userPreferences.userId, userId))
    .get();

  // Only the fields the patch carries are written, so two quick saves of different things
  // cannot lose each other's. A row from before light and dark themes is converted by this
  // save: its choice is worked out here and written for every theme slot the patch leaves
  // alone, so the row reads the same from then on.
  const legacy = current && current.theme !== CONVERTED ? themeChoiceFromLegacy(current.theme, current.accent) : null;
  const choice = {
    matchDevice: patch.matchDevice ?? legacy?.matchDevice ?? DEFAULT_PREFERENCES.matchDevice,
    lightPreset: patch.lightPreset ?? legacy?.lightPreset ?? DEFAULT_PREFERENCES.lightPreset,
    darkPreset: patch.darkPreset ?? legacy?.darkPreset ?? DEFAULT_PREFERENCES.darkPreset,
    preset: patch.preset ?? legacy?.preset ?? DEFAULT_PREFERENCES.preset,
  };

  const set: PreferencesSet = { theme: CONVERTED, updatedAt: now };
  if (patch.matchDevice !== undefined || legacy) set.matchDevice = choice.matchDevice;
  if (patch.lightPreset !== undefined || legacy) set.lightPreset = choice.lightPreset;
  if (patch.darkPreset !== undefined || legacy) set.darkPreset = choice.darkPreset;
  if (patch.preset !== undefined || legacy) set.accent = choice.preset;
  if (patch.density !== undefined) set.density = patch.density;
  if (patch.reducedMotion !== undefined) set.reducedMotion = patch.reducedMotion;
  if (patch.defaultBranch !== undefined) set.defaultBranch = patch.defaultBranch;
  if (patch.displayName !== undefined) set.displayName = patch.displayName;
  if (patch.showNamePublic !== undefined) set.showNamePublic = patch.showNamePublic;
  if (patch.avatar !== undefined) set.avatar = patch.avatar;
  // Switches in the patch are merged over the saved ones inside the statement itself, the
  // way setMark merges onboarding marks; one left out keeps its value. A switch switched
  // off is dropped, which is what serializeAnalyticsDefaults stores.
  const switches = Object.entries(patch.analyticsDefaults ?? {}) as [AnalyticsFeatureKey, boolean][];
  if (switches.length > 0) {
    let merged = storedDefaults;
    for (const [key, on] of switches) {
      merged = on ? sql`json_set(${merged}, ${`$.${key}`}, json('true'))` : sql`json_remove(${merged}, ${`$.${key}`})`;
    }
    set.analyticsDefaults = merged;
  }

  // A row that does not exist yet gets the defaults, with the patch on top.
  const values = {
    theme: CONVERTED,
    matchDevice: choice.matchDevice,
    lightPreset: choice.lightPreset,
    darkPreset: choice.darkPreset,
    accent: choice.preset,
    density: patch.density ?? DEFAULT_PREFERENCES.density,
    reducedMotion: patch.reducedMotion ?? DEFAULT_PREFERENCES.reducedMotion,
    defaultBranch: patch.defaultBranch ?? DEFAULT_PREFERENCES.defaultBranch,
    displayName: patch.displayName ?? DEFAULT_PREFERENCES.displayName,
    showNamePublic: patch.showNamePublic ?? DEFAULT_PREFERENCES.showNamePublic,
    avatar: patch.avatar ?? DEFAULT_PREFERENCES.avatar,
    analyticsDefaults: serializeAnalyticsDefaults({ ...DEFAULT_PREFERENCES.analyticsDefaults, ...patch.analyticsDefaults }),
    updatedAt: now,
  };
  const [row] = await db
    .insert(schema.userPreferences)
    .values({ userId, ...values })
    .onConflictDoUpdate({ target: schema.userPreferences.userId, set })
    .returning();
  // The name on public pages is cached; drop those pages now rather than after their cache time.
  if (patch.displayName !== undefined || patch.showNamePublic !== undefined) await refreshPublicNames(userId);
  return fromRow(row, await themeSchemes(userId));
}

/**
 * The public name of each of these people, keyed by user id. Read in one query. A person with no
 * saved preferences gets the default (their name is shown only once they set a display name).
 */
export async function publicNamesFor(userIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const ids = [...new Set(userIds)];
  if (ids.length === 0) return out;
  const db = await getDb();
  const rows = await db
    .select({
      userId: schema.userPreferences.userId,
      displayName: schema.userPreferences.displayName,
      showNamePublic: schema.userPreferences.showNamePublic,
    })
    .from(schema.userPreferences)
    .where(inArray(schema.userPreferences.userId, ids));
  const byUser = new Map(rows.map((r) => [r.userId, r]));
  for (const id of ids) {
    const row = byUser.get(id);
    out.set(id, publicName(row ?? { displayName: null, showNamePublic: DEFAULT_PREFERENCES.showNamePublic }));
  }
  return out;
}

/** The public name of one person (see publicNamesFor). */
export async function publicNameFor(userId: string): Promise<string> {
  return (await publicNamesFor([userId])).get(userId) ?? PUBLIC_FALLBACK_NAME;
}

/** Drop the cached homepage feed and every public status page of this person's projects. */
async function refreshPublicNames(userId: string) {
  const db = await getDb();
  const keys = await db
    .select({ statusKey: schema.projects.statusKey })
    .from(schema.projects)
    .where(eq(schema.projects.userId, userId));
  await invalidatePublicFeed();
  for (const { statusKey } of keys) await invalidateStatusPage(statusKey);
}
