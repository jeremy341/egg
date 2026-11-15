/**
 * The choices a person can make about how Egg looks and behaves. Pure, so the
 * server, the settings page and the script that runs before first paint all
 * read the same lists.
 */

import type { AnalyticsDefaults } from "@/lib/analytics-defaults";
import { THEME_TOKENS, customVars, type ThemeTokens } from "@/lib/custom-theme";
import { HEX_COLOR } from "@/lib/theme-color";

/**
 * The mode next-themes keeps: "light" or "dark" for a fixed theme, "system"
 * while Match my device is on. It is worked out from the theme choice
 * (themeMode), never picked on its own.
 */
export const THEMES = ["light", "dark", "system"] as const;
/**
 * The accent names from before colour themes. Still read from old cookies and
 * old account rows, and mapped to a colour theme (LEGACY_ACCENT_PRESET). Never
 * written any more.
 */
export const LEGACY_ACCENTS = ["default", "blue", "green", "violet", "amber", "rose", "teal", "sand", "nord", "gruvbox"] as const;
export const DENSITIES = ["comfortable", "compact"] as const;
export const MOTIONS = ["system", "reduce", "no-preference"] as const;

export type Theme = (typeof THEMES)[number];
export type LegacyAccent = (typeof LEGACY_ACCENTS)[number];
export type Density = (typeof DENSITIES)[number];
export type Motion = (typeof MOTIONS)[number];

// ------------------------------------------------------------ colour themes

export type Scheme = "light" | "dark";

export type PresetDef = {
  id: string;
  label: string;
  /** A theme is one fixed scheme. It has no other version. Dark themes carry the `dark` class. */
  scheme: Scheme;
  /**
   * Four colours for the picker tile: the page, a card, the text and the
   * primary button. They match the blocks in globals.css; the test checks it.
   */
  swatch: { page: string; surface: string; text: string; primary: string };
};

/**
 * Every colour theme. `egg-light` and `egg-dark` are the two defaults and are
 * the :root and .dark blocks in globals.css, so the boot script sets no
 * attribute for them.
 */
export const PRESETS = [
  { id: "egg-light", label: "Egg Light", scheme: "light", swatch: { page: "#fafafa", surface: "#ffffff", text: "#171717", primary: "#171717" } },
  { id: "egg-dark", label: "Egg Dark", scheme: "dark", swatch: { page: "#000000", surface: "#0a0a0a", text: "#ededed", primary: "#ededed" } },
  { id: "github-light", label: "GitHub Light", scheme: "light", swatch: { page: "#f6f8fa", surface: "#ffffff", text: "#1f2328", primary: "#0860ca" } },
  { id: "github-dark", label: "GitHub Dark", scheme: "dark", swatch: { page: "#0d1117", surface: "#161b22", text: "#e6edf3", primary: "#1f6feb" } },
  { id: "vscode-light", label: "VS Code Light+", scheme: "light", swatch: { page: "#ffffff", surface: "#f3f3f3", text: "#616161", primary: "#007acc" } },
  { id: "vscode-dark", label: "VS Code Dark+", scheme: "dark", swatch: { page: "#1e1e1e", surface: "#252526", text: "#cccccc", primary: "#0e639c" } },
  { id: "nord", label: "Nord", scheme: "dark", swatch: { page: "#2e3440", surface: "#3b4252", text: "#eceff4", primary: "#88c0d0" } },
  { id: "gruvbox-dark", label: "Gruvbox Dark", scheme: "dark", swatch: { page: "#1d2021", surface: "#282828", text: "#ebdbb2", primary: "#fabd2f" } },
  { id: "dracula", label: "Inspired by Dracula", scheme: "dark", swatch: { page: "#21222c", surface: "#282a36", text: "#f8f8f2", primary: "#bd93f9" } },
  { id: "one-dark", label: "Inspired by One Dark", scheme: "dark", swatch: { page: "#21252b", surface: "#282c34", text: "#abb2bf", primary: "#61afef" } },
  { id: "tokyo-night", label: "Inspired by Tokyo Night", scheme: "dark", swatch: { page: "#16161e", surface: "#1a1b26", text: "#c0caf5", primary: "#7aa2f7" } },
  { id: "catppuccin-mocha", label: "Inspired by Catppuccin Mocha", scheme: "dark", swatch: { page: "#181825", surface: "#1e1e2e", text: "#cdd6f4", primary: "#cba6f7" } },
  { id: "rose-pine", label: "Inspired by Rosé Pine", scheme: "dark", swatch: { page: "#191724", surface: "#1f1d2e", text: "#e0def4", primary: "#c4a7e7" } },
  { id: "monokai", label: "Inspired by Monokai", scheme: "dark", swatch: { page: "#1e1f1c", surface: "#272822", text: "#f8f8f2", primary: "#a6e22e" } },
  { id: "ayu-dark", label: "Inspired by Ayu Dark", scheme: "dark", swatch: { page: "#0b0e14", surface: "#10141c", text: "#bfbdb6", primary: "#e6b450" } },
  { id: "solarized-dark", label: "Inspired by Solarized Dark", scheme: "dark", swatch: { page: "#002b36", surface: "#073642", text: "#eee8d5", primary: "#268bd2" } },
  { id: "catppuccin-latte", label: "Inspired by Catppuccin Latte", scheme: "light", swatch: { page: "#e6e9ef", surface: "#eff1f5", text: "#4c4f69", primary: "#1850d0" } },
  { id: "rose-pine-dawn", label: "Inspired by Rosé Pine Dawn", scheme: "light", swatch: { page: "#faf4ed", surface: "#fffaf3", text: "#575279", primary: "#23586f" } },
  { id: "solarized-light", label: "Inspired by Solarized Light", scheme: "light", swatch: { page: "#eee8d5", surface: "#fdf6e3", text: "#073642", primary: "#268bd2" } },
  { id: "ayu-light", label: "Inspired by Ayu Light", scheme: "light", swatch: { page: "#f3f4f5", surface: "#fcfcfc", text: "#5c6166", primary: "#fa8d3e" } },
  { id: "one-light", label: "Inspired by One Light", scheme: "light", swatch: { page: "#eaeaeb", surface: "#fafafa", text: "#383a42", primary: "#4078f2" } },
] as const satisfies readonly PresetDef[];

export type BuiltinPreset = (typeof PRESETS)[number]["id"];
type BuiltinLight = Extract<(typeof PRESETS)[number], { scheme: "light" }>["id"];
type BuiltinDark = Extract<(typeof PRESETS)[number], { scheme: "dark" }>["id"];

/**
 * A custom theme is chosen as `custom:<its id>`. Which slot it fits (light or
 * dark) is its own scheme, which only the account (or the cookie) knows, so
 * the types allow it in both and the server and the cookie reader check it.
 */
export type CustomPresetId = `custom:${string}`;
export type Preset = BuiltinPreset | CustomPresetId;
export type LightPreset = BuiltinLight | CustomPresetId;
export type DarkPreset = BuiltinDark | CustomPresetId;

/** The built-in themes only. Custom themes are not in these lists. */
export const PRESET_IDS = PRESETS.map((p) => p.id) as [BuiltinPreset, ...BuiltinPreset[]];
/** The light built-in themes, for the "Light theme" slot. */
export const LIGHT_PRESET_IDS = PRESETS.filter((p) => p.scheme === "light").map((p) => p.id) as [BuiltinLight, ...BuiltinLight[]];
/** The dark built-in themes, for the "Dark theme" slot. */
export const DARK_PRESET_IDS = PRESETS.filter((p) => p.scheme === "dark").map((p) => p.id) as [BuiltinDark, ...BuiltinDark[]];

/** `custom:` and then an id of lower-case letters, digits and dashes. Nothing else can be a custom theme id. */
export const CUSTOM_PRESET = /^custom:[a-z0-9-]{8,40}$/;
export function isCustomPreset(value: unknown): value is CustomPresetId {
  return typeof value === "string" && CUSTOM_PRESET.test(value);
}

/**
 * What the page knows about custom themes, by `custom:<id>`: the scheme, and
 * the colours when they are at hand (the cookie leaves them out when they are
 * too big; see COOKIE_VALUE_LIMIT).
 */
export type CustomThemes = Readonly<Record<string, { scheme: Scheme; tokens?: Partial<Record<string, string>> | null }>>;

export function presetFor(id: string | null | undefined): (typeof PRESETS)[number] {
  return PRESETS.find((p) => p.id === id) ?? PRESETS[0];
}

/** The scheme of any theme, built-in or custom. A custom theme nobody knows is dark, the fallback the script uses. */
export function schemeOfPreset(id: string, customs?: CustomThemes): Scheme {
  if (isCustomPreset(id)) return customs?.[id]?.scheme ?? "dark";
  return presetFor(id).scheme;
}

/** Where each old accent lands: the nearest look in the new list. The person can pick another. */
export const LEGACY_ACCENT_PRESET: Record<LegacyAccent, Preset> = {
  default: "egg-light",
  blue: "github-light",
  green: "egg-light",
  violet: "egg-light",
  amber: "gruvbox-dark",
  rose: "egg-light",
  teal: "egg-light",
  sand: "egg-light",
  nord: "nord",
  gruvbox: "gruvbox-dark",
};

/** A stored value that is either a colour theme or an old accent name, as a colour theme. */
export function presetFromStored(value: string | null | undefined): Preset {
  if (value && (PRESET_IDS as readonly string[]).includes(value)) return value as Preset;
  if (value && Object.prototype.hasOwnProperty.call(LEGACY_ACCENT_PRESET, value)) return LEGACY_ACCENT_PRESET[value as LegacyAccent];
  return "egg-light";
}

/**
 * The theme choice: either one theme that stays whatever the device does, or
 * (Match my device) one light theme and one dark theme, picked by the device.
 */
export type ThemeChoice = {
  /** On: `lightPreset` when the device is light, `darkPreset` when it is dark. Off: `preset`, always. */
  matchDevice: boolean;
  lightPreset: LightPreset;
  darkPreset: DarkPreset;
  /** The fixed theme used while matching is off. Any theme, light or dark. */
  preset: Preset;
};

/** The colour theme that is shown. Pure; the boot script does the same thing and the test compares them. */
export function effectivePreset(choice: ThemeChoice, deviceDark: boolean): Preset {
  if (!choice.matchDevice) return choice.preset;
  return deviceDark ? choice.darkPreset : choice.lightPreset;
}

/** What next-themes is told: "system" while matching, else the scheme of the fixed theme. */
export function themeMode(choice: Pick<ThemeChoice, "matchDevice" | "preset">, customs?: CustomThemes): Theme {
  return choice.matchDevice ? "system" : schemeOfPreset(choice.preset, customs);
}

const LEGACY_PARTNER: Partial<Record<Preset, Preset>> = {
  "egg-light": "egg-dark",
  "egg-dark": "egg-light",
  "github-light": "github-dark",
  "github-dark": "github-light",
  "vscode-light": "vscode-dark",
  "vscode-dark": "vscode-light",
};

/**
 * Old Mode (light, dark or system) and old accent or colour theme, as the new
 * choice, once. The old theme is kept in the slot of its own scheme; a theme of
 * the other scheme gives way to its old partner, or to Egg. light and dark
 * become a fixed theme; system becomes Match my device.
 */
export function themeChoiceFromLegacy(mode: string | null | undefined, accent: string | null | undefined): ThemeChoice {
  const from = presetFromStored(accent);
  const side = (scheme: Scheme): Preset => {
    if (presetFor(from).scheme === scheme) return from;
    const partner = LEGACY_PARTNER[from];
    return partner && presetFor(partner).scheme === scheme ? partner : scheme === "dark" ? "egg-dark" : "egg-light";
  };
  const lightPreset = side("light") as LightPreset;
  const darkPreset = side("dark") as DarkPreset;
  return {
    matchDevice: mode !== "light" && mode !== "dark",
    lightPreset,
    darkPreset,
    preset: mode === "light" ? lightPreset : darkPreset,
  };
}

/** What is held in the egg_prefs cookie and applied to <html> before paint. */
export type Appearance = ThemeChoice & {
  density: Density;
  reducedMotion: Motion;
};

export type Preferences = Appearance & {
  defaultBranch: string | null;
  displayName: string | null;
  avatar: string;
  /** The analytics features a project starts with when analytics is first turned on. `{}` is all off. */
  analyticsDefaults: AnalyticsDefaults;
};

/** A new account matches the device, with Egg Light by day and Egg Dark by night. */
export const DEFAULT_APPEARANCE: Appearance = {
  matchDevice: true,
  lightPreset: "egg-light",
  darkPreset: "egg-dark",
  preset: "egg-dark",
  density: "comfortable",
  reducedMotion: "system",
};

export const DEFAULT_PREFERENCES: Preferences = {
  ...DEFAULT_APPEARANCE,
  defaultBranch: null,
  displayName: null,
  avatar: "pixel-01",
  analyticsDefaults: {},
};

// ---------------------------------------------------------------- characters

export type Character = {
  id: string;
  label: string;
  /** 8 rows of 8 characters. `#` is a filled pixel, `.` is empty. */
  rows: readonly string[];
};

/** Eight small pixel characters. No uploads: a fixed set needs no moderation or storage. */
export const AVATARS: readonly Character[] = [
  {
    id: "pixel-01",
    label: "Egg",
    rows: ["..####..", ".######.", ".######.", ".#.##.#.", "########", "########", ".######.", "..####.."],
  },
  {
    id: "pixel-02",
    label: "Cat",
    rows: ["#......#", "##....##", "########", "#.####.#", "########", "########", ".######.", "..####.."],
  },
  {
    id: "pixel-03",
    label: "Ghost",
    rows: ["..####..", ".######.", "########", "##.##.##", "##.##.##", "########", "########", "##.##.##"],
  },
  {
    id: "pixel-04",
    label: "Robot",
    rows: ["...##...", "...##...", "########", "#.####.#", "########", "#......#", "########", ".##..##."],
  },
  {
    id: "pixel-05",
    label: "Frog",
    rows: [".##..##.", "##.##.##", "########", "########", "########", "##....##", "########", ".##..##."],
  },
  {
    id: "pixel-06",
    label: "Alien",
    rows: [".######.", "########", "#..##..#", "#..##..#", "########", ".######.", "..####..", "...##..."],
  },
  {
    id: "pixel-07",
    label: "Owl",
    rows: ["##....##", "########", "#.####.#", "#.####.#", "########", "##.##.##", "########", ".##..##."],
  },
  {
    id: "pixel-08",
    label: "Mushroom",
    rows: ["..####..", ".######.", "##.##.##", "########", "..####..", "..####..", "..####..", ".######."],
  },
];

export const AVATAR_IDS = AVATARS.map((a) => a.id) as [string, ...string[]];

export function characterFor(id: string | null | undefined): Character {
  return AVATARS.find((a) => a.id === id) ?? AVATARS[0];
}

/** SVG path data for a character: one unit square per lit pixel. */
export function characterPath(rows: readonly string[]): string {
  let d = "";
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) if (row[x] === "#") d += `M${x} ${y}h1v1h-1z`;
  });
  return d;
}

// ------------------------------------------------------------------- names

/** The name shown for a person: their chosen display name, else the Hack Club one. */
export function shownName(prefs: { displayName: string | null }, hackClubName: string): string {
  return prefs.displayName?.trim() || hackClubName;
}

/**
 * Whether a string is a valid git branch name (the rules of
 * `git check-ref-format --branch`, without the shorthand forms).
 */
export function isValidBranchName(name: string): boolean {
  if (name.length === 0 || name.length > 100) return false;
  if (/[\x00-\x20\x7f~^:?*[\\]/.test(name)) return false;
  if (name === "@" || name.includes("@{") || name.includes("..") || name.includes("//")) return false;
  if (name.startsWith("-") || name.startsWith("/") || name.endsWith("/") || name.endsWith(".")) return false;
  return name.split("/").every((part) => part.length > 0 && !part.startsWith(".") && !part.endsWith(".lock"));
}

// ------------------------------------------------------------------ cookie

export const PREFS_COOKIE = "egg_prefs";
const ONE_YEAR = 60 * 60 * 24 * 365;

/**
 * How long the encoded cookie value may be, in characters. Browsers keep about
 * 4 KB per cookie (name, value and attributes together), and the cookie is sent
 * with every request, so the colours of a custom theme travel in it only while
 * the whole value stays under this. A bigger set is left out: the cookie then
 * names the theme and its scheme only, the page first shows the default theme
 * for that scheme, and the app loads the colours from the account after first
 * paint (PreferencesSync). A theme from the editor is about 1 KB, so two fit.
 */
export const COOKIE_VALUE_LIMIT = 3500;

/** The cookie parameter for a custom theme: `t_<id>=d,0:#161b22,1:#0d1117,...` (l or d, then position:colour pairs). */
const themeParam = (id: string) => `t_${id.slice("custom:".length)}`;

/** `0:#161b22,1:#0d1117,...` for a complete set of valid colours, else null. */
function tokenPairs(tokens: Partial<Record<string, unknown>> | null | undefined): string | null {
  if (!customVars(tokens)) return null;
  return THEME_TOKENS.map((name, i) => `${i}:${tokens![name]}`).join(",");
}

/**
 * `match=1&light=egg-light&dark=egg-dark&preset=egg-dark&density=compact&motion=system`.
 * Only these, never a name or a branch. When a custom theme is shown, its scheme
 * and (if the cookie stays under COOKIE_VALUE_LIMIT) its colours follow, for the
 * script that runs before paint. `limit` is only for tests.
 */
export function serializeAppearance(a: Appearance, customs?: CustomThemes, limit = COOKIE_VALUE_LIMIT): string {
  let out = `match=${a.matchDevice ? 1 : 0}&light=${a.lightPreset}&dark=${a.darkPreset}&preset=${a.preset}&density=${a.density}&motion=${a.reducedMotion}`;
  if (!customs) return out;
  const shown = [...new Set((a.matchDevice ? [a.lightPreset, a.darkPreset] : [a.preset]).filter(isCustomPreset))];
  for (const id of shown) {
    const theme = customs[id];
    if (!theme) continue;
    const head = `&${themeParam(id)}=${theme.scheme === "dark" ? "d" : "l"}`;
    const pairs = tokenPairs(theme.tokens);
    const full = pairs ? `${out}${head},${pairs}` : null;
    out = full && encodeURIComponent(full).length <= limit ? full : `${out}${head}`;
  }
  return out;
}

const oneOf = <T extends string>(list: readonly T[], v: unknown): T | undefined =>
  typeof v === "string" && (list as readonly string[]).includes(v) ? (v as T) : undefined;

function cookiePairs(raw: string | null | undefined): Map<string, string> | null {
  if (!raw) return null;
  let text: string;
  try {
    text = decodeURIComponent(raw);
  } catch {
    return null;
  }
  const pairs = new Map<string, string>();
  for (const pair of text.split("&")) {
    const i = pair.indexOf("=");
    if (i >= 1) pairs.set(pair.slice(0, i), pair.slice(i + 1));
  }
  return pairs;
}

/** The colours of a cookie parameter's `position:colour` list: all of them valid, or null. */
function tokensFromPairs(list: string): ThemeTokens | null {
  const parts = list.split(",");
  if (parts.length !== THEME_TOKENS.length) return null;
  const out: Record<string, string> = {};
  for (const part of parts) {
    const i = part.indexOf(":");
    const index = /^\d{1,3}$/.test(part.slice(0, i)) ? Number(part.slice(0, i)) : -1;
    const value = part.slice(i + 1);
    if (i < 1 || index < 0 || index >= THEME_TOKENS.length || !HEX_COLOR.test(value) || THEME_TOKENS[index] in out) return null;
    out[THEME_TOKENS[index]] = value;
  }
  return out as ThemeTokens;
}

/**
 * The custom themes the cookie carries, by `custom:<id>`: the scheme, and the
 * colours when all of them are there and every one is a valid hex (else null).
 */
export function parseCustomThemes(raw: string | null | undefined): Record<string, { scheme: Scheme; tokens: ThemeTokens | null }> {
  const out: Record<string, { scheme: Scheme; tokens: ThemeTokens | null }> = {};
  for (const [name, value] of cookiePairs(raw) ?? []) {
    if (!name.startsWith("t_")) continue;
    const id = `custom:${name.slice(2)}`;
    if (!isCustomPreset(id) || (value[0] !== "l" && value[0] !== "d")) continue;
    const rest = value.slice(1);
    out[id] = { scheme: value[0] === "d" ? "dark" : "light", tokens: rest.startsWith(",") ? tokensFromPairs(rest.slice(1)) : null };
  }
  return out;
}

/**
 * Read the cookie value back. Unknown or missing parts are left out, never
 * guessed; a theme in the wrong slot (a dark theme as the light one) is left
 * out too. A custom theme is accepted only when the cookie also says its
 * scheme, and it must be the slot's scheme. A cookie from before light and
 * dark themes has `theme=` and `preset=` or `accent=` and no `match=`; it is
 * read as the choice it meant (themeChoiceFromLegacy).
 */
export function parseAppearance(raw: string | null | undefined): Partial<Appearance> {
  const pairs = cookiePairs(raw);
  if (!pairs) return {};
  const customs = parseCustomThemes(raw);
  const custom = (v: string | undefined, scheme?: Scheme): CustomPresetId | undefined =>
    isCustomPreset(v) && customs[v] && (!scheme || customs[v].scheme === scheme) ? v : undefined;
  const out: Partial<Appearance> = {};
  const match = pairs.get("match");
  if (match === "1" || match === "0") {
    out.matchDevice = match === "1";
    const light = oneOf(LIGHT_PRESET_IDS, pairs.get("light")) ?? custom(pairs.get("light"), "light");
    const dark = oneOf(DARK_PRESET_IDS, pairs.get("dark")) ?? custom(pairs.get("dark"), "dark");
    const preset = oneOf(PRESET_IDS, pairs.get("preset")) ?? custom(pairs.get("preset"));
    if (light) out.lightPreset = light;
    if (dark) out.darkPreset = dark;
    if (preset) out.preset = preset;
  } else {
    const mode = oneOf(THEMES, pairs.get("theme"));
    const preset = oneOf(PRESET_IDS, pairs.get("preset"));
    const accent = oneOf(LEGACY_ACCENTS, pairs.get("accent"));
    if (mode || preset || accent) Object.assign(out, themeChoiceFromLegacy(mode, preset ?? accent));
  }
  const density = oneOf(DENSITIES, pairs.get("density"));
  const motion = oneOf(MOTIONS, pairs.get("motion"));
  if (density) out.density = density;
  if (motion) out.reducedMotion = motion;
  return out;
}

/** The full `document.cookie` assignment: not httpOnly (the page script reads it), Lax, one year. */
export function appearanceCookie(a: Appearance, secure: boolean, customs?: CustomThemes): string {
  return `${PREFS_COOKIE}=${encodeURIComponent(serializeAppearance(a, customs))}; Path=/; Max-Age=${ONE_YEAR}; SameSite=Lax${secure ? "; Secure" : ""}`;
}

/**
 * The attributes the preferences set on <html>. A null value means the attribute
 * is removed. `data-theme-preset` is the colour theme that is shown (see
 * effectivePreset); it is left off for the two Egg themes, which are the base
 * styles. A custom theme is "custom" when its colours are at hand (the page
 * sets them as --ct-<n> variables, see customVars) and left off otherwise, so
 * a missing or deleted theme shows the Egg default. `data-accent` is the
 * attribute from before colour themes and is always cleared.
 */
export function htmlAttributes(a: Partial<Appearance>, deviceDark = false, customs?: CustomThemes): Record<string, string | null> {
  const full = { ...DEFAULT_APPEARANCE, ...a };
  const shown = effectivePreset(full, deviceDark);
  const theme = isCustomPreset(shown) ? (customVars(customs?.[shown]?.tokens) ? "custom" : null) : shown;
  return {
    "data-theme-preset": theme === "egg-light" || theme === "egg-dark" ? null : theme,
    "data-accent": null,
    "data-density": full.density !== "comfortable" ? full.density : null,
    "data-motion": full.reducedMotion !== "system" ? full.reducedMotion : null,
  };
}

/**
 * A small script, run in <head> before the page paints. It reads egg_prefs and
 * sets density and motion on <html>. For the theme it picks the light or dark
 * theme by the device (Match my device on) or uses the fixed one (off), sets
 * `data-theme-preset` and the light or dark class, and seeds the mode that
 * next-themes keeps in localStorage ("system" while matching), so its own
 * script, which runs next, agrees and nothing flashes. A cookie with no
 * `match=` (from before light and dark themes) is left to the app, which
 * rewrites it. The test runs this and effectivePreset over every combination.
 *
 * Custom themes: the colours are in the cookie as `t_<id>=d,0:#...,1:#...`.
 * Nothing is applied unless the theme id fits the id pattern, the scheme
 * matches the slot, there are exactly as many colours as tokens, each position
 * is used once, and EVERY value passes the hex rule (HEX_COLOR, embedded here).
 * Then, and only then, each colour is set as the variable `--ct-<position>`,
 * which globals.css maps onto the real tokens. Raw text from the cookie is
 * never set as CSS, only values that matched `#` plus 3, 4, 6 or 8 hex digits.
 * Anything else (a bad value, a missing set, a set left out for size) shows the
 * default theme of the scheme, and the app loads the theme afterwards.
 */
export function bootScript(): string {
  const lists = JSON.stringify({
    d: DENSITIES,
    m: MOTIONS,
    // id -> 1 if dark, 0 if light
    p: Object.fromEntries(PRESETS.map((x) => [x.id, x.scheme === "dark" ? 1 : 0])),
  });
  return (
    `(function(){try{var L=${lists},N=${THEME_TOKENS.length},X=${HEX_COLOR};` +
    `var m=document.cookie.match(/(?:^|; )${PREFS_COOKIE}=([^;]*)/);if(!m)return;` +
    `var p={};decodeURIComponent(m[1]).split("&").forEach(function(s){var i=s.indexOf("=");if(i>0)p[s.slice(0,i)]=s.slice(i+1)});` +
    `var h=document.documentElement;` +
    `if(L.d.indexOf(p.density)>0)h.setAttribute("data-density",p.density);` +
    `if(L.m.indexOf(p.motion)>0)h.setAttribute("data-motion",p.motion);` +
    `if(p.match!=="0"&&p.match!=="1")return;` +
    `var on=p.match==="1",d=matchMedia("(prefers-color-scheme: dark)").matches,k=on?p[d?"dark":"light"]:p.preset,s=-1,V=null;` +
    `if(/^custom:[a-z0-9-]{8,40}$/.test(k)){var e=p["t_"+k.slice(7)];` +
    `if(e&&(e[0]==="l"||e[0]==="d")&&(!on||(e[0]==="d")===d)){s=e[0]==="d"?1:0;` +
    `var v=e.split(",").slice(1),A=[],ok=v.length===N;` +
    `v.forEach(function(q){var j=q.indexOf(":"),i=q.slice(0,j);if(j>0&&/^\\d{1,3}$/.test(i)&&+i<N&&A[+i]===undefined&&X.test(q.slice(j+1)))A[+i]=q.slice(j+1);else ok=false});` +
    `if(ok&&A.length===N)V=A}}` +
    `if(s<0){if(!Object.prototype.hasOwnProperty.call(L.p,k)||(on&&L.p[k]!==+d))k=on?d?"egg-dark":"egg-light":"egg-dark";` +
    `d=L.p[k]===1;if(k!=="egg-light"&&k!=="egg-dark")h.setAttribute("data-theme-preset",k)}` +
    `else{d=s===1;if(V){for(var i=0;i<N;i++)h.style.setProperty("--ct-"+i,V[i]);h.setAttribute("data-theme-preset","custom")}}` +
    `h.classList.remove("light","dark");h.classList.add(d?"dark":"light");` +
    `try{localStorage.setItem("theme",on?"system":d?"dark":"light")}catch(e){}` +
    `}catch(e){}})();`
  );
}
