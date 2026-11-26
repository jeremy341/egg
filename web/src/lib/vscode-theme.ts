/**
 * VS Code colour themes, mapped onto Egg's. ONE source of truth for two jobs:
 *
 *  1. the built-in "VS Code Dark+" and "VS Code Light+" themes (their blocks in
 *     globals.css are VS Code's own colours put through this mapping; a test
 *     reads VS Code's committed theme files and checks every value), and
 *  2. the importer for a theme file a person brings from VS Code.
 *
 * Pure, so the settings page and the tests use the same code. A theme file is
 * untrusted input: it is read as data only (never evaluated), only values that
 * match the hex rule (HEX_COLOR in theme-color.ts) are ever used, and the
 * result is a plain token set that goes through the same save checks as any
 * other custom theme.
 *
 * Egg uses far fewer colours than VS Code, so this reads a few dozen keys at
 * most and ignores everything else (syntax colours, the activity bar, the
 * status bar and so on).
 */

import defaults from "@/lib/vscode-theme/registry-defaults.json";
import {
  THEME_NAME_MAX,
  checkThemeName,
  deriveTokens,
  type QuickColors,
  type ThemeInput,
  type ThemeScheme,
  type ThemeTokens,
} from "@/lib/custom-theme";
import { contrastHex, contrastRgb, hslToRgb, isHexColor, mixRgb, parseHex, rgbToHsl, toHex, type Rgb } from "@/lib/theme-color";

/** A VS Code theme file larger than this is refused before it is read. */
export const VSCODE_FILE_MAX_BYTES = 256 * 1024;

// ------------------------------------------------------------------ mapping

/**
 * Which VS Code colour key sets which part of an Egg theme. A list is in order
 * of preference: the first key the file sets is used, and when it sets none of
 * them the VS Code default of the FIRST key is used (for the scheme of the
 * theme). Keys are exactly the names in VS Code's `colors` section.
 *
 *   page         editor.background
 *   card         sideBar.background, else editorWidget.background
 *   border       panel.border, else editorGroup.border
 *   text         foreground
 *   muted        descriptionForeground
 *   primary      button.background          (buttons)
 *   primaryHover button.hoverBackground     (buttons while hovered)
 *   onPrimary    button.foreground          (text on buttons)
 *   link         textLink.foreground
 *   danger       errorForeground, else editorError.foreground
 *                (errorForeground is VS Code's colour for error TEXT;
 *                editorError.foreground is the editor's squiggle colour and
 *                reads at 3.7:1 to 3.9:1 on Egg's muted surface in both themes)
 *   ring         focusBorder                (focus ring)
 *   selected     list.activeSelectionBackground
 *   selectedForeground
 *                list.activeSelectionForeground (text on a selected row)
 *   success      terminal.ansiGreen, else gitDecoration.addedResourceForeground
 *   warning      editorWarning.foreground
 *
 * page, card, border, text, muted, primary, link and danger are Egg's eight
 * editable colours. The other seven are set on top of them. Every other token
 * (grey steps, tints, the status colours, text on danger buttons) is derived
 * from these by deriveTokens in custom-theme.ts, as for any custom theme.
 */
export const VSCODE_MAP = {
  page: { keys: ["editor.background"], label: "Page background" },
  card: { keys: ["sideBar.background", "editorWidget.background"], label: "Card surface" },
  border: { keys: ["panel.border", "editorGroup.border"], label: "Border" },
  text: { keys: ["foreground"], label: "Text" },
  muted: { keys: ["descriptionForeground"], label: "Muted text" },
  primary: { keys: ["button.background"], label: "Primary" },
  primaryHover: { keys: ["button.hoverBackground"], label: "Button on hover" },
  onPrimary: { keys: ["button.foreground"], label: "Button text" },
  link: { keys: ["textLink.foreground"], label: "Link" },
  danger: { keys: ["errorForeground", "editorError.foreground"], label: "Danger" },
  ring: { keys: ["focusBorder"], label: "Focus ring" },
  selected: { keys: ["list.activeSelectionBackground"], label: "Selected item" },
  selectedForeground: { keys: ["list.activeSelectionForeground"], label: "Text on selected item" },
  success: { keys: ["terminal.ansiGreen", "gitDecoration.addedResourceForeground"], label: "Success" },
  warning: { keys: ["editorWarning.foreground"], label: "Warning" },
} as const satisfies Record<string, { keys: readonly string[]; label: string }>;

export type VsRole = keyof typeof VSCODE_MAP;
/** The order colours are worked out in: the page first (everything else is laid over it), the text before the muted text. */
export const VS_ROLES = [
  "page", "card", "border", "text", "muted", "primary", "primaryHover", "onPrimary", "link", "danger", "ring",
  "selected", "selectedForeground", "success", "warning",
] as const satisfies readonly VsRole[];

/** Every VS Code key the mapping reads. */
export const VSCODE_KEYS: readonly string[] = [...new Set(VS_ROLES.flatMap((r) => VSCODE_MAP[r].keys as readonly string[]))];

// ----------------------------------------------------------------- defaults

/**
 * A plain colour, or one VS Code works out from another key: `alpha` is that
 * key at an opacity (over the page), `lighten` and `darken` move its HSL
 * lightness by that fraction of itself (VS Code's Color.lighten and darken).
 */
type DefaultValue = string | { of: string; alpha: number } | { of: string; lighten: number } | { of: string; darken: number };
const DEFAULTS = defaults as unknown as Record<ThemeScheme, Record<string, DefaultValue>>;

const vscodeDefaultHex = (key: string, scheme: ThemeScheme): string => {
  const d = DEFAULTS[scheme][key];
  return typeof d === "string" ? d : "#cccccc";
};

/** The VS Code default of a key for a light or dark theme (high contrast themes use these two as well). */
export function vscodeDefault(key: string, scheme: ThemeScheme): DefaultValue | undefined {
  return DEFAULTS[scheme][key];
}

// ------------------------------------------------------------------ colours

const baseOf = (scheme: ThemeScheme): Rgb => (scheme === "dark" ? [0, 0, 0] : [255, 255, 255]);

/**
 * A VS Code colour value as an opaque `#rrggbb`, or null when it is not a hex
 * colour. VS Code writes `#rgb`, `#rgba`, `#rrggbb` and `#rrggbbaa`. Egg's
 * hex rule would allow the alpha, but a theme is easier to reason about (and
 * to check for contrast) without it, so a see-through colour is blended onto
 * the page colour instead: what the person would see in VS Code, where the
 * page is behind it. `rgba()`, `hsl()`, `var()` and names are not hex and give
 * null; they are never passed on.
 */
export function flattenHex(value: unknown, onto: Rgb): { hex: string; blended: boolean } | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!isHexColor(trimmed)) return null;
  const c = parseHex(trimmed);
  if (!c) return null;
  return { hex: toHex(c[3] < 1 ? mixRgb(c, onto, c[3]) : c), blended: c[3] < 1 };
}

export type VsPick = {
  role: VsRole;
  /** The VS Code key the colour came from. */
  key: string;
  hex: string;
  from: "file" | "default";
  /** For a default: the file had no usable value. */
  why?: "missing" | "unsupported";
  /** The value had an alpha part, which was blended onto the page. */
  blended: boolean;
};

const own = (obj: Readonly<Record<string, unknown>>, key: string): unknown => (Object.prototype.hasOwnProperty.call(obj, key) ? obj[key] : undefined);

/**
 * The 15 colours of the mapping from a `colors` section. A key the file does
 * not set, or sets to something that is not a hex colour (`rgba(...)`,
 * `hsl(...)`, `var(...)`), takes VS Code's own default for it, which is what
 * VS Code itself shows for that key. The caller lists these.
 */
export function pickColors(colors: Readonly<Record<string, unknown>>, scheme: ThemeScheme): Record<VsRole, VsPick> {
  const base = baseOf(scheme);
  const out = {} as Record<VsRole, VsPick>;
  const page = (): Rgb => parseHex(out.page.hex)!.slice(0, 3) as Rgb;

  const fromDefault = (key: string, over: Rgb): { hex: string; blended: boolean } => {
    const d = vscodeDefault(key, scheme);
    if (typeof d === "string") return flattenHex(d, over)!;
    if (d && typeof d === "object") {
      // A colour VS Code works out from another one: the muted text is the text at 70%, the hovered button its colour 20% lighter or darker.
      const sourceRole = VS_ROLES.find((r) => (VSCODE_MAP[r].keys as readonly string[])[0] === d.of);
      const source = sourceRole ? out[sourceRole] : undefined;
      const of = (source ? parseHex(source.hex) : parseHex(vscodeDefaultHex(d.of, scheme)))!.slice(0, 3) as Rgb;
      if ("alpha" in d) return { hex: toHex(mixRgb(of, over, d.alpha)), blended: true };
      const [h, s, l] = rgbToHsl(of);
      const moved = "lighten" in d ? l + l * d.lighten : l - l * d.darken;
      return { hex: toHex(hslToRgb(h, s, Math.min(1, Math.max(0, moved)))), blended: false };
    }
    return { hex: toHex(over), blended: false };
  };

  for (const role of VS_ROLES) {
    const keys: readonly string[] = VSCODE_MAP[role].keys;
    const over = role === "page" ? base : page();
    let found: VsPick | null = null;
    let sawOther = false;
    for (const key of keys) {
      const raw = own(colors, key);
      if (raw === undefined) continue;
      const flat = flattenHex(raw, over);
      if (flat) {
        found = { role, key, hex: flat.hex, from: "file", blended: flat.blended };
        break;
      }
      sawOther = true;
    }
    if (!found) {
      const key = keys[0];
      const d = fromDefault(key, over);
      found = { role, key, hex: d.hex, from: "default", why: sawOther ? "unsupported" : "missing", blended: false };
    }
    out[role] = found;
  }
  return out;
}

/**
 * The Egg token set for a set of VS Code colours. The eight editable colours
 * are used as they are and the seven others are laid on top (see VSCODE_MAP).
 * The text on a selected row is VS Code's, unless it would not reach 4.5:1 on
 * the selected colour (VS Code's default is white, wrong on a pale selection a
 * theme sets without setting the text): then Egg works it out from the text.
 */
export function tokensFromPicks(picks: Record<VsRole, VsPick>, scheme: ThemeScheme): ThemeTokens {
  const c = (role: VsRole) => picks[role].hex;
  const quick: QuickColors = {
    page: c("page"),
    card: c("card"),
    border: c("border"),
    text: c("text"),
    muted: c("muted"),
    primary: c("primary"),
    link: c("link"),
    danger: c("danger"),
  };
  return deriveTokens(quick, scheme, {}, {
    onPrimary: c("onPrimary"),
    primaryHover: c("primaryHover"),
    ring: c("ring"),
    selected: c("selected"),
    selectedForeground: contrastHex(c("selectedForeground"), c("selected"), scheme) >= 4.5 ? c("selectedForeground") : undefined,
    success: c("success"),
    warning: c("warning"),
  });
}

/** Egg tokens from a `colors` section and a scheme: the built-in presets and the importer both go through here. */
export function tokensFromVsCodeColors(colors: Readonly<Record<string, unknown>>, scheme: ThemeScheme): { tokens: ThemeTokens; picks: Record<VsRole, VsPick> } {
  const picks = pickColors(colors, scheme);
  return { tokens: tokensFromPicks(picks, scheme), picks };
}

// -------------------------------------------------------- JSON with comments

/**
 * Read the JSON a VS Code theme file is written in: line and block comments
 * and trailing commas are allowed. The text is first rewritten to plain JSON
 * (comments dropped, trailing commas removed, strings left exactly as they
 * are, so `"http://x"` survives) and then read with JSON.parse. Nothing is
 * ever evaluated. Returns an error, never throws.
 */
export function parseJsonWithComments(text: string): { ok: true; value: unknown } | { ok: false; error: string } {
  const out: string[] = [];
  const n = text.length;
  let i = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  // Where a comma sits in `out` while nothing but space or comments has followed it.
  let comma = -1;
  while (i < n) {
    const c = text[i];
    if (c === '"') {
      let j = i + 1;
      while (j < n && text[j] !== '"') j += text[j] === "\\" ? 2 : 1;
      if (j >= n) return { ok: false, error: "A string is not closed." };
      out.push(text.slice(i, j + 1));
      i = j + 1;
      comma = -1;
    } else if (c === "/" && text[i + 1] === "/") {
      while (i < n && text[i] !== "\n" && text[i] !== "\r") i++;
    } else if (c === "/" && text[i + 1] === "*") {
      const end = text.indexOf("*/", i + 2);
      if (end < 0) return { ok: false, error: "A comment is not closed." };
      out.push(" ");
      i = end + 2;
    } else if (c === ",") {
      comma = out.length;
      out.push(c);
      i++;
    } else if (c === "}" || c === "]") {
      if (comma >= 0) out[comma] = "";
      comma = -1;
      out.push(c);
      i++;
    } else {
      if (c !== " " && c !== "\t" && c !== "\n" && c !== "\r") comma = -1;
      out.push(c);
      i++;
    }
  }
  try {
    return { ok: true, value: JSON.parse(out.join("")) as unknown };
  } catch {
    return { ok: false, error: "That file is not valid JSON, even with comments and trailing commas allowed." };
  }
}

// ----------------------------------------------------------------- importing

export type VsImportReport = {
  /** The theme's name as it will be offered. */
  name: string;
  scheme: ThemeScheme;
  /** The file said light, dark or high contrast, or had no type and the scheme was chosen from the page colour. */
  schemeFrom: "type" | "background";
  /** How many of the 15 colours came from the file. */
  fromFile: number;
  total: number;
  /** The colours the file did not give (or gave in a form Egg does not take), each with the VS Code default now in use. */
  defaults: { role: VsRole; label: string; key: string; hex: string; why: "missing" | "unsupported" }[];
  /** VS Code keys whose see-through colour was blended onto the page. */
  blended: string[];
};

export type VsImportResult = { ok: true; value: ThemeInput; report: VsImportReport } | { ok: false; error: string };

const HIDDEN_CHARS = /[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁠-⁤⁦-⁩﻿]/g;

function themeName(raw: unknown): string {
  const cleaned = typeof raw === "string" ? raw.replace(HIDDEN_CHARS, "").trim() : "";
  const name = Array.from(cleaned).slice(0, THEME_NAME_MAX).join("").trim();
  const checked = checkThemeName(name);
  return checked.ok ? checked.name : "VS Code theme";
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * Read a VS Code colour theme file as an Egg theme.
 *
 * - A file over 256 KB is refused before it is read.
 * - Comments and trailing commas are allowed (parseJsonWithComments).
 * - A theme with `include` is refused: it holds only the changes to another
 *   theme, and the colours of that theme are not here.
 * - `colors` must be an object. An extension's package.json (`contributes.themes`)
 *   points at theme files and has no colours; it is refused with a hint.
 * - `type` sets the scheme: `light` and `hc-light` are light, everything else
 *   is dark. With no `type` the scheme follows the page colour.
 * - The colours are mapped with VSCODE_MAP. Hex colours only; see pickColors.
 */
export function importVsCodeTheme(text: string, byteLength = new TextEncoder().encode(text).length): VsImportResult {
  if (byteLength > VSCODE_FILE_MAX_BYTES) return { ok: false, error: "That file is too large for a VS Code theme (256 KB at most)." };
  const parsed = parseJsonWithComments(text);
  if (!parsed.ok) return parsed;
  const file = parsed.value;
  if (!isRecord(file)) return { ok: false, error: "A VS Code theme file is a JSON object." };
  if (own(file, "include") !== undefined) return { ok: false, error: "This theme extends another theme. Export it as one file first." };

  const colors = own(file, "colors");
  if (!isRecord(colors) || Object.keys(colors).length === 0) {
    const contributes = own(file, "contributes");
    if (isRecord(contributes) && Array.isArray(contributes.themes)) {
      return { ok: false, error: "That is an extension's package.json. Import the theme file it points to instead." };
    }
    return { ok: false, error: 'That file has no colours. A VS Code theme file has a "colors" section.' };
  }

  // The scheme: from `type`, else from how light the page colour is.
  const type = own(file, "type");
  let scheme: ThemeScheme;
  let schemeFrom: VsImportReport["schemeFrom"] = "type";
  if (typeof type === "string") {
    scheme = type === "light" || type === "hc-light" ? "light" : "dark";
  } else {
    schemeFrom = "background";
    const page = flattenHex(own(colors, "editor.background"), [255, 255, 255]);
    const rgb = page ? (parseHex(page.hex)!.slice(0, 3) as Rgb) : null;
    // Dark when white text would read better on it than black text.
    scheme = !rgb || contrastRgb(rgb, [255, 255, 255]) >= contrastRgb(rgb, [0, 0, 0]) ? "dark" : "light";
  }

  const { tokens, picks } = tokensFromVsCodeColors(colors, scheme);
  const all = VS_ROLES.map((r) => picks[r]);
  const fromFile = all.filter((p) => p.from === "file").length;
  if (fromFile === 0) return { ok: false, error: "That file sets none of the colours Egg uses, so there is nothing to import." };

  const name = themeName(own(file, "name") ?? own(file, "label"));
  return {
    ok: true,
    value: { name, scheme, tokens },
    report: {
      name,
      scheme,
      schemeFrom,
      fromFile,
      total: all.length,
      defaults: all
        .filter((p) => p.from === "default")
        .map((p) => ({ role: p.role, label: VSCODE_MAP[p.role].label, key: p.key, hex: p.hex, why: p.why ?? "missing" })),
      blended: all.filter((p) => p.blended && p.from === "file").map((p) => p.key),
    },
  };
}

/** The sentence after an import: where the colours came from. */
export function describeImport(r: VsImportReport): string {
  const d = r.defaults.length;
  const rest = d > 0 ? `, ${d} ${d === 1 ? "is a default" : "are defaults"}` : "";
  return `Imported "${r.name}" as a ${r.scheme} theme. ${r.fromFile} of ${r.total} colours came from the file${rest}.`;
}

/** "We used a default for Border (panel.border), Link (textLink.foreground)." or null when there are none. */
export function describeDefaults(r: VsImportReport): string | null {
  if (r.defaults.length === 0) return null;
  return `We used a default for ${r.defaults.map((d) => `${d.label} (${d.key}${d.why === "unsupported" ? ", not a hex colour" : ""})`).join(", ")}.`;
}
