import { api } from "@/components/api";
import { THEME_TOKENS, customVarName, customVars, type ThemeScheme, type ThemeTokens } from "@/lib/custom-theme";
import {
  DEFAULT_APPEARANCE,
  PREFS_COOKIE,
  appearanceCookie,
  effectivePreset,
  htmlAttributes,
  isCustomPreset,
  parseAppearance,
  parseCustomThemes,
  type Appearance,
  type CustomThemes,
  type Preferences,
} from "@/lib/preferences";

/** Browser-side helpers for the appearance preferences. Never call these during server rendering. */

function rawCookie(): string | undefined {
  return document.cookie.match(new RegExp(`(?:^|; )${PREFS_COOKIE}=([^;]*)`))?.[1];
}

export function readAppearanceCookie(): Partial<Appearance> {
  return parseAppearance(rawCookie());
}

/** A custom theme as the page holds it. */
export type KnownTheme = { preset: string; scheme: ThemeScheme; tokens: ThemeTokens };

// The custom themes this page knows from the account (loaded with the page, or just saved in Settings).
// The cookie may carry colours too, but leaves them out when they are too big for it.
const known = new Map<string, KnownTheme>();

export function rememberCustomThemes(list: readonly KnownTheme[]) {
  for (const t of list) known.set(t.preset, t);
}

export function forgetCustomTheme(preset: string) {
  known.delete(preset);
}

/** The custom themes at hand: what the cookie carries, then what the account gave (the account wins). */
export function currentCustomThemes(): CustomThemes {
  const out: Record<string, { scheme: ThemeScheme; tokens: Partial<Record<string, string>> | null }> = {
    ...parseCustomThemes(rawCookie()),
  };
  for (const [id, t] of known) out[id] = { scheme: t.scheme, tokens: t.tokens };
  return out;
}

export function deviceIsDark(): boolean {
  try {
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  } catch {
    return false;
  }
}

/**
 * Put the colour theme, density and motion on <html>. The light or dark class
 * is applied by next-themes, which is told the mode (see themeMode). While
 * Match my device is on, the colour theme shown depends on the device, so this
 * is also called when the device changes (see PreferencesSync).
 */
export function applyAppearance(a: Partial<Appearance>) {
  const root = document.documentElement;
  const full = { ...DEFAULT_APPEARANCE, ...a };
  const dark = deviceIsDark();
  const customs = currentCustomThemes();
  const attrs = htmlAttributes(full, dark, customs);
  for (const [name, value] of Object.entries(attrs)) {
    if (value === null) root.removeAttribute(name);
    else root.setAttribute(name, value);
  }
  // A custom theme's colours go in as --ct-<n> variables, only if every one is a valid hex (customVars).
  const shown = effectivePreset(full, dark);
  const vars = attrs["data-theme-preset"] === "custom" && isCustomPreset(shown) ? customVars(customs[shown]?.tokens) : null;
  for (let i = 0; i < THEME_TOKENS.length; i++) {
    const name = customVarName(i);
    if (vars) root.style.setProperty(name, vars[name]);
    else root.style.removeProperty(name);
  }
}

/** What this device shows now: the cookie, then the defaults. */
export function readAppearance(): Appearance {
  return { ...DEFAULT_APPEARANCE, ...readAppearanceCookie() };
}

/** Merge a change into the egg_prefs cookie and return the whole appearance. */
export function storeAppearance(change: Partial<Appearance>): Appearance {
  const next: Appearance = { ...readAppearance(), ...change };
  document.cookie = appearanceCookie(next, location.protocol === "https:", currentCustomThemes());
  return next;
}

/** Save to the account. The server answers with the whole row. */
export async function savePreferences(patch: Partial<Preferences>): Promise<Preferences> {
  const res = await api<{ preferences: Preferences }>("/api/preferences", { method: "PATCH", body: patch });
  return res.preferences;
}
