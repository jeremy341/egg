/**
 * The choices a person can make about how Egg looks and behaves. Pure, so the
 * server, the settings page and the script that runs before first paint all
 * read the same lists.
 */

import type { AnalyticsDefaults } from "@/lib/analytics-defaults";

export const THEMES = ["light", "dark", "system"] as const;
/** `default` first: the boot script treats index 0 as "leave the page alone". */
export const ACCENTS = ["default", "blue", "green", "violet"] as const;
export const DENSITIES = ["comfortable", "compact"] as const;
export const MOTIONS = ["system", "reduce", "no-preference"] as const;

export type Theme = (typeof THEMES)[number];
export type Accent = (typeof ACCENTS)[number];
export type Density = (typeof DENSITIES)[number];
export type Motion = (typeof MOTIONS)[number];

/** What is held in the egg_prefs cookie and applied to <html> before paint. */
export type Appearance = {
  theme: Theme;
  accent: Accent;
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

export const DEFAULT_APPEARANCE: Appearance = {
  theme: "system",
  accent: "default",
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

export const ACCENT_LABELS: Record<Accent, string> = {
  default: "Neutral",
  blue: "Blue",
  green: "Green",
  violet: "Violet",
};

/**
 * One swatch colour per accent for the picker. These match the light-mode
 * `--primary` values in globals.css; the contrast test reads the stylesheet,
 * not this list.
 */
export const ACCENT_SWATCH: Record<Accent, string> = {
  default: "#171717",
  blue: "#0057d2",
  green: "#1b6b3a",
  violet: "#6b3fc4",
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

/** `theme=dark&accent=blue&density=compact&motion=system`. Only these four, never a name or a branch. */
export function serializeAppearance(a: Appearance): string {
  return `theme=${a.theme}&accent=${a.accent}&density=${a.density}&motion=${a.reducedMotion}`;
}

const oneOf = <T extends string>(list: readonly T[], v: unknown): T | undefined =>
  typeof v === "string" && (list as readonly string[]).includes(v) ? (v as T) : undefined;

/** Read the cookie value back. Unknown or missing parts are left out, never guessed. */
export function parseAppearance(raw: string | null | undefined): Partial<Appearance> {
  if (!raw) return {};
  let text: string;
  try {
    text = decodeURIComponent(raw);
  } catch {
    return {};
  }
  const out: Partial<Appearance> = {};
  for (const pair of text.split("&")) {
    const i = pair.indexOf("=");
    if (i < 1) continue;
    const key = pair.slice(0, i);
    const value = pair.slice(i + 1);
    if (key === "theme") {
      const v = oneOf(THEMES, value);
      if (v) out.theme = v;
    } else if (key === "accent") {
      const v = oneOf(ACCENTS, value);
      if (v) out.accent = v;
    } else if (key === "density") {
      const v = oneOf(DENSITIES, value);
      if (v) out.density = v;
    } else if (key === "motion") {
      const v = oneOf(MOTIONS, value);
      if (v) out.reducedMotion = v;
    }
  }
  return out;
}

/** The full `document.cookie` assignment: not httpOnly (the page script reads it), Lax, one year. */
export function appearanceCookie(a: Appearance, secure: boolean): string {
  return `${PREFS_COOKIE}=${encodeURIComponent(serializeAppearance(a))}; Path=/; Max-Age=${ONE_YEAR}; SameSite=Lax${secure ? "; Secure" : ""}`;
}

/** The attributes the preferences set on <html>. A null value means the attribute is removed. */
export function htmlAttributes(a: Partial<Appearance>): Record<string, string | null> {
  return {
    "data-accent": a.accent && a.accent !== "default" ? a.accent : null,
    "data-density": a.density && a.density !== "comfortable" ? a.density : null,
    "data-motion": a.reducedMotion && a.reducedMotion !== "system" ? a.reducedMotion : null,
  };
}

/**
 * A small script, run in <head> before the page paints. It reads egg_prefs,
 * sets the accent, density and motion attributes on <html>, and seeds the
 * theme that next-themes keeps in localStorage so its own script (which runs
 * next) applies the same choice. With no cookie it does nothing.
 */
export function bootScript(): string {
  const lists = JSON.stringify({ t: THEMES, a: ACCENTS, d: DENSITIES, m: MOTIONS });
  return (
    `(function(){try{var L=${lists};` +
    `var m=document.cookie.match(/(?:^|; )${PREFS_COOKIE}=([^;]*)/);if(!m)return;` +
    `var p={};decodeURIComponent(m[1]).split("&").forEach(function(s){var i=s.indexOf("=");if(i>0)p[s.slice(0,i)]=s.slice(i+1)});` +
    `var h=document.documentElement;` +
    `if(L.a.indexOf(p.accent)>0)h.setAttribute("data-accent",p.accent);` +
    `if(L.d.indexOf(p.density)>0)h.setAttribute("data-density",p.density);` +
    `if(L.m.indexOf(p.motion)>0)h.setAttribute("data-motion",p.motion);` +
    `if(L.t.indexOf(p.theme)>=0){try{localStorage.setItem("theme",p.theme)}catch(e){}}` +
    `}catch(e){}})();`
  );
}
