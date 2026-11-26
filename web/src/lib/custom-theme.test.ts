import { describe, expect, it } from "vitest";
import {
  CUSTOM_THEME_LIMIT,
  QUICK_DEFAULTS,
  THEME_FILE_MAX_BYTES,
  THEME_TOKENS,
  checkContrast,
  checkThemeName,
  customVars,
  deriveTokens,
  describePair,
  parseThemeFile,
  parseThemeInput,
  quickFromTokens,
  themeFileName,
  themeFileText,
  upgradeTokens,
  type ThemeScheme,
  type ThemeTokens,
} from "@/lib/custom-theme";
import { contrastHex, isHexColor, nearestPassing, parseHex, rgbToHsl } from "@/lib/theme-color";

const SCHEMES: ThemeScheme[] = ["light", "dark"];

describe("the hex colour rule", () => {
  it.each(["#fff", "#FFF", "#abcd", "#aabbcc", "#AABBCC", "#aabbccdd", "#000", "#00000000"])("accepts %s", (v) => {
    expect(isHexColor(v)).toBe(true);
  });

  it.each([
    "",
    "#",
    "#f",
    "#ff",
    "#fffff", // five digits
    "#fffffff", // seven digits
    "#fffffffff", // nine digits
    "fff",
    "#ggg",
    " #fff",
    "#fff ",
    "#fff\n",
    "#fff;background:url(x)",
    "#fff;",
    "url(#fff)",
    "url(https://example.com/x.png)",
    "url(",
    "red",
    "rgb(0,0,0)",
    "rgb(0 0 0)",
    "hsl(0 0% 0%)",
    "var(--foreground)",
    "currentcolor",
    "#fff !important",
    "#fff}body{display:none",
    "javascript:alert(1)",
    "\\#fff",
  ])("rejects %j", (v) => {
    expect(isHexColor(v)).toBe(false);
  });

  it("rejects things that are not text", () => {
    for (const v of [null, undefined, 0xffffff, {}, [], ["#fff"], true]) expect(isHexColor(v)).toBe(false);
  });

  it("reads all four lengths to the same colour", () => {
    expect(parseHex("#f0a")).toEqual(parseHex("#ff00aa"));
    expect(parseHex("#f0a8")).toEqual(parseHex("#ff00aa88"));
    expect(parseHex("#ff00aa88")?.[3]).toBeCloseTo(0x88 / 255);
    expect(parseHex("#ff00aa")?.[3]).toBe(1);
    expect(parseHex("nope")).toBeNull();
  });
});

describe("building a theme from eight colours", () => {
  it("lists each token once, and a limit of 20 themes", () => {
    expect(new Set(THEME_TOKENS).size).toBe(THEME_TOKENS.length);
    expect(THEME_TOKENS).toHaveLength(54);
    // New tokens go at the end: the cookie and the --ct-<n> variables use the position.
    expect(THEME_TOKENS.slice(-2)).toEqual(["selected-foreground", "primary-hover"]);
    expect(THEME_TOKENS.indexOf("skeleton-highlight")).toBe(51);
    expect(CUSTOM_THEME_LIMIT).toBe(20);
  });

  for (const scheme of SCHEMES) {
    it(`gives every token a valid hex for the ${scheme} starting colours, and passes every contrast rule`, () => {
      const tokens = deriveTokens(QUICK_DEFAULTS[scheme], scheme);
      expect(Object.keys(tokens).sort()).toEqual([...THEME_TOKENS].sort());
      for (const name of THEME_TOKENS) expect(isHexColor(tokens[name]), `${name} ${tokens[name]}`).toBe(true);
      const report = checkContrast(tokens, scheme);
      expect(report.pairs.filter((p) => !p.pass).map(describePair)).toEqual([]);
    });
  }

  it("uses the eight colours as they are, and reads them back", () => {
    const q = { ...QUICK_DEFAULTS.dark, page: "#101820", card: "#1a2530", text: "#e8f0f8", primary: "#ffb000" };
    const tokens = deriveTokens(q, "dark");
    expect(tokens["ds-background-200"]).toBe(q.page);
    expect(tokens["ds-background-100"]).toBe(q.card);
    expect(tokens.foreground).toBe(q.text);
    expect(tokens.primary).toBe(q.primary);
    expect(quickFromTokens(tokens)).toEqual(q);
  });

  it("works the text on a selected row out from the page text, reaching 4.5:1 on the selected colour over the page and a card", () => {
    for (const scheme of SCHEMES) {
      const tokens = deriveTokens(QUICK_DEFAULTS[scheme], scheme);
      expect(tokens["selected-foreground"], scheme).toBe(tokens.foreground);
    }
    // A selected colour the page text would not read on moves the text, never the selected colour.
    const dim = deriveTokens({ ...QUICK_DEFAULTS.light, text: "#777777" }, "light", {}, { selected: "#6b6b6b" });
    expect(dim["selected-foreground"]).not.toBe(dim.foreground);
    expect(contrastHex(dim["selected-foreground"], "#6b6b6b")).toBeGreaterThanOrEqual(4.5);
    // A source can set it, and it is used as given.
    expect(deriveTokens(QUICK_DEFAULTS.light, "light", {}, { selectedForeground: "#123456" })["selected-foreground"]).toBe("#123456");
  });

  it("blends the primary colour 15% toward the page for the hover colour, unless a source gives one", () => {
    const light = deriveTokens({ ...QUICK_DEFAULTS.light, primary: "#000000" }, "light");
    // 85% black over #fafafa
    expect(light["primary-hover"]).toBe("#262626");
    expect(deriveTokens(QUICK_DEFAULTS.light, "light", {}, { primaryHover: "#223344" })["primary-hover"]).toBe("#223344");
  });

  it("adds both new colours to a theme saved without them, and leaves everything else as it was", () => {
    for (const scheme of SCHEMES) {
      const full = deriveTokens(QUICK_DEFAULTS[scheme], scheme);
      const { "selected-foreground": _a, "primary-hover": _b, ...old } = full;
      void _a;
      void _b;
      expect(upgradeTokens(old, scheme)).toEqual(full);
      // Already complete, or not a theme at all: handed back as it came.
      expect(upgradeTokens(full, scheme)).toBe(full);
      expect(upgradeTokens({ ...old, selected: "red" }, scheme)).toEqual({ ...old, selected: "red" });
      expect(upgradeTokens(null, scheme)).toBeNull();
    }
  });

  it("picks readable text for a button of any colour", () => {
    for (const primary of ["#ffffff", "#000000", "#777777", "#ff0000", "#00ff00", "#0000ff", "#ffff00", "#808000", "#ff8800"]) {
      const t = deriveTokens({ ...QUICK_DEFAULTS.light, primary }, "light");
      expect(contrastHex(t["primary-foreground"], t.primary), primary).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe("the contrast guard", () => {
  const withText = (scheme: ThemeScheme, text: string): ThemeTokens => deriveTokens({ ...QUICK_DEFAULTS[scheme], text }, scheme);

  it("lets a passing set through, with nothing to fix", () => {
    const report = checkContrast(withText("light", "#222222"), "light");
    expect(report.blocking).toEqual([]);
    expect(report.warnings).toEqual([]);
  });

  it("blocks a failing body pair, names it with the ratio, and suggests a colour that passes", () => {
    const tokens = withText("light", "#9a9a9a");
    const report = checkContrast(tokens, "light");
    expect(report.blocking.map((p) => p.id).sort()).toEqual(["text-card", "text-page"]);
    const page = report.blocking.find((p) => p.id === "text-page")!;
    expect(page.label).toBe("Text on the page");
    expect(page.ratio).toBeLessThan(4.5);
    expect(page.suggestion).toMatch(/^#[0-9a-f]{6}$/);
    expect(describePair(page)).toContain(page.ratio.toFixed(2));
    expect(describePair(page)).toContain(page.suggestion!);
    // The suggestion passes on the page and on the card.
    for (const bg of [tokens["ds-background-200"], tokens["ds-background-100"]]) {
      expect(contrastHex(page.suggestion!, bg)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("suggests a colour in the same hue, moving only the lightness", () => {
    const tokens = withText("dark", "#6b4ba8"); // a dim purple on near-black
    const report = checkContrast(tokens, "dark");
    const fix = report.blocking[0].suggestion!;
    expect(report.blocking.length).toBeGreaterThan(0);
    const [h0] = rgbToHsl(parseHex("#6b4ba8")!);
    const [h1] = rgbToHsl(parseHex(fix)!);
    expect(Math.abs(h1 - h0)).toBeLessThan(6);
    expect(contrastHex(fix, tokens["ds-background-200"], "dark")).toBeGreaterThanOrEqual(4.5);
    expect(contrastHex(fix, tokens["ds-background-100"], "dark")).toBeGreaterThanOrEqual(4.5);
  });

  it("finds the nearest passing colour in either direction, and null when none exists", () => {
    // Mid grey text on white needs to go darker; on black it needs to go lighter.
    expect(contrastHex(nearestPassing("#808080", ["#ffffff"], 4.5)!, "#ffffff")).toBeGreaterThanOrEqual(4.5);
    expect(contrastHex(nearestPassing("#808080", ["#000000"], 4.5, "dark")!, "#000000", "dark")).toBeGreaterThanOrEqual(4.5);
    // Backgrounds far apart in the middle: no lightness reaches 4.5 on both.
    expect(nearestPassing("#808080", ["#555555", "#aaaaaa"], 4.5)).toBeNull();
  });

  it("warns, and does not block, for a failing danger colour, the focus ring, button text and links", () => {
    const base = deriveTokens(QUICK_DEFAULTS.light, "light");
    const bad: ThemeTokens = {
      ...base,
      destructive: "#ffb3b3", // pale red on white
      "ds-focus-color": "#f0f0f0",
      primary: "#cccccc",
      "primary-foreground": "#dddddd",
      link: "#bbccff",
    };
    const report = checkContrast(bad, "light");
    expect(report.blocking).toEqual([]);
    const ids = report.warnings.map((p) => p.id);
    expect(ids).toEqual(expect.arrayContaining(["danger", "ring", "primary", "link"]));
    const danger = report.warnings.find((p) => p.id === "danger")!;
    expect(danger.min).toBe(4.5);
    expect(contrastHex(danger.suggestion!, bad["ds-background-100"])).toBeGreaterThanOrEqual(4.5);
    expect(contrastHex(danger.suggestion!, bad["ds-gray-100"])).toBeGreaterThanOrEqual(4.5);
    expect(report.warnings.find((p) => p.id === "ring")!.min).toBe(3);
  });

  it("checks danger text on a card and on a muted surface, and the ring at 3:1 on the page", () => {
    const ids = checkContrast(deriveTokens(QUICK_DEFAULTS.dark, "dark"), "dark").pairs.map((p) => [p.id, p.min, p.bg]);
    expect(ids).toContainEqual(["danger", 4.5, ["ds-background-100", "ds-gray-100"]]);
    expect(ids).toContainEqual(["ring", 3, ["ds-background-200"]]);
    expect(ids).toContainEqual(["primary", 4.5, ["primary"]]);
  });
});

describe("a theme name", () => {
  it("is trimmed, 1 to 40 characters, and has no control or invisible characters", () => {
    expect(checkThemeName("  Midnight  ")).toEqual({ ok: true, name: "Midnight" });
    expect(checkThemeName("x".repeat(40)).ok).toBe(true);
    for (const bad of ["", "   ", "x".repeat(41), "a\u0000b", "a\nb", "a\tb", "a‮b", "a​b", "\u007f", 5, null, undefined]) {
      expect(checkThemeName(bad).ok, JSON.stringify(bad)).toBe(false);
    }
  });
});

describe("a theme file", () => {
  const tokens = deriveTokens(QUICK_DEFAULTS.dark, "dark");
  const valid = { name: "Midnight", scheme: "dark" as const, tokens };

  it("round-trips an export, and an export holds the name, scheme and colours only", () => {
    const text = themeFileText(valid);
    expect(Object.keys(JSON.parse(text)).sort()).toEqual(["name", "scheme", "tokens"]);
    expect(text).not.toMatch(/user|owner|id"|email|createdAt/i);
    const back = parseThemeFile(text);
    expect(back).toEqual({ ok: true, value: valid });
  });

  it("accepts a valid file", () => {
    expect(parseThemeInput(valid).ok).toBe(true);
  });

  it("rejects a file over 8 KB before reading it", () => {
    const big = JSON.stringify({ ...valid, name: "x".repeat(THEME_FILE_MAX_BYTES) });
    const r = parseThemeFile(big);
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.error).toMatch(/too large/i);
    // The byte count the browser reports wins over the text length.
    expect(parseThemeFile(themeFileText(valid), THEME_FILE_MAX_BYTES + 1).ok).toBe(false);
    expect(THEME_FILE_MAX_BYTES).toBe(8192);
    expect(themeFileText(valid).length).toBeLessThan(THEME_FILE_MAX_BYTES);
  });

  it("rejects unknown keys, at the top and among the colours", () => {
    expect(parseThemeInput({ ...valid, id: "abc" }).ok).toBe(false);
    expect(parseThemeInput({ ...valid, userId: "u1" }).ok).toBe(false);
    expect(parseThemeInput({ ...valid, tokens: { ...tokens, "background-image": "#fff" } }).ok).toBe(false);
    expect(parseThemeInput({ ...valid, tokens: { ...tokens, __proto__x: "#fff" } }).ok).toBe(false);
    const missing = Object.fromEntries(Object.entries(tokens).filter(([k]) => k !== "foreground"));
    expect(parseThemeInput({ ...valid, tokens: missing }).ok).toBe(false);
  });

  it("rejects a colour that is not a hex, a bad scheme, a bad name and things that are not themes", () => {
    for (const bad of ["red", "url(x)", "#fff;background:url(x)", "#12345", "rgb(0 0 0)", " #fff", 5, null]) {
      expect(parseThemeInput({ ...valid, tokens: { ...tokens, primary: bad } }).ok, String(bad)).toBe(false);
    }
    expect(parseThemeInput({ ...valid, scheme: "sepia" }).ok).toBe(false);
    expect(parseThemeInput({ ...valid, name: "" }).ok).toBe(false);
    expect(parseThemeInput({ ...valid, name: "a\u0000" }).ok).toBe(false);
    for (const nope of [null, [], "x", 5, {}]) expect(parseThemeInput(nope).ok).toBe(false);
    expect(parseThemeFile("not json").ok).toBe(false);
    expect(parseThemeFile("[]").ok).toBe(false);
  });

  it("names a download after the theme and keeps odd characters out of it", () => {
    expect(themeFileName("My Midnight Blue!")).toBe("my-midnight-blue.egg-theme.json");
    expect(themeFileName("../../etc/passwd")).toBe("etc-passwd.egg-theme.json");
    expect(themeFileName("???")).toBe("theme.egg-theme.json");
  });
});

describe("the variables a theme sets", () => {
  const tokens = deriveTokens(QUICK_DEFAULTS.light, "light");

  it("are --ct-<position> for every token, in the token order", () => {
    const vars = customVars(tokens)!;
    expect(Object.keys(vars)).toHaveLength(THEME_TOKENS.length);
    THEME_TOKENS.forEach((name, i) => expect(vars[`--ct-${i}`]).toBe(tokens[name]));
  });

  it("are all or nothing: one bad or missing colour gives none", () => {
    expect(customVars({ ...tokens, primary: "#fff;background:url(x)" })).toBeNull();
    const missing = Object.fromEntries(Object.entries(tokens).filter(([k]) => k !== "primary"));
    expect(customVars(missing)).toBeNull();
    expect(customVars(null)).toBeNull();
    expect(customVars(undefined)).toBeNull();
  });
});
