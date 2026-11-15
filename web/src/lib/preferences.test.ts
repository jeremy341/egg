import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  ACCENTS,
  AVATARS,
  appearanceCookie,
  bootScript,
  characterFor,
  characterPath,
  htmlAttributes,
  isValidBranchName,
  parseAppearance,
  serializeAppearance,
  shownName,
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
  const a = { theme: "dark", accent: "violet", density: "compact", reducedMotion: "reduce" } as const;
  it("round-trips, and holds nothing but the four appearance choices", () => {
    expect(serializeAppearance(a)).toBe("theme=dark&accent=violet&density=compact&motion=reduce");
    expect(parseAppearance(encodeURIComponent(serializeAppearance(a)))).toEqual(a);
  });
  it("drops unknown values and survives garbage", () => {
    expect(parseAppearance("theme=neon&accent=blue&x=1")).toEqual({ accent: "blue" });
    expect(parseAppearance("%E0%A4%A")).toEqual({});
    expect(parseAppearance("")).toEqual({});
    expect(parseAppearance(null)).toEqual({});
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
  it("sets attributes only for non-default choices", () => {
    expect(htmlAttributes(a)).toEqual({ "data-accent": "violet", "data-density": "compact", "data-motion": "reduce" });
    expect(htmlAttributes({ accent: "default", density: "comfortable", reducedMotion: "system" })).toEqual({
      "data-accent": null,
      "data-density": null,
      "data-motion": null,
    });
  });
});

describe("the script that runs before paint", () => {
  function run(cookie: string) {
    const attrs = new Map<string, string>();
    const store = new Map<string, string>();
    const document = {
      cookie,
      documentElement: { setAttribute: (k: string, v: string) => attrs.set(k, v) },
    };
    const localStorage = { setItem: (k: string, v: string) => store.set(k, v) };
    new Function("document", "localStorage", bootScript())(document, localStorage);
    return { attrs, store };
  }
  it("applies the cookie to <html> and seeds the theme for next-themes", () => {
    const { attrs, store } = run(
      `a=1; egg_prefs=${encodeURIComponent("theme=dark&accent=green&density=compact&motion=reduce")}; b=2`
    );
    expect(Object.fromEntries(attrs)).toEqual({
      "data-accent": "green",
      "data-density": "compact",
      "data-motion": "reduce",
    });
    expect(store.get("theme")).toBe("dark");
  });
  it("does nothing without a cookie, and ignores values it does not know", () => {
    expect(run("other=1").attrs.size).toBe(0);
    const bad = run(`egg_prefs=${encodeURIComponent("theme=neon&accent=pink&density=tiny&motion=wild")}`);
    expect(bad.attrs.size).toBe(0);
    expect(bad.store.size).toBe(0);
  });
  it("leaves defaults alone", () => {
    const { attrs, store } = run(
      `egg_prefs=${encodeURIComponent("theme=system&accent=default&density=comfortable&motion=system")}`
    );
    expect(attrs.size).toBe(0);
    expect(store.get("theme")).toBe("system");
  });
});

// ------------------------------------------------------------------ contrast

const css = readFileSync(path.join(process.cwd(), "src/app/globals.css"), "utf8");

function block(selector: string): Record<string, string> {
  const start = css.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`No block for ${selector}`);
  const body = css.slice(css.indexOf("{", start) + 1, css.indexOf("}", start));
  return Object.fromEntries([...body.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
}

const rgb = (hex: string): [number, number, number] => {
  const n = parseInt(hex.slice(1), 16);
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

describe("accent palettes", () => {
  const modes = {
    light: { page: rgb("#ffffff"), selector: (a: string) => `:root[data-accent="${a}"]` },
    dark: { page: rgb("#0a0a0a"), selector: (a: string) => `:root.dark[data-accent="${a}"]` },
  } as const;

  for (const accent of ACCENTS.filter((a) => a !== "default")) {
    for (const [mode, m] of Object.entries(modes)) {
      it(`${accent} in ${mode} mode passes AA for text on the accent and the accent as text`, () => {
        const t = block(m.selector(accent));
        const primary = rgb(t["--primary"]);
        const onPrimary = rgb(t["--primary-foreground"]);
        const brand = rgb(t["--brand"]);
        const onBrand = rgb(t["--brand-foreground"]);
        const brandText = rgb(t["--brand-text"]);
        const soft = rgb(t["--brand-soft"]);
        expect(contrast(primary, onPrimary), "button text").toBeGreaterThanOrEqual(4.5);
        // The button blends toward the page to 85% of its colour on hover.
        expect(contrast(mix(primary, m.page, 0.85), onPrimary), "button text on hover").toBeGreaterThanOrEqual(4.5);
        expect(contrast(brand, onBrand), "brand pill text").toBeGreaterThanOrEqual(4.5);
        expect(contrast(brandText, m.page), "accent text on the page").toBeGreaterThanOrEqual(4.5);
        expect(contrast(brandText, soft), "accent text on its tint").toBeGreaterThanOrEqual(4.5);
        expect(contrast(rgb(t["--ds-focus-color"]), m.page), "focus ring on the page").toBeGreaterThanOrEqual(3);
      });
    }
  }
});
