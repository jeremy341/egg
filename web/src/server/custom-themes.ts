import { randomBytes } from "node:crypto";
import { and, asc, count, eq, type AnyColumn } from "drizzle-orm";
import { z } from "zod";
import {
  CUSTOM_THEME_LIMIT,
  THEME_TOKENS,
  checkContrast,
  checkThemeName,
  describePair,
  tokenProblem,
  upgradeTokens,
  type ContrastPair,
  type CustomThemeView,
  type ThemeScheme,
  type ThemeTokens,
} from "@/lib/custom-theme";
import { isCustomPreset, type CustomPresetId, type CustomThemes } from "@/lib/preferences";
import { isHexColor } from "@/lib/theme-color";
import { getDb, schema } from "@/server/db";
import { HttpError, notFound } from "@/server/http";

/**
 * A person's own colour themes. Every read and write is by (theme id, owner),
 * so another person's theme id is a plain "not found". Colours are checked with
 * the same hex rule as the cookie and the pre-paint script (isHexColor), when
 * they come in and again when they are read back.
 */

export type { CustomThemeView };

// ----------------------------------------------------------------- validation

const hex = z.string().refine(isHexColor, "must be a hex colour such as #1a2b3c");

/** The shape of a theme from the editor or an import: exactly `name`, `scheme` and `tokens`. Same rules as parseThemeInput. */
export const themeInput = z.strictObject({
  name: z.string().transform((v, ctx) => {
    const r = checkThemeName(v);
    if (!r.ok) {
      ctx.addIssue({ code: "custom", message: r.error });
      return z.NEVER;
    }
    return r.name;
  }),
  scheme: z.enum(["light", "dark"], 'scheme must be "light" or "dark"'),
  tokens: z.strictObject(Object.fromEntries(THEME_TOKENS.map((name) => [name, hex])) as Record<(typeof THEME_TOKENS)[number], z.ZodString>),
});

export type ThemeInputData = z.infer<typeof themeInput>;

function parseInput(raw: unknown): ThemeInputData {
  const parsed = themeInput.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    const where = first?.path.length ? `${first.path.join(".")}: ` : "";
    throw new HttpError(400, `${where}${first?.message ?? "Invalid theme"}`, "validation");
  }
  return parsed.data;
}

/** Why a save is refused, in words: each blocking pair with its ratio and the suggested colour. */
export function contrastMessage(blocking: readonly ContrastPair[]): string {
  return blocking.map(describePair).join(" ");
}

export type SaveResult =
  | { ok: true; theme: CustomThemeView; warnings: ContrastPair[] }
  | { ok: false; blocking: ContrastPair[]; message: string };

// ----------------------------------------------------------------------- rows

function view(row: typeof schema.userThemes.$inferSelect): CustomThemeView | null {
  let tokens: unknown;
  try {
    tokens = JSON.parse(row.tokens);
  } catch {
    return null;
  }
  if (row.scheme !== "light" && row.scheme !== "dark") return null;
  // A theme saved before the selected-text and button-hover colours existed gets both worked out from its own colours.
  tokens = upgradeTokens(tokens, row.scheme);
  // A row that no longer passes the rules is not shown or applied; the person falls back to the default.
  if (tokenProblem(tokens) !== null) return null;
  const preset = `custom:${row.id}`;
  if (!isCustomPreset(preset)) return null;
  return {
    id: row.id,
    preset,
    name: row.name,
    scheme: row.scheme,
    tokens: tokens as ThemeTokens,
    createdAt: row.createdAt.getTime(),
    updatedAt: row.updatedAt.getTime(),
  };
}

/** The person's themes, oldest first. */
export async function listThemes(userId: string): Promise<CustomThemeView[]> {
  const db = await getDb();
  const rows = await db
    .select()
    .from(schema.userThemes)
    .where(eq(schema.userThemes.userId, userId))
    .orderBy(asc(schema.userThemes.createdAt), asc(schema.userThemes.id));
  return rows.flatMap((r) => view(r) ?? []);
}

/** One theme of this person. Someone else's, or an unknown id, is not found. */
export async function getTheme(userId: string, id: string): Promise<CustomThemeView> {
  const db = await getDb();
  const row = await db
    .select()
    .from(schema.userThemes)
    .where(and(eq(schema.userThemes.id, id), eq(schema.userThemes.userId, userId)))
    .get();
  const found = row ? view(row) : null;
  if (!found) throw notFound("Theme not found");
  return found;
}

/** What the egg_prefs cookie and the first paint need: scheme and colours by `custom:<id>`. */
export async function cookieThemes(userId: string): Promise<CustomThemes> {
  return Object.fromEntries((await listThemes(userId)).map((t) => [t.preset, { scheme: t.scheme, tokens: t.tokens }]));
}

// ------------------------------------------------------------------- writing

const newThemeId = () => randomBytes(8).toString("hex");

/**
 * Save a new theme. Body text on the page or a card under 4.5:1 refuses the
 * save (`ok: false`, with the pair, its ratio and a colour that passes); the
 * other pairs come back as `warnings` and the theme is saved. More than 20
 * themes is a 409.
 */
export async function createTheme(userId: string, raw: unknown): Promise<SaveResult> {
  const input = parseInput(raw);
  const report = checkContrast(input.tokens as ThemeTokens, input.scheme);
  if (report.blocking.length > 0) return { ok: false, blocking: report.blocking, message: contrastMessage(report.blocking) };

  const db = await getDb();
  const now = new Date();
  const id = newThemeId();
  await db.transaction(async (tx) => {
    const [{ n }] = await tx.select({ n: count() }).from(schema.userThemes).where(eq(schema.userThemes.userId, userId));
    if (n >= CUSTOM_THEME_LIMIT) {
      throw new HttpError(409, `You can have up to ${CUSTOM_THEME_LIMIT} custom themes. Delete one to make room.`, "limit");
    }
    await tx.insert(schema.userThemes).values({
      id,
      userId,
      name: input.name,
      scheme: input.scheme,
      tokens: JSON.stringify(input.tokens),
      createdAt: now,
      updatedAt: now,
    });
  });
  return { ok: true, theme: await getTheme(userId, id), warnings: report.warnings };
}

/**
 * Replace a theme of this person (name, scheme and colours), under the same
 * contrast rules. If the scheme changes, a light or dark slot that now holds a
 * theme of the other scheme goes back to the default for that slot.
 */
export async function updateTheme(userId: string, id: string, raw: unknown): Promise<SaveResult> {
  const input = parseInput(raw);
  const before = await getTheme(userId, id);
  const report = checkContrast(input.tokens as ThemeTokens, input.scheme);
  if (report.blocking.length > 0) return { ok: false, blocking: report.blocking, message: contrastMessage(report.blocking) };

  const db = await getDb();
  await db.transaction(async (tx) => {
    await tx
      .update(schema.userThemes)
      .set({ name: input.name, scheme: input.scheme, tokens: JSON.stringify(input.tokens), updatedAt: new Date() })
      .where(and(eq(schema.userThemes.id, id), eq(schema.userThemes.userId, userId)));
    if (before.scheme !== input.scheme) {
      // The slot of the old scheme no longer fits this theme.
      const column = before.scheme === "light" ? schema.userPreferences.lightPreset : schema.userPreferences.darkPreset;
      const key = before.scheme === "light" ? "lightPreset" : "darkPreset";
      await tx
        .update(schema.userPreferences)
        .set({ [key]: before.scheme === "light" ? "egg-light" : "egg-dark" })
        .where(and(eq(schema.userPreferences.userId, userId), eq(column, before.preset)));
    }
  });
  return { ok: true, theme: await getTheme(userId, id), warnings: report.warnings };
}

/**
 * Delete a theme of this person. Any choice that used it goes back to the
 * default for its scheme (Egg Light or Egg Dark). Someone else's or an unknown
 * id is not found.
 */
export async function deleteTheme(userId: string, id: string): Promise<void> {
  const theme = await getTheme(userId, id);
  const db = await getDb();
  await db.transaction(async (tx) => {
    await tx.delete(schema.userThemes).where(and(eq(schema.userThemes.id, id), eq(schema.userThemes.userId, userId)));
    await settleChoices(tx, userId, theme.preset, theme.scheme);
  });
}

type Tx = Parameters<Parameters<Awaited<ReturnType<typeof getDb>>["transaction"]>[0]>[0];

/** Where `preset` (a custom theme that is gone, or changed scheme) was chosen, choose the default for `scheme` instead. */
async function settleChoices(tx: Tx, userId: string, preset: CustomPresetId, scheme: ThemeScheme) {
  const fallback = scheme === "dark" ? "egg-dark" : "egg-light";
  const where = (col: AnyColumn) => and(eq(schema.userPreferences.userId, userId), eq(col, preset));
  await tx.update(schema.userPreferences).set({ lightPreset: "egg-light" }).where(where(schema.userPreferences.lightPreset));
  await tx.update(schema.userPreferences).set({ darkPreset: "egg-dark" }).where(where(schema.userPreferences.darkPreset));
  await tx.update(schema.userPreferences).set({ accent: fallback }).where(where(schema.userPreferences.accent));
}

/** Which custom theme ids this person has, with their schemes. For checking a stored choice. */
export async function themeSchemes(userId: string): Promise<Map<CustomPresetId, ThemeScheme>> {
  return new Map((await listThemes(userId)).map((t) => [t.preset, t.scheme]));
}
