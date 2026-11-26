import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { THEME_TOKENS, checkContrast, parseThemeInput, tokenProblem, type ThemeScheme } from "@/lib/custom-theme";
import defaults from "@/lib/vscode-theme/registry-defaults.json";
import {
  VSCODE_FILE_MAX_BYTES,
  VSCODE_KEYS,
  VSCODE_MAP,
  VS_ROLES,
  describeDefaults,
  describeImport,
  flattenHex,
  importVsCodeTheme,
  parseJsonWithComments,
  tokensFromVsCodeColors,
  vscodeDefault,
  type VsImportResult,
} from "@/lib/vscode-theme";
import { isHexColor } from "@/lib/theme-color";

const dir = path.join(process.cwd(), "src/lib/vscode-theme");
const read = (file: string) => readFileSync(path.join(dir, file), "utf8").replace(/\r\n/g, "\n");
const lumOf = (hex: string) => {
  const ch = (i: number) => {
    const v = parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * ch(0) + 0.7152 * ch(1) + 0.0722 * ch(2);
};
const contrast = (a: string, b: string) => {
  const [hi, lo] = [lumOf(a), lumOf(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
const css = readFileSync(path.join(process.cwd(), "src/app/globals.css"), "utf8").replace(/\r\n/g, "\n");

/** VS Code's own theme file with its `include` followed, as one flat `colors` section (the "one file" the importer asks for). */
function flattened(file: string): { type?: string; name: string; colors: Record<string, string> } {
  const own = parseJsonWithComments(read(file));
  if (!own.ok) throw new Error(own.error);
  const theme = own.value as { name: string; type?: string; include?: string; colors?: Record<string, string> };
  const base = theme.include ? flattened(theme.include.replace("./", "")) : { colors: {} as Record<string, string>, type: undefined };
  return { name: theme.name, type: theme.type ?? base.type, colors: { ...base.colors, ...theme.colors } };
}

/** The tokens of a built-in theme's block in globals.css. */
function builtin(id: string): Record<string, string> {
  const m = new RegExp(`\\n(:root[^{\\n]*data-theme-preset="${id}"[^{\\n]*)\\{([^}]*)\\}`).exec(css);
  if (!m) throw new Error(`No block for ${id}`);
  return Object.fromEntries([...m[2].matchAll(/--([\w-]+):\s*([^;]+);/g)].map((x) => [x[1], x[2].trim()]));
}

const ok = (r: VsImportResult) => {
  if (!r.ok) throw new Error(r.error);
  return r;
};
const theme = (extra: Record<string, unknown>) => JSON.stringify({ name: "Test", type: "dark", colors: {}, ...extra });
const run = (colors: Record<string, unknown>, extra: Record<string, unknown> = {}) => importVsCodeTheme(theme({ colors, ...extra }));

// ----------------------------------------------------------------- the mapping

describe("the VS Code mapping", () => {
  it("has the fifteen roles, each with at least one key, and no key twice", () => {
    expect([...VS_ROLES].sort()).toEqual(Object.keys(VSCODE_MAP).sort());
    expect(VS_ROLES).toHaveLength(15);
    for (const role of VS_ROLES) expect(VSCODE_MAP[role].keys.length, role).toBeGreaterThan(0);
    expect(new Set(VSCODE_KEYS).size).toBe(VSCODE_KEYS.length);
  });

  it("names the keys the owner asked for", () => {
    const keys = (r: keyof typeof VSCODE_MAP): readonly string[] => VSCODE_MAP[r].keys;
    expect(keys("page")).toEqual(["editor.background"]);
    expect(keys("card")).toEqual(["sideBar.background", "editorWidget.background"]);
    expect(keys("border")).toEqual(["panel.border", "editorGroup.border"]);
    expect(keys("text")).toEqual(["foreground"]);
    expect(keys("muted")).toEqual(["descriptionForeground"]);
    expect(keys("primary")).toEqual(["button.background"]);
    expect(keys("primaryHover")).toEqual(["button.hoverBackground"]);
    expect(keys("onPrimary")).toEqual(["button.foreground"]);
    expect(keys("link")).toEqual(["textLink.foreground"]);
    expect([...keys("danger")].sort()).toEqual(["editorError.foreground", "errorForeground"]);
    expect(keys("ring")).toEqual(["focusBorder"]);
    expect(keys("selected")).toEqual(["list.activeSelectionBackground"]);
    expect(keys("selectedForeground")).toEqual(["list.activeSelectionForeground"]);
    expect(keys("success")).toEqual(["terminal.ansiGreen", "gitDecoration.addedResourceForeground"]);
    expect(keys("warning")).toEqual(["editorWarning.foreground"]);
  });

  it("has a VS Code default for every key, for light and for dark, with a source file", () => {
    for (const key of VSCODE_KEYS) {
      for (const scheme of ["dark", "light"] as const) {
        const d = vscodeDefault(key, scheme);
        expect(d, `${scheme} ${key}`).toBeDefined();
        if (typeof d === "string") expect(isHexColor(d), `${scheme} ${key} ${d}`).toBe(true);
      }
      expect((defaults.files as Record<string, string>)[key], key).toMatch(/\.(ts|json)$/);
    }
  });
});

describe("the selected text and the button hover colour", () => {
  const files = defaults.files as Record<string, string>;
  const D = defaults as unknown as Record<ThemeScheme, Record<string, unknown>>;

  it("has VS Code's own values, with their source files, and the inactive selection Light+ uses", () => {
    expect(D.dark["list.activeSelectionForeground"]).toBe("#FFFFFF");
    expect(D.light["list.activeSelectionForeground"]).toBe("#FFFFFF");
    expect(D.dark["list.inactiveSelectionBackground"]).toBe("#37373D");
    expect(D.light["list.inactiveSelectionBackground"]).toBe("#E4E6F1");
    // inputColors.ts: dark lighten(buttonBackground, 0.2), light darken(buttonBackground, 0.2)
    expect(D.dark["button.hoverBackground"]).toEqual({ of: "button.background", lighten: 0.2 });
    expect(D.light["button.hoverBackground"]).toEqual({ of: "button.background", darken: 0.2 });
    expect(files["list.activeSelectionForeground"]).toMatch(/listColors\.ts$/);
    expect(files["list.inactiveSelectionBackground"]).toMatch(/listColors\.ts$/);
    expect(files["button.hoverBackground"]).toMatch(/inputColors\.ts$/);
  });

  it("works the button hover colour out from the button colour, as VS Code does", () => {
    // The dark default #0E639C lightened by 0.2 and the light default #007ACC darkened by 0.2 (HSL lightness).
    expect(tokensFromVsCodeColors({ "editor.background": "#1e1e1e" }, "dark").tokens["primary-hover"]).toBe("#1177bb");
    expect(tokensFromVsCodeColors({ "editor.background": "#ffffff" }, "light").tokens["primary-hover"]).toBe("#0062a3");
    // It follows the theme's own button colour, and a hover colour the theme sets wins.
    expect(tokensFromVsCodeColors({ "editor.background": "#1e1e1e", "button.background": "#008000" }, "dark").tokens["primary-hover"]).toBe("#009a00");
    expect(tokensFromVsCodeColors({ "editor.background": "#1e1e1e", "button.hoverBackground": "#112233" }, "dark").tokens["primary-hover"]).toBe("#112233");
  });

  it("takes the text on a selected row from the file, else white, and from the text colour when that would not read", () => {
    const colors = { "editor.background": "#1e1e1e", "list.activeSelectionBackground": "#04395e" };
    expect(tokensFromVsCodeColors(colors, "dark").tokens["selected-foreground"]).toBe("#ffffff");
    expect(tokensFromVsCodeColors({ ...colors, "list.activeSelectionForeground": "#abcdef" }, "dark").tokens["selected-foreground"]).toBe("#abcdef");
    // VS Code's white default on a pale selection: Egg uses the text colour of the theme.
    const pale = { "editor.background": "#ffffff", foreground: "#333333", "list.activeSelectionBackground": "#e4e6f1" };
    expect(tokensFromVsCodeColors(pale, "light").tokens["selected-foreground"]).toBe("#333333");
  });
});

// ------------------------------------------------------- the built-in presets

describe("VS Code Dark+ and Light+ are VS Code's own colours", () => {
  const D = defaults as unknown as Record<ThemeScheme, Record<string, string | { of: string; alpha: number }>>;
  const blend = (fg: string, bg: string, alpha: number) => {
    const n = (h: string, i: number) => parseInt(h.slice(1 + i * 2, 3 + i * 2), 16);
    return `#${[0, 1, 2].map((i) => Math.round(n(fg, i) * alpha + n(bg, i) * (1 - alpha)).toString(16).padStart(2, "0")).join("")}`;
  };

  for (const [id, file, scheme] of [
    ["vscode-dark", "dark_plus.json", "dark"],
    ["vscode-light", "light_plus.json", "light"],
  ] as const) {
    describe(id, () => {
      const source = flattened(file);
      const tokens = builtin(id);
      /** What VS Code shows for a key: the theme file's value, else VS Code's default. Lower case. */
      const value = (key: string): string => {
        const fromFile = source.colors[key];
        if (fromFile !== undefined) return fromFile.toLowerCase();
        const d = D[scheme][key];
        if (typeof d !== "string") throw new Error(`${key} has no plain default`);
        return d.toLowerCase();
      };
      const page = value("editor.background");
      const text = value(VSCODE_MAP.text.keys[0]);
      const onPage = (v: string) => (v.length === 9 ? blend(v.slice(0, 7), page, parseInt(v.slice(7), 16) / 255) : v);

      it("is the theme the file says it is", () => {
        expect(source.name).toBe(scheme === "dark" ? "Dark+" : "Light+");
        // Dark+ and Light+ include Dark (Visual Studio) and Light (Visual Studio): the colours live in the included file.
        expect(Object.keys(source.colors).length).toBeGreaterThan(5);
        expect(source.colors["editor.background"]).toBeDefined();
      });

      it("uses the page, card, text, button, link, ring, selected, success and warning colours of VS Code", () => {
        expect(tokens["ds-background-200"], "editor.background").toBe(page);
        expect(tokens["ds-background-100"], "sideBar.background").toBe(onPage(value("sideBar.background")));
        expect(tokens["foreground"], "foreground").toBe(text);
        expect(tokens["primary"], "button.background").toBe(onPage(value("button.background")));
        expect(tokens["primary-foreground"], "button.foreground").toBe(onPage(value("button.foreground")));
        expect(tokens["link"], "textLink.foreground").toBe(onPage(value("textLink.foreground")));
        expect(tokens["ds-focus-color"], "focusBorder").toBe(onPage(value("focusBorder")));
        // Light+ shows its inactive selection colour; see the comment in globals.css.
        const selectedKey = scheme === "light" ? "list.inactiveSelectionBackground" : "list.activeSelectionBackground";
        expect(tokens["selected"], selectedKey).toBe(onPage(value(selectedKey)));
        expect(tokens["selected-foreground"], "list.activeSelectionForeground, or the text colour on Light+").toBe(
          scheme === "light" ? text : value("list.activeSelectionForeground")
        );
        expect(contrast(tokens["selected-foreground"], tokens["selected"]), "selected text on the selected colour").toBeGreaterThanOrEqual(4.5);
        // inputColors.ts: dark lighten(button.background, 0.2), light darken(button.background, 0.2)
        expect(tokens["primary-hover"], "button.hoverBackground").toBe(scheme === "dark" ? "#1177bb" : "#0062a3");
        expect(tokens["success"], "terminal.ansiGreen").toBe(onPage(value("terminal.ansiGreen")));
        expect(tokens["warning"], "editorWarning.foreground").toBe(onPage(value("editorWarning.foreground")));
        expect(tokens["destructive"], "errorForeground").toBe(onPage(value("errorForeground")));
      });

      it("lays the see-through border and the muted text over the page, as VS Code does", () => {
        expect(tokens["ds-gray-alpha-400"], "panel.border").toBe(onPage(value("panel.border")));
        expect(tokens["muted-foreground"], "descriptionForeground").toBe(
          scheme === "dark" ? blend(text, page, 0.7) : onPage(value("descriptionForeground"))
        );
      });

      it("is exactly what importing the same colours as one file gives", () => {
        const imported = ok(importVsCodeTheme(JSON.stringify({ name: source.name, type: scheme, colors: source.colors })));
        expect(imported.value.scheme).toBe(scheme);
        for (const name of THEME_TOKENS) {
          if (scheme === "light" && (name === "selected" || name === "selected-foreground")) continue;
          expect(imported.value.tokens[name], name).toBe(tokens[name]);
        }
        // An import keeps VS Code's active pair; only the built-in Light+ shows the inactive colour.
        expect(imported.value.tokens.selected).toBe(onPage(value("list.activeSelectionBackground")));
        expect(imported.value.tokens["selected-foreground"]).toBe(value("list.activeSelectionForeground"));
      });
    });
  }

  it("round trip: importing the one-file VS Code themes (comments and trailing commas included) gives the built-in tokens", () => {
    for (const [file, id, scheme] of [
      ["dark_vs.json", "vscode-dark", "dark"],
      ["light_vs.json", "vscode-light", "light"],
    ] as const) {
      const imported = ok(importVsCodeTheme(read(file)));
      // The file has no `type`: the scheme comes from the page colour.
      expect(imported.report.schemeFrom, file).toBe("background");
      expect(imported.value.scheme, file).toBe(scheme);
      const tokens = builtin(id);
      for (const name of THEME_TOKENS) {
        if (id === "vscode-light" && (name === "selected" || name === "selected-foreground")) continue;
        expect(imported.value.tokens[name], `${id} ${name}`).toBe(tokens[name]);
      }
    }
  });

  it("refuses Dark+ and Light+ as they are: they only extend another theme", () => {
    for (const file of ["dark_plus.json", "light_plus.json"]) {
      const r = importVsCodeTheme(read(file));
      expect(r).toEqual({ ok: false, error: "This theme extends another theme. Export it as one file first." });
    }
  });
});

// -------------------------------------------------------------- the JSON reader

describe("reading JSON with comments", () => {
  const value = (text: string) => {
    const r = parseJsonWithComments(text);
    if (!r.ok) throw new Error(r.error);
    return r.value;
  };

  it("reads plain JSON", () => {
    expect(value('{"a": [1, 2, {"b": null}], "c": "d"}')).toEqual({ a: [1, 2, { b: null }], c: "d" });
  });
  it("drops line and block comments", () => {
    expect(value('// top\n{\n  "a": 1, // after\n  /* block\n spanning */ "b": 2\n}')).toEqual({ a: 1, b: 2 });
    expect(value('{"a": 1/**/, "b": [1, /* x */ 2]}')).toEqual({ a: 1, b: [1, 2] });
  });
  it("drops trailing commas in objects and arrays, also with a comment or blank space after them", () => {
    expect(value('{"a": [1, 2,], "b": {"c": 3,},}')).toEqual({ a: [1, 2], b: { c: 3 } });
    expect(value('{"a": 1, // last\n}')).toEqual({ a: 1 });
    expect(value('{"a": [1,\n  2, /* end */\n  ]\n}')).toEqual({ a: [1, 2] });
  });
  it("leaves strings alone: // and /* inside a string, escaped quotes, a comma and a brace in a string", () => {
    expect(value('{"url": "http://example.com/a", "glob": "/* not a comment */", "q": "say \\"hi\\" // no", "s": ",}"}')).toEqual({
      url: "http://example.com/a",
      glob: "/* not a comment */",
      q: 'say "hi" // no',
      s: ",}",
    });
    expect(value('{"a": "x\\\\", "b": 1} // done')).toEqual({ a: "x\\", b: 1 });
  });
  it("skips a byte order mark", () => {
    expect(value('﻿{"a": 1}')).toEqual({ a: 1 });
  });
  it("returns an error for a malformed file and never throws", () => {
    for (const bad of [
      "",
      "{",
      '{"a": }',
      '{"a": 1,, "b": 2}',
      "{'a': 1}",
      '{"a": 1} {"b": 2}',
      '{"a": "unterminated}',
      '{"a": 1 /* never closed }',
      "[1, 2",
      "not json",
      '{"a": undefined}',
      "[".repeat(200_000),
    ]) {
      const r = parseJsonWithComments(bad);
      expect(r.ok, bad.slice(0, 30)).toBe(false);
      if (!r.ok) expect(r.error.length).toBeGreaterThan(0);
    }
  });
  it("never evaluates anything", () => {
    const g = globalThis as { __ran?: boolean };
    g.__ran = false;
    for (const attack of [
      '{"a": (function(){ globalThis.__ran = true })()}',
      '{"a": globalThis.__ran = true}',
      '{"a": 1}; globalThis.__ran = true',
      "globalThis.__ran = true",
      '{"__proto__": {"polluted": true}}',
    ]) {
      parseJsonWithComments(attack);
    }
    expect(g.__ran).toBe(false);
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
    delete g.__ran;
  });
});

// ----------------------------------------------------------------- the importer

describe("importing a VS Code theme", () => {
  it("accepts #rgb, #rgba, #rrggbb and #rrggbbaa, and blends the alpha onto the page colour", () => {
    const r = ok(
      run({
        "editor.background": "#000",
        "sideBar.background": "#101010",
        foreground: "#EEE",
        "panel.border": "#ffffff80",
        "button.background": "#0e639c",
        "textLink.foreground": "#3794ffff",
        "focusBorder": "#fff8",
      })
    );
    const t = r.value.tokens;
    expect(t["ds-background-200"]).toBe("#000000");
    expect(t["ds-background-100"]).toBe("#101010");
    expect(t.foreground).toBe("#eeeeee");
    expect(t.link).toBe("#3794ff");
    // 50% white over a black page; 0x80 is 128/255.
    expect(t["ds-gray-alpha-400"]).toBe("#808080");
    // #fff8 is white at 0x88 = 53%, over black.
    expect(t["ds-focus-color"]).toBe("#888888");
    expect(r.report.blended.sort()).toEqual(["focusBorder", "panel.border"]);
    for (const name of THEME_TOKENS) expect(isHexColor(t[name]), `${name} ${t[name]}`).toBe(true);
  });

  it("blends a see-through page colour onto black (dark) or white (light)", () => {
    expect(ok(run({ "editor.background": "#ffffff80" })).value.tokens["ds-background-200"]).toBe("#808080");
    expect(ok(run({ "editor.background": "#00000080" }, { type: "light" })).value.tokens["ds-background-200"]).toBe("#7f7f7f");
  });

  it("uses a default for a colour given as rgba(), hsl(), var() or a name, and says so", () => {
    const r = ok(
      run({
        "editor.background": "#1e1e1e",
        foreground: "rgba(255, 255, 255, 0.5)",
        "textLink.foreground": "hsl(210 100% 60%)",
        "button.background": "var(--x)",
        "panel.border": "red",
        "focusBorder": "#fff; background: url(//evil.example/x)",
        "editorWarning.foreground": "#12345",
      })
    );
    const t = r.value.tokens;
    // VS Code's own dark default for each one.
    expect(t.foreground).toBe("#cccccc");
    expect(t.link).toBe("#3794ff");
    expect(t.primary).toBe("#0e639c");
    expect(t["ds-focus-color"]).toBe("#007fd4");
    expect(t.warning).toBe("#cca700");
    const unsupported = r.report.defaults.filter((d) => d.why === "unsupported").map((d) => d.key).sort();
    expect(unsupported).toEqual(["button.background", "editorWarning.foreground", "focusBorder", "foreground", "panel.border", "textLink.foreground"]);
    expect(describeDefaults(r.report)).toContain("We used a default for");
    expect(describeDefaults(r.report)).toContain("Text (foreground, not a hex colour)");
    // No raw text from the file reaches a token.
    for (const name of THEME_TOKENS) expect(isHexColor(r.value.tokens[name]), name).toBe(true);
    expect(JSON.stringify(r.value)).not.toMatch(/evil|url\(|rgba|hsl|var\(/);
  });

  it("falls back to the second key when the first is missing or unusable", () => {
    const r = ok(run({ "editor.background": "#101010", "editorWidget.background": "#202020", "editorGroup.border": "#303030", "sideBar.background": "rgb(1,2,3)", "editorError.foreground": "#ff0000" }));
    expect(r.value.tokens["ds-background-100"]).toBe("#202020");
    expect(r.value.tokens["ds-gray-alpha-400"]).toBe("#303030");
    expect(r.value.tokens.destructive).toBe("#ff0000");
    // errorForeground wins when both are there.
    expect(ok(run({ "editor.background": "#101010", errorForeground: "#aa0000", "editorError.foreground": "#ff0000" })).value.tokens.destructive).toBe("#aa0000");
    expect(ok(run({ "editor.background": "#101010", "terminal.ansiGreen": "#00ff00" })).value.tokens.success).toBe("#00ff00");
    expect(ok(run({ "editor.background": "#101010", "gitDecoration.addedResourceForeground": "#00aa00" })).value.tokens.success).toBe("#00aa00");
  });

  it("counts the colours from the file and the defaults, and names the theme", () => {
    const r = ok(run({ "editor.background": "#1e1e1e", foreground: "#d4d4d4", "button.background": "#007acc" }, { name: "  My Night  " }));
    expect(r.report).toMatchObject({ name: "My Night", scheme: "dark", schemeFrom: "type", fromFile: 3, total: 15 });
    expect(r.report.defaults).toHaveLength(12);
    expect(r.value.name).toBe("My Night");
    expect(describeImport(r.report)).toBe('Imported "My Night" as a dark theme. 3 of 15 colours came from the file, 12 are defaults.');
    const full = ok(run(Object.fromEntries(VSCODE_KEYS.map((k) => [k, "#808080"]))));
    expect(full.report.fromFile).toBe(15);
    expect(describeDefaults(full.report)).toBeNull();
    expect(describeImport(full.report)).toContain("15 of 15 colours came from the file.");
  });

  it("names a theme from `label` too, trims control characters, and cuts a long name to 40 characters", () => {
    expect(ok(run({ "editor.background": "#111" }, { name: undefined, label: "From label" })).value.name).toBe("From label");
    expect(ok(run({ "editor.background": "#111" }, { name: "A\u0000B‮C" })).value.name).toBe("ABC");
    expect(ok(run({ "editor.background": "#111" }, { name: "x".repeat(100) })).value.name).toHaveLength(40);
    expect(ok(run({ "editor.background": "#111" }, { name: undefined })).value.name).toBe("VS Code theme");
    expect(ok(run({ "editor.background": "#111" }, { name: 42 })).value.name).toBe("VS Code theme");
  });

  it("reads light and dark from `type`: light and hc-light are light, the rest are dark", () => {
    const scheme = (type: unknown) => ok(run({ "editor.background": "#808080" }, { type })).value.scheme;
    expect(scheme("light")).toBe("light");
    expect(scheme("hc-light")).toBe("light");
    expect(scheme("dark")).toBe("dark");
    expect(scheme("hc-dark")).toBe("dark");
    expect(scheme("hc")).toBe("dark");
    expect(scheme("something else")).toBe("dark");
  });

  it("chooses the scheme from the page colour when there is no type", () => {
    const r = (bg: string) => ok(importVsCodeTheme(JSON.stringify({ colors: { "editor.background": bg } })));
    expect(r("#ffffff").value.scheme).toBe("light");
    expect(r("#fafafa").report.schemeFrom).toBe("background");
    expect(r("#1e1e1e").value.scheme).toBe("dark");
    expect(ok(importVsCodeTheme(JSON.stringify({ colors: { foreground: "#fff" } }))).value.scheme).toBe("dark");
  });

  it("uses the dark defaults for a dark theme and the light defaults for a light one", () => {
    const dark = ok(run({ "editor.background": "#101010" }, { type: "hc-dark" })).value.tokens;
    const light = ok(run({ "editor.background": "#fefefe" }, { type: "hc-light" })).value.tokens;
    expect(dark.foreground).toBe("#cccccc");
    expect(light.foreground).toBe("#616161");
    expect(dark["muted-foreground"]).not.toBe(light["muted-foreground"]);
  });

  it("refuses a file over 256 KB, before reading it", () => {
    const big = `{"colors": {"editor.background": "#000"}, "pad": "${"x".repeat(VSCODE_FILE_MAX_BYTES)}"}`;
    expect(importVsCodeTheme(big)).toEqual({ ok: false, error: "That file is too large for a VS Code theme (256 KB at most)." });
    // The size passed in is what counts, as for a File whose size is known before it is read.
    expect(importVsCodeTheme("{}", VSCODE_FILE_MAX_BYTES + 1).ok).toBe(false);
    expect(importVsCodeTheme(theme({ colors: { "editor.background": "#000" } }), VSCODE_FILE_MAX_BYTES).ok).toBe(true);
    expect(VSCODE_FILE_MAX_BYTES).toBe(256 * 1024);
  });

  it("refuses a file with no colours", () => {
    for (const text of [
      JSON.stringify({ name: "x", type: "dark" }),
      JSON.stringify({ name: "x", colors: {} }),
      JSON.stringify({ name: "x", colors: [] }),
      JSON.stringify({ name: "x", colors: "none" }),
      JSON.stringify({ name: "x", colors: null }),
    ]) {
      const r = importVsCodeTheme(text);
      expect(r.ok, text).toBe(false);
      if (!r.ok) expect(r.error).toMatch(/no colours/);
    }
    // Colours that Egg does not use give nothing to import.
    const r = run({ "editor.foreground": "#fff", "activityBar.background": "#000" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/none of the colours Egg uses/);
  });

  it("refuses a theme that includes another one", () => {
    const message = "This theme extends another theme. Export it as one file first.";
    expect(importVsCodeTheme(JSON.stringify({ include: "./dark_vs.json", tokenColors: [] }))).toEqual({ ok: false, error: message });
    // Even when it has colours of its own: the rest would be missing.
    expect(importVsCodeTheme(JSON.stringify({ include: "./dark_vs.json", colors: { "editor.background": "#000" } }))).toEqual({ ok: false, error: message });
    expect(importVsCodeTheme('{"include": "../other.json", // comment\n "colors": {"foreground": "#fff"},}')).toEqual({ ok: false, error: message });
  });

  it("points an extension's package.json at the theme file it names", () => {
    const r = importVsCodeTheme(JSON.stringify({ name: "ext", contributes: { themes: [{ label: "T", uiTheme: "vs-dark", path: "./themes/t.json" }] } }));
    expect(r).toEqual({ ok: false, error: "That is an extension's package.json. Import the theme file it points to instead." });
  });

  it("refuses malformed files and things that are not a theme", () => {
    for (const text of ["", "{", "[]", "42", '"text"', "null", "<html>"]) {
      const r = importVsCodeTheme(text);
      expect(r.ok, text).toBe(false);
    }
  });

  it("reads a real VS Code file with comments and trailing commas", () => {
    const r = ok(importVsCodeTheme(read("dark_vs.json")));
    expect(r.report.fromFile).toBe(1);
    expect(r.report.name).toBe("Dark (Visual Studio)");
  });

  it("does not trip on __proto__, constructor or prototype keys", () => {
    const text = '{"colors": {"__proto__": "#ffffff", "constructor": "#000", "editor.background": "#101010"}, "__proto__": {"include": "x"}}';
    const r = ok(importVsCodeTheme(text));
    expect(r.value.tokens["ds-background-200"]).toBe("#101010");
    expect(({} as { include?: string }).include).toBeUndefined();
  });

  it("gives a token set and a name the save accepts, with a contrast report", () => {
    const r = ok(importVsCodeTheme(JSON.stringify(flattened("dark_plus.json"))));
    expect(tokenProblem(r.value.tokens)).toBeNull();
    expect(parseThemeInput(r.value).ok).toBe(true);
    expect(checkContrast(r.value.tokens, r.value.scheme).blocking).toEqual([]);
  });

  it("derives the tokens Egg has and VS Code does not (grey steps, tints, status colours) from the mapped ones", () => {
    const { tokens } = tokensFromVsCodeColors({ "editor.background": "#101010" }, "dark");
    expect(Object.keys(tokens).sort()).toEqual([...THEME_TOKENS].sort());
    expect(tokens["ds-gray-100"]).not.toBe(tokens["ds-background-100"]);
  });

  it("flattenHex lets nothing but hex through", () => {
    expect(flattenHex("#abc", [0, 0, 0])).toEqual({ hex: "#aabbcc", blended: false });
    expect(flattenHex("  #ABCDEF ", [0, 0, 0])).toEqual({ hex: "#abcdef", blended: false });
    for (const bad of ["rgb(1,2,3)", "red", "#12", "#12345", "#1234567", "#gggggg", "", "#fff;", "url(#fff)", 5, null, undefined, {}]) {
      expect(flattenHex(bad, [0, 0, 0]), String(bad)).toBeNull();
    }
  });
});
