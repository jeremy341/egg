import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { bklitTokens } from "./bklit-theme";

const charts = __dirname;
const components = path.resolve(charts, "..");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

/** Source with comments removed: an issue number such as (#226) is not a colour. */
function code(file: string): string {
  return readFileSync(file, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|\s)\/\/.*$/gm, "$1");
}

const isSource = (f: string) => /\.(ts|tsx|css)$/.test(f) && !/\.test\./.test(f);

const app = path.resolve(components, "../app");

// The copied Bklit files, the kit, and every file that puts a chart on a page.
const files = [
  ...walk(path.join(charts, "bklit")).filter(isSource),
  path.join(charts, "bklit-theme.ts"),
  path.join(charts, "bklit-visits.ts"),
  path.join(charts, "bklit-summaries.ts"),
  path.join(charts, "bklit-time.ts"),
  path.join(charts, "bklit-kit.tsx"),
  path.join(charts, "bklit-map.tsx"),
  // The wrappers added with the heatmap, funnel, gauge, sankey, radar, radial and live line charts, and the data rules they use.
  ...[
    "bklit-heatmap.tsx",
    "bklit-heatmap-data.ts",
    "bklit-funnel.tsx",
    "bklit-gauge.tsx",
    "bklit-sankey.tsx",
    "bklit-radar.tsx",
    "bklit-radial.tsx",
    "bklit-live-line.tsx",
    "bklit-chart-data.ts",
  ].map((name) => path.join(charts, name)),
  path.join(components, "analytics-bklit-cards.tsx"),
  path.join(components, "analytics-live.tsx"),
  path.join(components, "resource-chart.tsx"),
  path.join(components, "resource-trend.tsx"),
  path.join(components, "project-resources.tsx"),
  path.join(app, "(marketing)/stats/_components/stats-chart.tsx"),
  path.join(app, "(marketing)/stats/_components/stats-shape-charts.tsx"),
  path.join(app, "(marketing)/stats/_components/runtime-bar.tsx"),
];

// #rgb, #rgba, #rrggbb, #rrggbbaa, not preceded by a word character (so "&#39;" and ids are not hit).
const hex = /(?<![\w&])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})\b/g;
const functional = /\b(?:rgba?|hsla?|hwb|lab|lch)\(/g;

describe("Bklit chart colours", () => {
  it("finds the files to check", () => {
    expect(files.length).toBeGreaterThan(60);
  });

  it("has no hex colour in any of the chart files", () => {
    const found = files.flatMap((f) =>
      [...code(f).matchAll(hex)].map((m) => `${path.relative(components, f)}: ${m[0]}`),
    );
    expect(found).toEqual([]);
  });

  it("has no rgb(), hsl() or similar colour function in any of the chart files", () => {
    // The map's hit-test canvas paints each region in a unique rgb() to find it under the pointer; it is
    // never on screen.
    const found = files.filter((f) => !f.endsWith("choropleth-dot-grid.tsx")).flatMap((f) =>
      [...code(f).matchAll(functional)].map((m) => `${path.relative(components, f)}: ${m[0]}`),
    );
    expect(found).toEqual([]);
  });

  it("has no fixed Tailwind palette colour (zinc, white, black and so on)", () => {
    const palette = /\b(?:bg|text|border|fill|stroke|from|to|via|ring|shadow)-(?:white|black|(?:zinc|slate|gray|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3})\b/g;
    const found = files.flatMap((f) =>
      [...code(f).matchAll(palette)].map((m) => `${path.relative(components, f)}: ${m[0]}`),
    );
    expect(found).toEqual([]);
  });

  it("maps every chart variable to an Egg token and nothing else", () => {
    const allowed = new Set([
      "--primary",
      "--primary-foreground",
      "--muted-foreground",
      "--border",
      "--card",
      "--foreground",
      "--ds-gray-700",
      // The status tokens behind a gauge's good, warning and bad ranges.
      "--success",
      "--warning",
      "--destructive",
    ]);
    for (const [name, value] of Object.entries(bklitTokens)) {
      // The sequential scale of maps is the chart colour mixed into the card, still only Egg tokens.
      if (/^--chart-scale-0\d$/.test(name)) {
        expect(value, name).toMatch(/^color-mix\(in oklab, var\(--primary\) \d+%, var\(--card\)\)$/);
        continue;
      }
      // A heatmap cell with nothing in it: the muted colour mixed into the card.
      if (name === "--chart-heat-0") {
        expect(value, name).toMatch(/^color-mix\(in oklab, var\(--muted-foreground\) \d+%, var\(--card\)\)$/);
        continue;
      }
      const m = /^var\((--[a-z0-9-]+)\)$/.exec(value);
      expect(m, `${name} must be a single var()`).not.toBeNull();
      expect(allowed.has(m![1]), `${name} uses ${m![1]}`).toBe(true);
    }
  });

  it("defines every --chart-* variable the copied files read", () => {
    const used = new Set<string>();
    for (const f of files.filter((f) => f.includes(`${path.sep}bklit${path.sep}`))) {
      for (const m of code(f).matchAll(/var\((--chart-[a-z0-9-]+)/g)) used.add(m[1]);
    }
    const missing = [...used].filter((v) => !(v in bklitTokens));
    expect(missing).toEqual([]);
  });

  it("defines every --chart-* variable the wrappers and their data rules read", () => {
    const used = new Set<string>();
    for (const f of files.filter((f) => !f.includes(`${path.sep}bklit${path.sep}`) && path.dirname(f) === charts)) {
      for (const m of code(f).matchAll(/var\((--chart-[a-z0-9-]+)/g)) used.add(m[1]);
    }
    expect(used.size).toBeGreaterThan(5);
    expect([...used].filter((v) => !(v in bklitTokens))).toEqual([]);
  });

  it("keeps the Tailwind classes that need Bklit's own theme file out of the copied files", () => {
    // text-chart-label and friends only exist in Bklit's theme CSS; Egg writes them as text-(--chart-label).
    const found = files
      .filter((f) => f.includes(`${path.sep}bklit${path.sep}`))
      .flatMap((f) =>
        [...code(f).matchAll(/\b(?:bg|text|fill|stroke|border|ring|shadow)-chart-[a-z-]+/g)].map((m) => `${path.relative(components, f)}: ${m[0]}`),
      );
    expect(found).toEqual([]);
  });
});
