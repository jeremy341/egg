import { api } from "@/components/api";
import {
  DEFAULT_APPEARANCE,
  PREFS_COOKIE,
  appearanceCookie,
  htmlAttributes,
  parseAppearance,
  type Appearance,
  type Preferences,
  type Theme,
  THEMES,
} from "@/lib/preferences";

/** Browser-side helpers for the appearance preferences. Never call these during server rendering. */

export function readAppearanceCookie(): Partial<Appearance> {
  const m = document.cookie.match(new RegExp(`(?:^|; )${PREFS_COOKIE}=([^;]*)`));
  return parseAppearance(m?.[1]);
}

/** Put accent, density and motion on <html>. The theme is applied by next-themes. */
export function applyAppearance(a: Partial<Appearance>) {
  const root = document.documentElement;
  for (const [name, value] of Object.entries(htmlAttributes({ ...DEFAULT_APPEARANCE, ...a }))) {
    if (value === null) root.removeAttribute(name);
    else root.setAttribute(name, value);
  }
}

function storedTheme(): Theme | undefined {
  try {
    const t = localStorage.getItem("theme");
    return THEMES.find((x) => x === t);
  } catch {
    return undefined;
  }
}

/** Merge a change into the egg_prefs cookie and return the whole appearance. */
export function storeAppearance(change: Partial<Appearance>): Appearance {
  const current = readAppearanceCookie();
  const next: Appearance = {
    ...DEFAULT_APPEARANCE,
    theme: storedTheme() ?? DEFAULT_APPEARANCE.theme,
    ...current,
    ...change,
  };
  document.cookie = appearanceCookie(next, location.protocol === "https:");
  return next;
}

/** Save to the account. The server answers with the whole row. */
export async function savePreferences(patch: Partial<Preferences>): Promise<Preferences> {
  const res = await api<{ preferences: Preferences }>("/api/preferences", { method: "PATCH", body: patch });
  return res.preferences;
}
