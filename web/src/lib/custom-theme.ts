/**
 * Custom colour themes: the token list, how a theme is built from eight
 * colours, the contrast guard, and the rules a saved or imported theme must
 * meet. Pure, so the server (which validates and saves), the editor (which
 * checks as you type) and the import all use the same code.
 */

import type { CustomPresetId } from "@/lib/preferences";
import {
  ensureContrast,
  contrastHex,
  isHexColor,
  mixRgb,
  parseHex,
  toHex,
  toHexAlpha,
  type Rgb,
} from "@/lib/theme-color";

export type ThemeScheme = "light" | "dark";

/** A saved theme as the server sends it. */
export type CustomThemeView = {
  /** The id inside `preset`. */
  id: string;
  /** What the preferences store: `custom:<id>`. */
  preset: CustomPresetId;
  name: string;
  scheme: ThemeScheme;
  tokens: ThemeTokens;
  createdAt: number;
  updatedAt: number;
};

/** At most this many custom themes per account. */
export const CUSTOM_THEME_LIMIT = 20;
export const THEME_NAME_MAX = 40;
/** A theme file larger than this is refused before it is read. */
export const THEME_FILE_MAX_BYTES = 8 * 1024;

/**
 * Every colour a theme sets, in globals.css names without the leading `--`.
 * This is the same list a built-in theme block writes out. The ORDER IS PART
 * OF THE FORMAT: the cookie and the `--ct-<n>` variables use the position, so
 * add new tokens at the end and never reorder.
 */
export const THEME_TOKENS = [
  "ds-background-100", "ds-background-200",
  "ds-gray-100", "ds-gray-200", "ds-gray-300", "ds-gray-400", "ds-gray-500",
  "ds-gray-600", "ds-gray-700", "ds-gray-800", "ds-gray-900", "ds-gray-1000",
  "ds-gray-alpha-100", "ds-gray-alpha-200", "ds-gray-alpha-300", "ds-gray-alpha-400", "ds-gray-alpha-500", "ds-gray-alpha-600",
  "ds-blue-100", "ds-blue-700", "ds-blue-900",
  "ds-red-100", "ds-red-800", "ds-red-900",
  "ds-green-100", "ds-green-900",
  "ds-teal-600", "ds-teal-900",
  "ds-amber-100", "ds-amber-700", "ds-amber-900",
  "ds-focus-color",
  "foreground", "muted-foreground", "subtle-foreground",
  "primary", "primary-foreground",
  "brand", "brand-foreground", "brand-soft", "brand-text",
  "link", "selected",
  "success", "warning", "destructive", "destructive-foreground",
  "status-ready", "status-building", "status-error",
  "pixel-dot", "skeleton-highlight",
  "selected-foreground", "primary-hover",
] as const;

export type ThemeTokenName = (typeof THEME_TOKENS)[number];
export type ThemeTokens = Record<ThemeTokenName, string>;

const TOKEN_SET: ReadonlySet<string> = new Set(THEME_TOKENS);

/** The name of the CSS variable the pre-paint script sets for a token: `--ct-<position>`. */
export const customVarName = (index: number) => `--ct-${index}`;

// ------------------------------------------------------------------- the eight

export const QUICK_FIELDS = [
  { key: "page", label: "Page background", hint: "Behind everything" },
  { key: "card", label: "Card surface", hint: "Cards, menus and the sidebar" },
  { key: "border", label: "Border", hint: "Lines around cards and inputs" },
  { key: "text", label: "Text", hint: "Body text" },
  { key: "muted", label: "Muted text", hint: "Captions and hints" },
  { key: "primary", label: "Primary", hint: "Buttons" },
  { key: "link", label: "Link", hint: "Links and the focus ring" },
  { key: "danger", label: "Danger", hint: "Errors and delete" },
] as const;

export type QuickKey = (typeof QUICK_FIELDS)[number]["key"];
export type QuickColors = Record<QuickKey, string>;

/** Starting colours for a new theme: Egg Light and Egg Dark. */
export const QUICK_DEFAULTS: Record<ThemeScheme, QuickColors> = {
  light: { page: "#fafafa", card: "#ffffff", border: "#17171724", text: "#171717", muted: "#4d4d4d", primary: "#171717", link: "#0067d6", danger: "#c4262e" },
  dark: { page: "#000000", card: "#0a0a0a", border: "#ededed24", text: "#ededed", muted: "#a1a1a1", primary: "#ededed", link: "#52a8ff", danger: "#ff6166" },
};

const flat = (hex: string, base: Rgb): Rgb => {
  const c = parseHex(hex) ?? [0, 0, 0, 1];
  return mixRgb(c, base, c[3]);
};

/**
 * Colours a source can set beyond the eight (the VS Code mapping does). Each
 * one replaces the derived value, and the tints built from it follow it.
 * `onPrimary` is the text on a primary button, `selectedForeground` the text
 * on a selected row and `primaryHover` the primary button while hovered.
 */
export type Accents = Partial<
  Record<"ring" | "selected" | "success" | "warning" | "onPrimary" | "selectedForeground" | "primaryHover", string>
>;

/**
 * All the tokens of a theme from its eight colours. The eight are used as they
 * are. The rest (the grey steps, tints, the focus ring, hover colours, status
 * colours, the text on buttons) are built from them, and nudged in lightness
 * where needed so they always read. `overrides` lets a built-in palette set a
 * derived token itself (its own green, say).
 */
export function deriveTokens(
  q: QuickColors,
  scheme: ThemeScheme,
  overrides: Partial<ThemeTokens> = {},
  accents: Accents = {}
): ThemeTokens {
  const dark = scheme === "dark";
  const base: Rgb = dark ? [0, 0, 0] : [255, 255, 255];
  const page = toHex(flat(q.page, base));
  const card = toHex(flat(q.card, base));
  const pageRgb = parseHex(page)!.slice(0, 3) as Rgb;
  const cardRgb = parseHex(card)!.slice(0, 3) as Rgb;
  const textRgb = flat(q.text, cardRgb);
  const text = toHex(textRgb);
  const onBoth = [page, card];
  const ensure = (hex: string, backgrounds: readonly string[], min: number) => ensureContrast(hex, backgrounds, min, scheme);

  // Greys: the text colour mixed into the card, a little at a time.
  const gray = (amount: number) => toHex(mixRgb(textRgb, cardRgb, amount));
  const alpha = (a: number) => toHexAlpha(textRgb, a);

  const mutedSurface = gray(0.06);

  // The best text colour on a solid: the theme's own page or card colour when it reads, else black or white.
  const textOn = (solid: string, hover?: string): string => {
    const score = (fg: string) => Math.min(contrastHex(fg, solid, scheme), hover ? contrastHex(fg, hover, scheme) : Infinity);
    const own = dark ? page : card;
    if (score(own) >= 4.6) return own;
    return ["#ffffff", "#000000", card, text, page].reduce((best, c) => (score(c) > score(best) ? c : best));
  };

  const primary = q.primary;
  const primaryRgb = flat(primary, cardRgb);
  // On hover the button blends 15% toward the page, unless the source gives its own hover colour.
  const primaryHover = accents.primaryHover ?? toHex(mixRgb(primaryRgb, pageRgb, 0.85));
  const primaryFg = accents.onPrimary ?? textOn(toHex(primaryRgb), primaryHover);

  const linkRgb = flat(q.link, cardRgb);
  // The tint behind accent text: 10% of the link colour, lessened (never past none) while the link would not read on it.
  let soft = toHex(mixRgb(linkRgb, cardRgb, 0.1));
  for (let pct = 9; pct >= 0 && contrastHex(q.link, soft, scheme) < 4.5; pct--) soft = toHex(mixRgb(linkRgb, cardRgb, pct / 100));
  const ring = accents.ring ?? ensure(q.link, onBoth, 3);
  const brandText = ensure(q.link, [page, card, soft], 4.5);

  const hue = (h: number, s: number, lDark: number, lLight: number) => {
    // hsl as a hex, then nudged so it reads on the page and the card.
    const l = dark ? lDark : lLight;
    const k = (n: number) => (n + h / 30) % 12;
    const a = (s / 100) * Math.min(l / 100, 1 - l / 100);
    const f = (n: number) => l / 100 - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    return ensure(toHex([f(0) * 255, f(8) * 255, f(4) * 255]), onBoth, 4.5);
  };
  const success = accents.success ?? hue(135, 45, 62, 28);
  const warning = accents.warning ?? hue(40, 90, 62, 26);
  const teal = hue(175, 60, 55, 25);

  // The text on a selected row: the page text, nudged only when it would not reach 4.5:1 on the selected background over the page and a card.
  const selected = accents.selected ?? toHexAlpha(linkRgb, dark ? 0.15 : 0.1);
  const selectedOn = onBoth.map((bg) => toHex(flat(selected, parseHex(bg)!.slice(0, 3) as Rgb)));
  const selectedFg =
    accents.selectedForeground ?? (selectedOn.every((bg) => contrastHex(text, bg, scheme) >= 4.5) ? text : ensure(text, selectedOn, 4.5));

  const danger = q.danger;
  const dangerRgb = flat(danger, cardRgb);
  const tint = (c: Rgb) => toHex(mixRgb(c, cardRgb, 0.14));

  const out: ThemeTokens = {
    "ds-background-100": card,
    "ds-background-200": page,
    "ds-gray-100": mutedSurface,
    "ds-gray-200": gray(0.09),
    "ds-gray-300": gray(0.13),
    "ds-gray-400": gray(0.16),
    "ds-gray-500": gray(0.27),
    "ds-gray-600": gray(0.5),
    "ds-gray-700": gray(0.56),
    "ds-gray-800": gray(0.62),
    "ds-gray-900": q.muted,
    "ds-gray-1000": text,
    "ds-gray-alpha-100": alpha(dark ? 0.06 : 0.05),
    "ds-gray-alpha-200": alpha(dark ? 0.09 : 0.08),
    "ds-gray-alpha-300": alpha(dark ? 0.13 : 0.1),
    "ds-gray-alpha-400": q.border,
    "ds-gray-alpha-500": alpha(dark ? 0.24 : 0.21),
    "ds-gray-alpha-600": alpha(dark ? 0.51 : 0.34),
    "ds-blue-100": soft,
    "ds-blue-700": q.link,
    "ds-blue-900": brandText,
    "ds-red-100": tint(dangerRgb),
    "ds-red-800": danger,
    "ds-red-900": danger,
    "ds-green-100": tint(flat(success, cardRgb)),
    "ds-green-900": success,
    "ds-teal-600": teal,
    "ds-teal-900": teal,
    "ds-amber-100": tint(flat(warning, cardRgb)),
    "ds-amber-700": warning,
    "ds-amber-900": warning,
    "ds-focus-color": ring,
    foreground: text,
    "muted-foreground": q.muted,
    "subtle-foreground": ensure(toHex(mixRgb(flat(q.muted, cardRgb), cardRgb, 0.88)), [page, card], 4.5),
    primary,
    "primary-foreground": primaryFg,
    brand: primary,
    "brand-foreground": primaryFg,
    "brand-soft": soft,
    "brand-text": brandText,
    link: q.link,
    selected,
    success,
    warning,
    destructive: danger,
    "destructive-foreground": textOn(toHex(dangerRgb)),
    "status-ready": teal,
    "status-building": warning,
    "status-error": danger,
    "pixel-dot": alpha(0.14),
    "skeleton-highlight": gray(0.13),
    "selected-foreground": selectedFg,
    "primary-hover": primaryHover,
  };
  return { ...out, ...overrides };
}

/**
 * A theme saved before `selected-foreground` and `primary-hover` existed has
 * every other colour and none of these two. Returns it with both worked out
 * from its own colours (as deriveTokens does for any theme), or the input as it
 * was when it is not such a theme. Keeps a saved theme working instead of
 * hiding it.
 */
export function upgradeTokens(raw: unknown, scheme: ThemeScheme): unknown {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return raw;
  const obj = raw as Record<string, unknown>;
  const legacy = THEME_TOKENS.slice(0, -2);
  const isLegacy =
    Object.keys(obj).length === legacy.length && legacy.every((n) => isHexColor(obj[n])) && !("selected-foreground" in obj) && !("primary-hover" in obj);
  if (!isLegacy) return raw;
  const old = obj as Record<string, string>;
  const derived = deriveTokens(quickFromTokens(old as ThemeTokens), scheme, {}, { selected: old.selected, onPrimary: old["primary-foreground"] });
  return { ...obj, "selected-foreground": derived["selected-foreground"], "primary-hover": derived["primary-hover"] };
}

/** The eight colours back out of a saved theme, for editing it again. */
export function quickFromTokens(t: ThemeTokens): QuickColors {
  return {
    page: t["ds-background-200"],
    card: t["ds-background-100"],
    border: t["ds-gray-alpha-400"],
    text: t.foreground,
    muted: t["muted-foreground"],
    primary: t.primary,
    link: t.link,
    danger: t.destructive,
  };
}

// ------------------------------------------------------------ contrast guard

export type PairLevel = "block" | "warn";

export type ContrastPair = {
  id: string;
  /** Plain words: "Text on the page". */
  label: string;
  fg: ThemeTokenName;
  /** The backgrounds the colour sits on (more than one for "danger on a card and a muted surface"). */
  bg: readonly ThemeTokenName[];
  min: number;
  /** The lowest ratio across the backgrounds. */
  ratio: number;
  pass: boolean;
  /** `block`: a failure stops the save. `warn`: it is shown, and the save goes ahead. */
  level: PairLevel;
  /** The nearest passing colour for `fg` (same hue; only the lightness moves). Only on a failure. */
  suggestion: string | null;
};

type PairSpec = { id: string; label: string; fg: ThemeTokenName; bg: readonly ThemeTokenName[]; min: number; level: PairLevel };

const PAIRS: readonly PairSpec[] = [
  { id: "text-page", label: "Text on the page", fg: "foreground", bg: ["ds-background-200"], min: 4.5, level: "block" },
  { id: "text-card", label: "Text on a card", fg: "foreground", bg: ["ds-background-100"], min: 4.5, level: "block" },
  { id: "primary", label: "Button text on the primary colour", fg: "primary-foreground", bg: ["primary"], min: 4.5, level: "warn" },
  { id: "danger", label: "Danger text on a card and on a muted surface", fg: "destructive", bg: ["ds-background-100", "ds-gray-100"], min: 4.5, level: "warn" },
  { id: "ring", label: "Focus ring on the page", fg: "ds-focus-color", bg: ["ds-background-200"], min: 3, level: "warn" },
  { id: "muted", label: "Muted text on the page and on a card", fg: "muted-foreground", bg: ["ds-background-200", "ds-background-100"], min: 4.5, level: "warn" },
  { id: "link", label: "Link on the page and on a card", fg: "link", bg: ["ds-background-200", "ds-background-100"], min: 4.5, level: "warn" },
  { id: "text-muted", label: "Text on a muted surface", fg: "foreground", bg: ["ds-gray-100"], min: 4.5, level: "warn" },
];

export type ContrastReport = {
  pairs: ContrastPair[];
  /** Failing pairs that stop the save: body text on the page or on a card. */
  blocking: ContrastPair[];
  /** Failing pairs that only warn. */
  warnings: ContrastPair[];
};

/**
 * The contrast guard. Body text on the page and on a card must reach 4.5:1 or
 * the theme cannot be saved; the other pairs (button text, danger text, the
 * focus ring at 3:1, muted text, links) are reported and allowed. Every
 * failing pair carries the nearest colour that passes.
 */
export function checkContrast(tokens: ThemeTokens, scheme: ThemeScheme): ContrastReport {
  const pairs = PAIRS.map((spec): ContrastPair => {
    const bgs = spec.bg.map((n) => tokens[n]);
    const ratio = Math.min(...bgs.map((bg) => contrastHex(tokens[spec.fg], bg, scheme)));
    const pass = ratio >= spec.min;
    return {
      ...spec,
      ratio,
      pass,
      suggestion: pass ? null : suggestFor(spec, tokens, scheme),
    };
  });
  // Text is checked against the page and the card together, so one suggestion fits both.
  const textFix = pairs.find((p) => p.id === "text-page" && !p.pass) ?? pairs.find((p) => p.id === "text-card" && !p.pass);
  if (textFix) {
    const both = ensureContrast(tokens.foreground, [tokens["ds-background-200"], tokens["ds-background-100"]], 4.5, scheme);
    for (const p of pairs) if (p.fg === "foreground" && p.level === "block" && !p.pass) p.suggestion = both;
  }
  return {
    pairs,
    blocking: pairs.filter((p) => !p.pass && p.level === "block"),
    warnings: pairs.filter((p) => !p.pass && p.level === "warn"),
  };
}

function suggestFor(spec: PairSpec, tokens: ThemeTokens, scheme: ThemeScheme): string {
  return ensureContrast(tokens[spec.fg], spec.bg.map((n) => tokens[n]), spec.min, scheme);
}

/** One line for a failing pair: what is wrong, the ratio, and the fix. */
export function describePair(p: ContrastPair): string {
  const fix = p.suggestion ? ` Try ${p.suggestion}.` : "";
  return `${p.label} is ${p.ratio.toFixed(2)}:1; it needs ${p.min}:1.${fix}`;
}

// ---------------------------------------------------------------- validation

// Control characters, and the invisible and direction-changing characters that let a name look like something else.
const HIDDEN = /[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁠-⁤⁦-⁩﻿]/;

/** The name trimmed, or an error: 1 to 40 characters, no control or invisible characters. */
export function checkThemeName(raw: unknown): { ok: true; name: string } | { ok: false; error: string } {
  if (typeof raw !== "string") return { ok: false, error: "Give the theme a name." };
  const name = raw.trim();
  if (name.length === 0) return { ok: false, error: "Give the theme a name." };
  if (name.length > THEME_NAME_MAX) return { ok: false, error: `Use ${THEME_NAME_MAX} characters or fewer.` };
  if (HIDDEN.test(name)) return { ok: false, error: "The name cannot contain control or invisible characters." };
  return { ok: true, name };
}

export const isThemeToken = (name: string): name is ThemeTokenName => TOKEN_SET.has(name);

/** Why a token set is not acceptable, or null when it is: exactly the known tokens, each one a hex colour. */
export function tokenProblem(raw: unknown): string | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return "tokens must be an object of colours.";
  const obj = raw as Record<string, unknown>;
  for (const key of Object.keys(obj)) if (!TOKEN_SET.has(key)) return `Unknown colour "${key.slice(0, 40)}".`;
  for (const name of THEME_TOKENS) {
    if (!(name in obj)) return `Missing colour "${name}".`;
    if (!isHexColor(obj[name])) return `"${name}" must be a hex colour such as #1a2b3c.`;
  }
  return null;
}

export type ThemeInput = { name: string; scheme: ThemeScheme; tokens: ThemeTokens };

/**
 * A theme as the editor or an imported file holds it: `{ name, scheme,
 * tokens }` and nothing else. The server checks the same rules with zod
 * (src/server/custom-themes.ts); a test runs both over the same cases.
 */
export function parseThemeInput(raw: unknown): { ok: true; value: ThemeInput } | { ok: false; error: string } {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return { ok: false, error: "A theme is an object." };
  const obj = raw as Record<string, unknown>;
  for (const key of Object.keys(obj)) {
    if (key !== "name" && key !== "scheme" && key !== "tokens") return { ok: false, error: `Unknown key "${key.slice(0, 40)}".` };
  }
  const name = checkThemeName(obj.name);
  if (!name.ok) return name;
  if (obj.scheme !== "light" && obj.scheme !== "dark") return { ok: false, error: 'scheme must be "light" or "dark".' };
  const problem = tokenProblem(obj.tokens);
  if (problem) return { ok: false, error: problem };
  return { ok: true, value: { name: name.name, scheme: obj.scheme, tokens: { ...(obj.tokens as ThemeTokens) } } };
}

/**
 * Read an exported theme file. Refuses a file over 8 KB before parsing it, and
 * anything with a key it does not know. The same rules as a saved theme.
 */
export function parseThemeFile(text: string, byteLength = text.length): { ok: true; value: ThemeInput } | { ok: false; error: string } {
  if (byteLength > THEME_FILE_MAX_BYTES) return { ok: false, error: "That file is too large for a theme (8 KB at most)." };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: "That file is not valid JSON." };
  }
  return parseThemeInput(raw);
}

/** The file a theme exports to: its name, scheme and colours, and nothing about the person. */
export function themeFileText(t: ThemeInput): string {
  return `${JSON.stringify({ name: t.name, scheme: t.scheme, tokens: t.tokens }, null, 2)}\n`;
}

/** A safe file name for a download, from the theme name. */
export function themeFileName(name: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
  return `${slug || "theme"}.egg-theme.json`;
}

/**
 * `--ct-<n>` for every token, as the pre-paint script and the app set them, or
 * null unless every colour is present and a valid hex. All or nothing: a
 * half-applied theme would be unreadable.
 */
export function customVars(tokens: Partial<Record<string, unknown>> | null | undefined): Record<string, string> | null {
  if (!tokens) return null;
  const out: Record<string, string> = {};
  for (let i = 0; i < THEME_TOKENS.length; i++) {
    const v = tokens[THEME_TOKENS[i]];
    if (!isHexColor(v)) return null;
    out[customVarName(i)] = v;
  }
  return out;
}
