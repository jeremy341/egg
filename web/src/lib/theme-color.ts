/**
 * Colour maths for themes: the one hex rule, contrast ratios and the search
 * for a nearby colour that passes. Pure, so the server, the editor and the
 * script that runs before first paint all agree on what a colour is.
 */

/**
 * The only colour text a custom theme may hold: `#` and then 3, 4, 6 or 8 hex
 * digits. No names, no functions (rgb(), url()), no spaces, no semicolons. The
 * pre-paint script embeds this same pattern (see bootScript in preferences.ts).
 */
export const HEX_COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

export function isHexColor(value: unknown): value is string {
  return typeof value === "string" && value.length <= 9 && HEX_COLOR.test(value);
}

export type Rgb = [number, number, number];
/** Red, green and blue as 0 to 255, then alpha as 0 to 1. */
export type Rgba = [number, number, number, number];

/** Read a hex colour (3, 4, 6 or 8 digits). Null for anything else. */
export function parseHex(hex: string): Rgba | null {
  if (!isHexColor(hex)) return null;
  let d = hex.slice(1);
  if (d.length <= 4) d = [...d].map((c) => c + c).join("");
  const n = (i: number) => parseInt(d.slice(i, i + 2), 16);
  return [n(0), n(2), n(4), d.length === 8 ? n(6) / 255 : 1];
}

const byte = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
const pair = (v: number) => byte(v).toString(16).padStart(2, "0");

/** `#rrggbb` */
export function toHex(rgb: readonly number[]): string {
  return `#${pair(rgb[0])}${pair(rgb[1])}${pair(rgb[2])}`;
}

/** `#rrggbbaa`, or `#rrggbb` when fully opaque. */
export function toHexAlpha(rgb: readonly number[], alpha: number): string {
  return alpha >= 1 ? toHex(rgb) : `${toHex(rgb)}${pair(alpha * 255)}`;
}

/** Any valid hex, as lower-case `#rrggbb` or `#rrggbbaa`. Null when invalid. */
export function normalizeHex(hex: string): string | null {
  const c = parseHex(hex);
  return c ? toHexAlpha(c, c[3]) : null;
}

/** Mix `fg` into `bg`; `amount` is how much of `fg` there is (0 to 1). */
export function mixRgb(fg: readonly number[], bg: readonly number[], amount: number): Rgb {
  return [0, 1, 2].map((i) => fg[i] * amount + bg[i] * (1 - amount)) as Rgb;
}

/** The opaque colour of a hex laid over a backdrop. */
function flatten(hex: string, backdrop: Rgb): Rgb {
  const c = parseHex(hex) ?? [0, 0, 0, 1];
  return mixRgb(c, backdrop, c[3]);
}

/** Relative luminance, WCAG 2. */
export function luminance(rgb: readonly number[]): number {
  const f = (c: number) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(rgb[0]) + 0.7152 * f(rgb[1]) + 0.0722 * f(rgb[2]);
}

export function contrastRgb(a: readonly number[], b: readonly number[]): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * The contrast ratio of text colour `fg` on background `bg`. A see-through
 * background is laid over white (light) or black (dark) first, and a
 * see-through text colour over the background.
 */
export function contrastHex(fg: string, bg: string, scheme: "light" | "dark" = "light"): number {
  const base: Rgb = scheme === "dark" ? [0, 0, 0] : [255, 255, 255];
  const back = flatten(bg, base);
  return contrastRgb(flatten(fg, back), back);
}

export function rgbToHsl([r, g, b]: readonly number[]): [number, number, number] {
  const R = r / 255;
  const G = g / 255;
  const B = b / 255;
  const max = Math.max(R, G, B);
  const min = Math.min(R, G, B);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  let h: number;
  if (max === R) h = ((G - B) / d) % 6;
  else if (max === G) h = (B - R) / d + 2;
  else h = (R - G) / d + 4;
  return [(h * 60 + 360) % 360, s, l];
}

export function hslToRgb(h: number, s: number, l: number): Rgb {
  const a = s * Math.min(l, 1 - l);
  const k = (n: number) => (n + h / 30) % 12;
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0) * 255, f(8) * 255, f(4) * 255];
}

/**
 * The nearest colour to `fg` (same hue and saturation, only the lightness
 * moves) that reaches `min` against every background, or null when no
 * lightness does. Lightness is tried in steps of half a percent in both
 * directions, and the closer passing step wins. Returns `#rrggbb`.
 */
export function nearestPassing(
  fg: string,
  backgrounds: readonly string[],
  min: number,
  scheme: "light" | "dark" = "light"
): string | null {
  const c = parseHex(fg);
  if (!c) return null;
  const [h, s, l] = rgbToHsl(c);
  const passes = (hex: string) => backgrounds.every((bg) => contrastHex(hex, bg, scheme) >= min);
  for (let step = 0; step <= 200; step++) {
    const delta = step * 0.005;
    for (const to of [l - delta, l + delta]) {
      if (to < 0 || to > 1) continue;
      const hex = toHex(hslToRgb(h, s, to));
      if (passes(hex)) return hex;
    }
  }
  return null;
}

/**
 * Like nearestPassing, but never null: when no lightness of the hue works
 * (two backgrounds far apart), black or white, whichever passes better.
 */
export function ensureContrast(
  fg: string,
  backgrounds: readonly string[],
  min: number,
  scheme: "light" | "dark" = "light"
): string {
  const found = nearestPassing(fg, backgrounds, min, scheme);
  if (found) return found;
  const worst = (hex: string) => Math.min(...backgrounds.map((bg) => contrastHex(hex, bg, scheme)));
  return worst("#000000") >= worst("#ffffff") ? "#000000" : "#ffffff";
}
