import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { QUICK_DEFAULTS, THEME_TOKENS, deriveTokens } from "@/lib/custom-theme";
import {
  AVATARS,
  DARK_PRESET_IDS,
  DEFAULT_APPEARANCE,
  LEGACY_ACCENTS,
  LEGACY_ACCENT_PRESET,
  LIGHT_PRESET_IDS,
  PRESETS,
  PRESET_IDS,
  appearanceCookie,
  COOKIE_VALUE_LIMIT,
  bootScript,
  characterFor,
  characterPath,
  effectivePreset,
  htmlAttributes,
  isCustomPreset,
  isValidBranchName,
  parseAppearance,
  parseCustomThemes,
  presetFor,
  presetFromStored,
  schemeOfPreset,
  serializeAppearance,
  shownName,
  themeChoiceFromLegacy,
  themeMode,
  type Appearance,
  type CustomThemes,
  type ThemeChoice,
} from "@/lib/preferences";

describe("branch names", () => {
  it.each(["main", "feature/login", "release-1.2", "v1.0.0", "a/b/c", "user/jo_e"])("accepts %s", (b) => {
    expect(isValidBranchName(b)).toBe(true);
  });
  it.each([
    "",
    " main",
    "has space",
    "-leading-dash",
    "/lead",
    "trail/",
    "trail.",
    "a..b",
    "a//b",
    "a@{b",
    "@",
    "x.lock",
    "dir/x.lock",
    ".hidden",
    "dir/.hidden",
    "a~b",
    "a^b",
    "a:b",
    "a?b",
    "a*b",
    "a[b",
    "a\\b",
    "a\u0000b",
    "x".repeat(101),
  ])("rejects %j", (b) => {
    expect(isValidBranchName(b)).toBe(false);
  });
  it("allows exactly 100 characters", () => {
    expect(isValidBranchName("x".repeat(100))).toBe(true);
  });
});

describe("characters", () => {
  it("has at least eight, with unique ids pixel-01 to pixel-08 and unique labels", () => {
    expect(AVATARS.length).toBeGreaterThanOrEqual(8);
    expect(AVATARS.slice(0, 8).map((a) => a.id)).toEqual(
      ["01", "02", "03", "04", "05", "06", "07", "08"].map((n) => `pixel-${n}`)
    );
    expect(new Set(AVATARS.map((a) => a.id)).size).toBe(AVATARS.length);
    expect(new Set(AVATARS.map((a) => a.label)).size).toBe(AVATARS.length);
  });
  it("draws each on an 8 by 8 grid, and no two the same", () => {
    for (const a of AVATARS) {
      expect(a.rows, a.id).toHaveLength(8);
      for (const r of a.rows) expect(r, a.id).toMatch(/^[#.]{8}$/);
    }
    expect(new Set(AVATARS.map((a) => a.rows.join("/"))).size).toBe(AVATARS.length);
  });
  it("falls back to the first for an unknown id and makes a path with one square per pixel", () => {
    expect(characterFor("nope").id).toBe("pixel-01");
    expect(characterFor(null).id).toBe("pixel-01");
    const lit = AVATARS[0].rows.join("").replace(/\./g, "").length;
    expect(characterPath(AVATARS[0].rows).split("M").length - 1).toBe(lit);
  });
});

describe("shown name", () => {
  it("prefers the display name and falls back to the Hack Club one", () => {
    expect(shownName({ displayName: "Mo" }, "Maureen Hacker")).toBe("Mo");
    expect(shownName({ displayName: null }, "Maureen Hacker")).toBe("Maureen Hacker");
    expect(shownName({ displayName: "  " }, "Maureen Hacker")).toBe("Maureen Hacker");
  });
});

describe("the egg_prefs cookie", () => {
  const a: Appearance = {
    matchDevice: false,
    lightPreset: "github-light",
    darkPreset: "nord",
    preset: "github-dark",
    density: "compact",
    reducedMotion: "reduce",
  };
  it("round-trips, and holds nothing but the appearance choices", () => {
    expect(serializeAppearance(a)).toBe("match=0&light=github-light&dark=nord&preset=github-dark&density=compact&motion=reduce");
    expect(parseAppearance(encodeURIComponent(serializeAppearance(a)))).toEqual(a);
    expect(parseAppearance(serializeAppearance({ ...a, matchDevice: true })).matchDevice).toBe(true);
  });
  it("drops unknown values and a theme in the wrong slot, and survives garbage", () => {
    expect(parseAppearance("match=1&light=github-dark&dark=github-light&preset=github-dark&x=1")).toEqual({
      matchDevice: true,
      preset: "github-dark",
    });
    expect(parseAppearance("match=1&light=solarized&preset=solarized&density=tiny")).toEqual({ matchDevice: true });
    expect(parseAppearance("%E0%A4%A")).toEqual({});
    expect(parseAppearance("")).toEqual({});
    expect(parseAppearance(null)).toEqual({});
  });
  it("reads a cookie from before light and dark themes as the choice it meant", () => {
    expect(parseAppearance("theme=dark&accent=blue&density=compact&motion=system")).toEqual({
      matchDevice: false,
      lightPreset: "github-light",
      darkPreset: "github-dark",
      preset: "github-dark",
      density: "compact",
      reducedMotion: "system",
    });
    // A preset wins over an old accent, whichever comes first.
    const nord = { matchDevice: true, lightPreset: "egg-light", darkPreset: "nord", preset: "nord" };
    expect(parseAppearance("accent=blue&preset=nord")).toEqual(nord);
    expect(parseAppearance("preset=nord&accent=blue")).toEqual(nord);
    expect(parseAppearance("accent=pink")).toEqual({});
    expect(parseAppearance("theme=neon")).toEqual({});
  });
  it("is readable by the page (not HttpOnly), Lax, one year", () => {
    const c = appearanceCookie(a, false);
    expect(c).toMatch(/^egg_prefs=/);
    expect(c).toContain("SameSite=Lax");
    expect(c).toContain("Max-Age=31536000");
    expect(c).not.toContain("HttpOnly");
    expect(c).not.toContain("Secure");
    expect(appearanceCookie(a, true)).toContain("; Secure");
  });
  it("sets attributes only for non-default choices, and always clears the old accent attribute", () => {
    expect(htmlAttributes(a)).toEqual({
      "data-theme-preset": "github-dark",
      "data-accent": null,
      "data-density": "compact",
      "data-motion": "reduce",
    });
    expect(htmlAttributes(DEFAULT_APPEARANCE, true)).toEqual({
      "data-theme-preset": null,
      "data-accent": null,
      "data-density": null,
      "data-motion": null,
    });
  });
  it("follows the device while matching: the light theme by day and the dark theme by night", () => {
    const m = { ...a, matchDevice: true };
    expect(htmlAttributes(m, false)["data-theme-preset"]).toBe("github-light");
    expect(htmlAttributes(m, true)["data-theme-preset"]).toBe("nord");
    expect(htmlAttributes({ ...m, matchDevice: false }, false)["data-theme-preset"]).toBe("github-dark");
  });
});

describe("the colour themes", () => {
  it("each has one fixed scheme, and no partner", () => {
    for (const p of PRESETS) {
      expect(["light", "dark"], p.id).toContain(p.scheme);
      expect(Object.keys(p), p.id).not.toContain("partner");
    }
  });
  it("lists the light themes as light and the dark themes as dark, and together all of them", () => {
    for (const id of LIGHT_PRESET_IDS) expect(presetFor(id).scheme, id).toBe("light");
    for (const id of DARK_PRESET_IDS) expect(presetFor(id).scheme, id).toBe("dark");
    expect([...LIGHT_PRESET_IDS, ...DARK_PRESET_IDS].sort()).toEqual([...PRESET_IDS].sort());
    expect(LIGHT_PRESET_IDS).toEqual([
      "egg-light",
      "github-light",
      "vscode-light",
      "catppuccin-latte",
      "rose-pine-dawn",
      "solarized-light",
      "ayu-light",
      "one-light",
    ]);
    expect(DARK_PRESET_IDS).toEqual([
      "egg-dark",
      "github-dark",
      "vscode-dark",
      "nord",
      "gruvbox-dark",
      "dracula",
      "one-dark",
      "tokyo-night",
      "catppuccin-mocha",
      "rose-pine",
      "monokai",
      "ayu-dark",
      "solarized-dark",
    ]);
  });
  it("names the brands it is inspired by, in the label", () => {
    const added = PRESETS.slice(8);
    expect(added).toHaveLength(13);
    for (const p of added) expect(p.label, p.id).toMatch(/^Inspired by /);
  });
  it("has unique ids and labels, and Egg Light and Egg Dark as the defaults", () => {
    expect(PRESETS[0].id).toBe("egg-light");
    expect(new Set(PRESET_IDS).size).toBe(PRESETS.length);
    expect(new Set(PRESETS.map((p) => p.label)).size).toBe(PRESETS.length);
    expect(DEFAULT_APPEARANCE).toMatchObject({
      matchDevice: true,
      lightPreset: "egg-light",
      darkPreset: "egg-dark",
      preset: "egg-dark",
    });
  });
  it("moves every old accent to a colour theme that exists", () => {
    for (const accent of LEGACY_ACCENTS) {
      expect(PRESET_IDS, accent).toContain(LEGACY_ACCENT_PRESET[accent]);
      expect(presetFromStored(accent), accent).toBe(LEGACY_ACCENT_PRESET[accent]);
    }
    expect(presetFromStored("nord")).toBe("nord");
    expect(presetFromStored("constructor")).toBe("egg-light");
    expect(presetFromStored(null)).toBe("egg-light");
  });
});

describe("which colour theme is shown", () => {
  const choice: ThemeChoice = { matchDevice: true, lightPreset: "vscode-light", darkPreset: "gruvbox-dark", preset: "github-light" };

  it("while matching, is the light theme for a light device and the dark theme for a dark one", () => {
    expect(effectivePreset(choice, false)).toBe("vscode-light");
    expect(effectivePreset(choice, true)).toBe("gruvbox-dark");
  });
  it("with matching off, is the fixed theme whatever the device does", () => {
    for (const preset of PRESET_IDS) {
      for (const deviceDark of [false, true]) {
        expect(effectivePreset({ ...choice, matchDevice: false, preset }, deviceDark), `${preset} ${deviceDark}`).toBe(preset);
      }
    }
  });
  it("tells next-themes system while matching, else the scheme of the fixed theme", () => {
    expect(themeMode(choice)).toBe("system");
    expect(themeMode({ matchDevice: false, preset: "nord" })).toBe("dark");
    expect(themeMode({ matchDevice: false, preset: "vscode-light" })).toBe("light");
  });
  it("reads an old Mode and accent once: light and dark become one fixed theme, system turns matching on", () => {
    expect(themeChoiceFromLegacy("light", "default")).toEqual({
      matchDevice: false,
      lightPreset: "egg-light",
      darkPreset: "egg-dark",
      preset: "egg-light",
    });
    expect(themeChoiceFromLegacy("dark", "github-dark")).toEqual({
      matchDevice: false,
      lightPreset: "github-light",
      darkPreset: "github-dark",
      preset: "github-dark",
    });
    expect(themeChoiceFromLegacy("system", "nord")).toEqual({
      matchDevice: true,
      lightPreset: "egg-light",
      darkPreset: "nord",
      preset: "nord",
    });
    // A dark theme with Mode on light gives way to Egg Light, as it used to.
    expect(themeChoiceFromLegacy("light", "gruvbox-dark").preset).toBe("egg-light");
    expect(themeChoiceFromLegacy("system", undefined)).toEqual({
      matchDevice: true,
      lightPreset: DEFAULT_APPEARANCE.lightPreset,
      darkPreset: DEFAULT_APPEARANCE.darkPreset,
      preset: DEFAULT_APPEARANCE.preset,
    });
  });
});

describe("the script that runs before paint", () => {
  function run(cookie: string, opts: { deviceDark?: boolean } = {}) {
    const attrs = new Map<string, string>();
    const classes = new Set<string>();
    const store = new Map<string, string>();
    const vars = new Map<string, string>();
    const document = {
      cookie,
      documentElement: {
        setAttribute: (k: string, v: string) => attrs.set(k, v),
        style: { setProperty: (k: string, v: string) => vars.set(k, v) },
        classList: {
          remove: (...names: string[]) => names.forEach((n) => classes.delete(n)),
          add: (...names: string[]) => names.forEach((n) => classes.add(n)),
        },
      },
    };
    const localStorage = {
      setItem: (k: string, v: string) => store.set(k, v),
      getItem: (k: string) => store.get(k) ?? null,
    };
    const matchMedia = () => ({ matches: opts.deviceDark === true });
    new Function("document", "localStorage", "matchMedia", bootScript())(document, localStorage, matchMedia);
    return { attrs, classes, store, vars };
  }
  const cookieOf = (a: Appearance) => `egg_prefs=${encodeURIComponent(serializeAppearance(a))}`;

  it("applies the cookie to <html>, sets the class and seeds the mode for next-themes", () => {
    const { attrs, classes, store } = run(
      `a=1; egg_prefs=${encodeURIComponent("match=0&light=egg-light&dark=egg-dark&preset=github-dark&density=compact&motion=reduce")}; b=2`
    );
    expect(Object.fromEntries(attrs)).toEqual({
      "data-theme-preset": "github-dark",
      "data-density": "compact",
      "data-motion": "reduce",
    });
    expect([...classes]).toEqual(["dark"]);
    expect(store.get("theme")).toBe("dark");
  });
  it("does nothing without a cookie, and ignores values it does not know", () => {
    const none = run("other=1");
    expect(none.attrs.size + none.classes.size + none.store.size).toBe(0);
    const bad = run(`egg_prefs=${encodeURIComponent("match=maybe&preset=pink&density=tiny&motion=wild")}`);
    expect(bad.attrs.size + bad.classes.size + bad.store.size).toBe(0);
    // Unknown themes fall back to the defaults, never to a made-up attribute.
    const odd = run(`egg_prefs=${encodeURIComponent("match=0&preset=constructor")}`);
    expect(odd.attrs.size).toBe(0);
    expect([...odd.classes]).toEqual(["dark"]);
    const slot = run(`egg_prefs=${encodeURIComponent("match=1&light=nord&dark=github-light")}`, { deviceDark: true });
    expect(slot.attrs.size).toBe(0);
    expect([...slot.classes]).toEqual(["dark"]);
  });
  it("leaves the two Egg themes without an attribute", () => {
    const light = run(cookieOf(DEFAULT_APPEARANCE));
    expect(light.attrs.size).toBe(0);
    expect([...light.classes]).toEqual(["light"]);
    expect(light.store.get("theme")).toBe("system");
    const dark = run(cookieOf(DEFAULT_APPEARANCE), { deviceDark: true });
    expect(dark.attrs.size).toBe(0);
    expect([...dark.classes]).toEqual(["dark"]);
  });
  it("leaves a cookie from before light and dark themes to the app, apart from density and motion", () => {
    const { attrs, classes, store } = run(`egg_prefs=${encodeURIComponent("theme=dark&accent=blue&density=compact&motion=system")}`);
    expect(Object.fromEntries(attrs)).toEqual({ "data-density": "compact" });
    expect(classes.size + store.size).toBe(0);
  });
  it("shows the same colour theme and class as effectivePreset for every choice and device", () => {
    for (const matchDevice of [true, false]) {
      for (const lightPreset of LIGHT_PRESET_IDS) {
        for (const darkPreset of DARK_PRESET_IDS) {
          for (const preset of PRESET_IDS) {
            for (const deviceDark of [false, true]) {
              const a: Appearance = { ...DEFAULT_APPEARANCE, matchDevice, lightPreset, darkPreset, preset };
              const shown = effectivePreset(a, deviceDark);
              const want = shown === "egg-light" || shown === "egg-dark" ? undefined : shown;
              const { attrs, classes, store } = run(cookieOf(a), { deviceDark });
              const label = `${matchDevice ? "match" : "fixed"} ${lightPreset} ${darkPreset} ${preset} ${deviceDark ? "dark" : "light"} device`;
              expect(attrs.get("data-theme-preset"), label).toBe(want);
              expect([...classes], label).toEqual([presetFor(shown).scheme]);
              expect(store.get("theme"), label).toBe(themeMode(a));
            }
          }
        }
      }
    }
  });
  describe("custom themes", () => {
    const darkId = "custom:0123456789abcdef";
    const lightId = "custom:fedcba9876543210";
    const darkTokens = deriveTokens(QUICK_DEFAULTS.dark, "dark");
    const lightTokens = deriveTokens(QUICK_DEFAULTS.light, "light");
    const customs: CustomThemes = {
      [darkId]: { scheme: "dark", tokens: darkTokens },
      [lightId]: { scheme: "light", tokens: lightTokens },
    };
    const choice = (over: Partial<Appearance>): Appearance => ({ ...DEFAULT_APPEARANCE, matchDevice: false, ...over });
    const cookie = (value: string) => `egg_prefs=${encodeURIComponent(value)}`;

    it("sets every colour as a --ct-<n> variable, the attribute and the class, for a fixed custom theme", () => {
      const { attrs, classes, store, vars } = run(cookie(serializeAppearance(choice({ preset: darkId }), customs)));
      expect(vars.size).toBe(THEME_TOKENS.length);
      THEME_TOKENS.forEach((name, i) => expect(vars.get(`--ct-${i}`), name).toBe(darkTokens[name]));
      expect(attrs.get("data-theme-preset")).toBe("custom");
      expect([...classes]).toEqual(["dark"]);
      expect(store.get("theme")).toBe("dark");
      const light = run(cookie(serializeAppearance(choice({ preset: lightId }), customs)));
      expect([...light.classes]).toEqual(["light"]);
      expect(light.vars.get("--ct-0")).toBe(lightTokens[THEME_TOKENS[0]]);
    });

    it("picks the custom theme for the device while matching, and the built-in one for the other side", () => {
      const a = choice({ matchDevice: true, lightPreset: lightId, darkPreset: "nord" });
      const day = run(cookie(serializeAppearance(a, customs)), { deviceDark: false });
      expect(day.attrs.get("data-theme-preset")).toBe("custom");
      expect(day.vars.size).toBe(THEME_TOKENS.length);
      expect([...day.classes]).toEqual(["light"]);
      expect(day.store.get("theme")).toBe("system");
      const night = run(cookie(serializeAppearance(a, customs)), { deviceDark: true });
      expect(night.attrs.get("data-theme-preset")).toBe("nord");
      expect(night.vars.size).toBe(0);
    });

    // The cookie is text the person (or a script on another page of this site) can edit, so every value is checked.
    const withValue = (index: number, value: string) => {
      const pairs = THEME_TOKENS.map((name, i) => `${i}:${i === index ? value : darkTokens[name]}`).join(",");
      return cookie(`match=0&light=egg-light&dark=egg-dark&preset=${darkId}&density=comfortable&motion=system&t_${darkId.slice(7)}=d,${pairs}`);
    };

    it.each([
      "#fff;background:url(x)",
      "#fff;background:url(https://example.com/x.png)",
      "url(https://example.com/x.png)",
      "url(x)",
      "red",
      "rgb(0 0 0)",
      "#12345",
      "#fff !important",
      "#fff}body{display:none",
      " #fff",
      "",
    ])("sets nothing from a cookie with the value %j, and shows the default dark theme", (bad) => {
      const { attrs, classes, vars } = run(withValue(7, bad));
      expect(vars.size).toBe(0);
      expect(attrs.has("data-theme-preset")).toBe(false);
      expect([...classes]).toEqual(["dark"]);
    });

    it("sets nothing when the set is not exactly the tokens: too few, too many, a repeated or out-of-range position", () => {
      const ok = THEME_TOKENS.map((name, i) => `${i}:${darkTokens[name]}`);
      const head = `match=0&preset=${darkId}&t_${darkId.slice(7)}=d`;
      for (const list of [
        ok.slice(1),
        [...ok, `${THEME_TOKENS.length}:#fff`],
        [...ok.slice(0, -1), "0:#fff"],
        [...ok.slice(0, -1), "99:#fff"],
        [...ok.slice(0, -1), "-1:#fff"],
        [...ok.slice(0, -1), "x:#fff"],
        [...ok.slice(0, -1), "51#fff"],
      ]) {
        const { attrs, vars } = run(cookie(`${head},${list.join(",")}`));
        expect(vars.size).toBe(0);
        expect(attrs.has("data-theme-preset")).toBe(false);
      }
    });

    it("only runs for an id of the right shape, and only in the slot of its own scheme", () => {
      const pairs = THEME_TOKENS.map((name, i) => `${i}:${darkTokens[name]}`).join(",");
      const odd = run(cookie(`match=0&preset=custom:../../x&t_../../x=d,${pairs}`));
      expect(odd.vars.size).toBe(0);
      expect(odd.attrs.size).toBe(0);
      // A dark custom theme in the light slot is ignored: the light default shows.
      const slot = run(cookie(`match=1&light=${darkId}&dark=egg-dark&t_${darkId.slice(7)}=d,${pairs}`), { deviceDark: false });
      expect(slot.vars.size).toBe(0);
      expect(slot.attrs.has("data-theme-preset")).toBe(false);
      expect([...slot.classes]).toEqual(["light"]);
    });

    it("never sets a property but --ct-<n>, whatever the cookie says", () => {
      const names = new Set<string>();
      const { vars } = run(cookie(serializeAppearance(choice({ preset: darkId }), customs)));
      for (const k of vars.keys()) names.add(k);
      expect([...names].every((k) => /^--ct-\d{1,2}$/.test(k))).toBe(true);
    });

    it("shows the default for the scheme when the cookie names the theme but not its colours (too big for the cookie)", () => {
      const named = serializeAppearance(choice({ preset: darkId }), customs, 100);
      expect(named).toContain(`t_${darkId.slice(7)}=d`);
      expect(named).not.toContain("0:#");
      const dark = run(cookie(named));
      expect(dark.vars.size).toBe(0);
      expect(dark.attrs.has("data-theme-preset")).toBe(false);
      expect([...dark.classes]).toEqual(["dark"]);
      const light = run(cookie(serializeAppearance(choice({ preset: lightId }), customs, 100)));
      expect([...light.classes]).toEqual(["light"]);
      expect(light.vars.size).toBe(0);
    });
  });

  it("is short", () => {
    // It grew when custom themes came: the hex rule and the colour check are in it.
    expect(bootScript().length).toBeLessThan(2800);
  });
});

// ------------------------------------------------------------------ contrast

const css = readFileSync(path.join(process.cwd(), "src/app/globals.css"), "utf8").replace(/\r\n/g, "\n");

type Tokens = Record<string, string>;

function declarations(body: string): Tokens {
  return Object.fromEntries([...body.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim().replace(/\s+/g, " ")]));
}

/** The declarations of the first rule whose selector starts with `selector`. */
function rule(selector: string, exact = false): { selector: string; tokens: Tokens; body: string } {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`(^|\\n)(${escaped}${exact ? "\\s*" : "[^{]*"})\\{`);
  const m = re.exec(css);
  if (!m) throw new Error(`No block for ${selector}`);
  const open = m.index + m[0].length;
  const body = css.slice(open, css.indexOf("}", open));
  return { selector: m[2].trim(), tokens: declarations(body), body };
}

const rgb = (hex: string): [number, number, number] => {
  const n = parseInt(hex.slice(1, 7), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const lum = ([r, g, b]: number[]) => {
  const f = (c: number) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
function contrast(a: number[], b: number[]) {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
const mix = (fg: number[], bg: number[], alpha: number) => fg.map((c, i) => c * alpha + bg[i] * (1 - alpha));

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  s /= 100;
  l /= 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0) * 255, f(8) * 255, f(4) * 255];
}

/** A colour token as [r, g, b, alpha], following var() references. Throws on anything it cannot read. */
function color(tokens: Tokens, name: string, depth = 0): [number, number, number, number] {
  const raw = tokens[name];
  if (raw === undefined) throw new Error(`${name} is not defined`);
  if (depth > 8) throw new Error(`${name} refers to itself`);
  const ref = /^var\((--[\w-]+)\)$/.exec(raw);
  if (ref) return color(tokens, ref[1], depth + 1);
  // color-mix(in srgb, <a> N%, <b>) of two tokens: the blend Egg uses for the button hover colour.
  const blend = /^color-mix\(in srgb, var\((--[\w-]+)\) (\d+)%, var\((--[\w-]+)\)\)$/.exec(raw);
  if (blend) {
    const [r, g, b] = color(tokens, blend[1], depth + 1);
    const [r2, g2, b2] = color(tokens, blend[3], depth + 1);
    const k = +blend[2] / 100;
    return [r * k + r2 * (1 - k), g * k + g2 * (1 - k), b * k + b2 * (1 - k), 1];
  }
  const hex = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(raw);
  if (hex) {
    const [r, g, b] = rgb(`#${hex[1]}`);
    return [r, g, b, hex[2] ? parseInt(hex[2], 16) / 255 : 1];
  }
  const hsl = /^hsl\((\d+(?:\.\d+)?) (\d+(?:\.\d+)?)% (\d+(?:\.\d+)?)%\)$/.exec(raw);
  if (hsl) return [...hslToRgb(+hsl[1], +hsl[2], +hsl[3]), 1];
  throw new Error(`${name}: cannot read "${raw}"`);
}

const hexOf = (c: number[]) => "#" + c.slice(0, 3).map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");

/** Colour tokens every theme must resolve, whether it lists them itself or inherits them. */
const RESOLVED = [
  "--background", "--background-subtle", "--foreground", "--card", "--card-foreground", "--popover", "--popover-foreground",
  "--muted", "--muted-foreground", "--subtle-foreground", "--secondary", "--accent", "--border", "--input", "--ring",
  "--primary", "--primary-foreground", "--brand", "--brand-foreground", "--brand-soft", "--brand-text", "--selected", "--selected-foreground", "--primary-hover",
  "--success", "--warning", "--destructive", "--destructive-foreground", "--status-ready", "--status-building", "--status-error",
  "--tone-info-bg", "--tone-success-bg", "--tone-warning-bg", "--tone-error-bg", "--tone-note-bg",
];

/** What a non-Egg theme must write out itself, so a theme can never quietly inherit another theme's colour. */
const OWN = [
  "--ds-background-100", "--ds-background-200",
  ...[100, 200, 300, 400, 500, 600, 700, 800, 900, 1000].map((n) => `--ds-gray-${n}`),
  ...[100, 200, 300, 400, 500, 600].map((n) => `--ds-gray-alpha-${n}`),
  "--ds-blue-100", "--ds-blue-700", "--ds-blue-900", "--ds-red-100", "--ds-red-800", "--ds-red-900",
  "--ds-green-100", "--ds-green-900", "--ds-teal-600", "--ds-teal-900", "--ds-amber-100", "--ds-amber-700", "--ds-amber-900",
  "--ds-focus-color", "--foreground", "--muted-foreground", "--subtle-foreground", "--primary", "--primary-foreground",
  "--brand", "--brand-foreground", "--brand-soft", "--brand-text", "--link", "--selected",
  "--success", "--warning", "--destructive", "--destructive-foreground", "--status-ready", "--status-building", "--status-error",
  "--pixel-dot", "--skeleton-highlight", "--selected-foreground", "--primary-hover",
];

/**
 * Pairs where a VS Code colour, kept exactly as VS Code has it, is below the
 * bar. Nothing else is excused: any other pair, and every other theme, must
 * pass. Each ratio is pinned, so a change shows up here. VS Code uses these
 * colours with other partners than Egg does (the selected row has its own
 * white text, the button its own darker hover, the warning is an editor
 * squiggle), so they are not wrong in VS Code. Why each one is here:
 *  - "descriptionForeground" (#717171) on the Light+ side bar colour (#f3f3f3)
 *  - the same on Egg's muted surface (the text mixed 6% into the card)
 *  - "editorWarning.foreground" (#bf8803) on white and on #f3f3f3
 */
const KNOWN_BELOW_AA: Record<string, Record<string, number>> = {
  "vscode-light": {
    "muted text on a card": 4.399,
    "muted text on a muted surface": 4.057,
    "--warning text on the page": 3.117,
    "--warning text on a card": 2.809,
  },
};

const base = rule(":root", true);
const dark = rule(".dark", true);

function themeTokens(id: string): { tokens: Tokens; own: Tokens | null; selector: string; body: string } {
  const def = presetFor(id);
  if (id === "egg-light") return { tokens: base.tokens, own: null, selector: ":root", body: base.body };
  if (id === "egg-dark") return { tokens: { ...base.tokens, ...dark.tokens }, own: null, selector: ".dark", body: dark.body };
  const r = rule(`:root${def.scheme === "dark" ? ".dark" : ""}[data-theme-preset="${id}"]`);
  const scheme = def.scheme === "dark" ? { ...base.tokens, ...dark.tokens } : base.tokens;
  return { tokens: { ...scheme, ...r.tokens }, own: r.tokens, selector: r.selector, body: r.body };
}

describe("colour themes", () => {
  it("has one block for every theme but the two Egg ones, and none left over", () => {
    const found = [...css.matchAll(/\[data-theme-preset="([^"]+)"\]/g)].map((m) => m[1]);
    // "custom" is the one block every custom theme shares (see the custom theme tests below).
    expect([...new Set(found)].filter((id) => id !== "custom").sort()).toEqual(PRESET_IDS.filter((id) => !id.startsWith("egg-")).sort());
  });
  it("no longer has the accent-only blocks", () => {
    expect(css).not.toMatch(/\[data-accent=/);
  });
  it("applies only on pages that mark themselves as signed in", () => {
    for (const p of PRESETS.filter((x) => !x.id.startsWith("egg-"))) {
      expect(themeTokens(p.id).selector, p.id).toMatch(/:has\(\[data-signed-in\]\)$/);
    }
  });

  for (const def of PRESETS) {
    describe(def.label, () => {
      const t = themeTokens(def.id);

      it("lists every token itself and says its scheme", () => {
        if (t.own) {
          for (const name of OWN) expect(t.own[name], `${def.id} is missing ${name}`).toBeDefined();
          expect(t.body, "color-scheme").toContain(`color-scheme: ${def.scheme};`);
        }
        expect(t.selector.includes(".dark"), "dark class").toBe(def.scheme === "dark");
      });

      it("resolves every colour token to a colour", () => {
        for (const name of RESOLVED) expect(() => color(t.tokens, name), `${def.id} ${name}`).not.toThrow();
      });

      it("matches the swatch shown in Settings", () => {
        expect(hexOf(color(t.tokens, "--background-subtle"))).toBe(def.swatch.page);
        expect(hexOf(color(t.tokens, "--background"))).toBe(def.swatch.surface);
        expect(hexOf(color(t.tokens, "--foreground"))).toBe(def.swatch.text);
        expect(hexOf(color(t.tokens, "--primary"))).toBe(def.swatch.primary);
      });

      it("is a light or a dark page, as it says", () => {
        const page = lum(color(t.tokens, "--background-subtle"));
        if (def.scheme === "dark") expect(page).toBeLessThan(0.1);
        else expect(page).toBeGreaterThan(0.5);
      });

      it("passes WCAG AA: 4.5:1 for text, 3:1 for the focus ring", () => {
        const c = (n: string) => color(t.tokens, n).slice(0, 3);
        const page = c("--background-subtle");
        const surface = c("--background");
        const popover = c("--popover");
        const muted = c("--muted");
        const text = c("--foreground");
        const primary = c("--primary");
        const known = KNOWN_BELOW_AA[def.id] ?? {};
        const atLeast = (what: string, ratio: number, min: number) => {
          const recorded = known[what];
          if (recorded === undefined) return expect(ratio, what).toBeGreaterThanOrEqual(min);
          // A VS Code colour that misses AA, kept as VS Code has it. It must still be exactly as recorded and still below the bar.
          expect(ratio, `${what} (recorded)`).toBeCloseTo(recorded, 2);
          expect(ratio, `${what} (now passes: remove it from KNOWN_BELOW_AA)`).toBeLessThan(min);
        };

        atLeast("text on the page", contrast(text, page), 4.5);
        atLeast("text on a card", contrast(text, surface), 4.5);
        atLeast("text on a menu", contrast(text, popover), 4.5);
        atLeast("text on a muted surface", contrast(text, muted), 4.5);
        atLeast("muted text on the page", contrast(c("--muted-foreground"), page), 4.5);
        atLeast("muted text on a card", contrast(c("--muted-foreground"), surface), 4.5);
        atLeast("muted text on a muted surface", contrast(c("--muted-foreground"), muted), 4.5);
        atLeast("quiet text on the page", contrast(c("--subtle-foreground"), page), 4.5);
        atLeast("quiet text on a card", contrast(c("--subtle-foreground"), surface), 4.5);
        atLeast("text on the primary button", contrast(c("--primary-foreground"), primary), 4.5);
        // The hover colour is the theme's own (VS Code's button.hoverBackground, else the primary blended 15% toward the page).
        atLeast("text on the primary button on hover", contrast(c("--primary-foreground"), c("--primary-hover")), 4.5);
        atLeast("text on the brand colour", contrast(c("--brand-foreground"), c("--brand")), 4.5);
        atLeast("accent text on the page", contrast(c("--brand-text"), page), 4.5);
        atLeast("accent text on a card", contrast(c("--brand-text"), surface), 4.5);
        atLeast("accent text on its tint", contrast(c("--brand-text"), c("--brand-soft")), 4.5);
        if (t.tokens["--link"] !== "currentcolor") {
          atLeast("link on the page", contrast(c("--link"), page), 4.5);
          atLeast("link on a card", contrast(c("--link"), surface), 4.5);
          atLeast("link on the accent tint", contrast(c("--link"), c("--brand-soft")), 4.5);
        }
        const sel = color(t.tokens, "--selected");
        const selectedText = c("--selected-foreground");
        atLeast("text on the selected item over the page", contrast(selectedText, mix(sel.slice(0, 3), page, sel[3])), 4.5);
        atLeast("text on the selected item over a card", contrast(selectedText, mix(sel.slice(0, 3), surface, sel[3])), 4.5);
        atLeast("focus ring on the page", contrast(c("--ds-focus-color"), page), 3);
        atLeast("focus ring on a card", contrast(c("--ds-focus-color"), surface), 3);
        for (const status of ["--success", "--warning", "--destructive"]) {
          atLeast(`${status} text on the page`, contrast(c(status), page), 4.5);
          atLeast(`${status} text on a card`, contrast(c(status), surface), 4.5);
        }
        atLeast("text on a solid destructive button", contrast(c("--destructive-foreground"), c("--destructive")), 4.5);
      });

      it("keeps the text on a selected row and the button hover colour as they were, except where VS Code gives its own", () => {
        const c = (n: string) => color(t.tokens, n).slice(0, 3);
        if (def.id.startsWith("vscode-")) return;
        expect(hexOf(c("--selected-foreground")), "selected-foreground").toBe(hexOf(c("--foreground")));
        if (t.own) {
          const blend = hexOf(mix(c("--primary"), c("--background-subtle"), 0.85));
          expect(hexOf(c("--primary-hover")), "primary-hover").toBe(blend);
        }
      });

      it("shows danger text at 4.5:1 or more on a muted surface and on a card", () => {
        const c = (n: string) => color(t.tokens, n).slice(0, 3);
        const danger = c("--destructive");
        expect(contrast(danger, c("--muted")), `${def.id} danger text on a muted surface`).toBeGreaterThanOrEqual(4.5);
        expect(contrast(danger, c("--card")), `${def.id} danger text on a card`).toBeGreaterThanOrEqual(4.5);
      });
    });
  }
});

// ------------------------------------------------------------ custom themes

describe("custom themes in the egg_prefs cookie", () => {
  const darkId = "custom:0123456789abcdef";
  const lightId = "custom:fedcba9876543210";
  const darkTokens = deriveTokens(QUICK_DEFAULTS.dark, "dark");
  const lightTokens = deriveTokens(QUICK_DEFAULTS.light, "light");
  const customs: CustomThemes = {
    [darkId]: { scheme: "dark", tokens: darkTokens },
    [lightId]: { scheme: "light", tokens: lightTokens },
  };
  const a: Appearance = { ...DEFAULT_APPEARANCE, matchDevice: true, lightPreset: lightId, darkPreset: darkId, preset: darkId };

  it("recognises only `custom:` and a short id of lower-case letters, digits and dashes", () => {
    expect(isCustomPreset(darkId)).toBe(true);
    for (const bad of ["custom:", "custom:short", "custom:UPPERCASE123", "custom:a b c d e f g h", "custom:../../x", "custom:x;y;z;1234", "nord", "", null, 5]) {
      expect(isCustomPreset(bad), String(bad)).toBe(false);
    }
  });

  it("writes the scheme and the colours of each custom theme that is shown, and round-trips them", () => {
    const raw = serializeAppearance(a, customs);
    expect(raw).toContain(`t_${darkId.slice(7)}=d,0:#`);
    expect(raw).toContain(`t_${lightId.slice(7)}=l,0:#`);
    const back = parseCustomThemes(encodeURIComponent(raw));
    expect(back[darkId]).toEqual({ scheme: "dark", tokens: darkTokens });
    expect(back[lightId]).toEqual({ scheme: "light", tokens: lightTokens });
    expect(parseAppearance(encodeURIComponent(raw))).toMatchObject({ lightPreset: lightId, darkPreset: darkId, preset: darkId });
  });

  it("writes only the themes that are shown: the fixed one while matching is off, the two slots while it is on", () => {
    const fixed = serializeAppearance({ ...a, matchDevice: false, preset: darkId, lightPreset: "egg-light" }, customs);
    expect(fixed).toContain(`t_${darkId.slice(7)}=`);
    expect(fixed).not.toContain(`t_${lightId.slice(7)}=`);
    expect(serializeAppearance({ ...DEFAULT_APPEARANCE }, customs)).toBe(serializeAppearance({ ...DEFAULT_APPEARANCE }));
  });

  it("stays well under the size limit for two themes", () => {
    expect(encodeURIComponent(serializeAppearance(a, customs)).length).toBeLessThan(COOKIE_VALUE_LIMIT);
    expect(COOKIE_VALUE_LIMIT).toBe(3500);
  });

  it("leaves a set out when the cookie would pass the limit: the theme is named with its scheme, and the page shows the default first", () => {
    const one = serializeAppearance(a, customs);
    const size = encodeURIComponent(one).length;
    // Room for the first theme but not the second: only the first carries colours.
    const tight = serializeAppearance(a, customs, size - 200);
    expect(tight).toContain(`t_${lightId.slice(7)}=l,0:#`);
    expect(tight).toContain(`t_${darkId.slice(7)}=d`);
    expect(tight).not.toContain(`t_${darkId.slice(7)}=d,`);
    // Room for neither.
    const none = serializeAppearance(a, customs, 200);
    expect(none).not.toContain("0:#");
    expect(none).toContain(`t_${lightId.slice(7)}=l`);
    const read = parseCustomThemes(encodeURIComponent(none));
    expect(read[lightId]).toEqual({ scheme: "light", tokens: null });
    // The choice survives, so the app can load the colours from the account.
    expect(parseAppearance(encodeURIComponent(none))).toMatchObject({ lightPreset: lightId, darkPreset: darkId });
    // And the attribute stays off until the colours are at hand.
    expect(htmlAttributes(a, false, read)["data-theme-preset"]).toBeNull();
    expect(htmlAttributes(a, false, customs)["data-theme-preset"]).toBe("custom");
  });

  it("drops a custom theme from the wrong slot, one without a scheme, and one with a bad id", () => {
    const raw = encodeURIComponent(`match=1&light=${darkId}&dark=${lightId}&preset=custom:nopenopenope&t_${darkId.slice(7)}=d&t_${lightId.slice(7)}=l`);
    expect(parseAppearance(raw)).toEqual({ matchDevice: true });
    expect(parseAppearance(encodeURIComponent(`match=0&preset=${darkId}`))).toEqual({ matchDevice: false });
    expect(parseCustomThemes(encodeURIComponent("t_../x=d&t_ABCDEFGH1234=d&t_abcdef12345=x"))).toEqual({});
  });

  it("reads colours only when all are there and every one passes the hex rule", () => {
    const pairs = THEME_TOKENS.map((n, i) => `${i}:${darkTokens[n]}`);
    const read = (list: string[]) => parseCustomThemes(encodeURIComponent(`t_${darkId.slice(7)}=d,${list.join(",")}`))[darkId];
    expect(read(pairs)?.tokens).toEqual(darkTokens);
    expect(read([...pairs.slice(0, -1), `${THEME_TOKENS.length - 1}:#fff;background:url(x)`])?.tokens).toBeNull();
    expect(read(pairs.slice(1))?.tokens).toBeNull();
    expect(read([...pairs.slice(0, -1), "0:#fff"])?.tokens).toBeNull();
  });

  it("works out the mode for a fixed custom theme from its scheme", () => {
    expect(themeMode({ matchDevice: false, preset: darkId }, customs)).toBe("dark");
    expect(themeMode({ matchDevice: false, preset: lightId }, customs)).toBe("light");
    expect(themeMode({ matchDevice: true, preset: lightId }, customs)).toBe("system");
    expect(schemeOfPreset(darkId)).toBe("dark");
  });

  it("falls back to the base theme for a custom theme the page does not have", () => {
    expect(htmlAttributes({ matchDevice: false, preset: darkId }, false, {})["data-theme-preset"]).toBeNull();
    expect(htmlAttributes({ matchDevice: false, preset: darkId }, false, { [darkId]: { scheme: "dark", tokens: null } })["data-theme-preset"]).toBeNull();
  });
});

describe("the custom theme block in globals.css", () => {
  const block = rule(':root[data-theme-preset="custom"]', false);

  it("reads every colour from the variable at its position and nothing else", () => {
    expect(block.selector).toMatch(/:has\(\[data-signed-in\]\)$/);
    expect(Object.keys(block.tokens)).toEqual(THEME_TOKENS.map((n) => `--${n}`));
    THEME_TOKENS.forEach((n, i) => expect(block.tokens[`--${n}`], n).toBe(`var(--ct-${i})`));
  });

  it("covers the same tokens a built-in theme writes itself", () => {
    expect([...THEME_TOKENS].sort()).toEqual(OWN.map((n) => n.slice(2)).sort());
  });

  it("sets the scheme for light and for dark", () => {
    expect(css).toMatch(/:root\.dark\[data-theme-preset="custom"\]:has\(\[data-signed-in\]\) \{\s*color-scheme: dark;/);
    expect(css).toMatch(/:root:not\(\.dark\)\[data-theme-preset="custom"\]:has\(\[data-signed-in\]\) \{\s*color-scheme: light;/);
  });
});
