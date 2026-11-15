import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const src = path.resolve(__dirname, "../../../../..");

/** The file a path points at, trying the extensions a TypeScript import leaves out. */
function withExtension(base: string): string | null {
  for (const ext of [".tsx", ".ts", `${path.sep}index.ts`, `${path.sep}index.tsx`]) {
    if (existsSync(base + ext)) return base + ext;
  }
  return null;
}

const importsOf = (file: string) =>
  [...readFileSync(file, "utf8").matchAll(/(?:import|export)\s[^;]*?from\s+"([^"]+)"/g)].map((m) => m[1]);

/** Every local file reachable from the entry files, and every package they import. */
function reach(entries: string[]) {
  const seen = new Set<string>();
  const packages = new Set<string>();
  const queue = [...entries];
  while (queue.length) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    for (const spec of importsOf(file)) {
      const base = spec.startsWith("@/") ? path.join(src, spec.slice(2)) : spec.startsWith(".") ? path.resolve(path.dirname(file), spec) : null;
      if (base === null) {
        packages.add(spec);
        continue;
      }
      const local = withExtension(base);
      if (local) queue.push(local);
    }
  }
  const files = [...seen].map((f) => path.relative(src, f).split(path.sep).join("/"));
  return { files, packages: [...packages] };
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

/** The files outside the copied Bklit folder that put a chart on a page. Each draws through the kit and nothing else. */
const CHART_FILES = [
  "components/analytics-bklit-cards.tsx",
  "components/charts/bklit-kit.tsx",
  "components/resource-chart.tsx",
  "components/project-resources.tsx",
  "components/resource-trend.tsx",
  "app/(marketing)/stats/_components/stats-chart.tsx",
  "app/(marketing)/stats/_components/stats-shape-charts.tsx",
  "app/(marketing)/stats/_components/runtime-bar.tsx",
];

/** The wrappers for the charts added after the first set. Each one is the only way a page reaches its Bklit chart. */
const ADDED_WRAPPERS = [
  "components/charts/bklit-heatmap.tsx",
  "components/charts/bklit-funnel.tsx",
  "components/charts/bklit-gauge.tsx",
  "components/charts/bklit-sankey.tsx",
  "components/charts/bklit-radar.tsx",
  "components/charts/bklit-radial.tsx",
  "components/charts/bklit-live-line.tsx",
];

describe("the analytics page draws every chart with Bklit UI", () => {
  const view = path.join(src, "components/analytics-view.tsx");
  const { files, packages } = reach([path.join(src, "app/(app)/projects/[slug]/analytics/page.tsx")]);

  it("builds the page from the Bklit cards", () => {
    expect(readFileSync(view, "utf8")).toContain('from "@/components/analytics-bklit-cards"');
    expect(files).toContain("components/analytics-bklit-cards.tsx");
    expect(files).toContain("components/charts/bklit-kit.tsx");
  });

  it("has one version only: the preview route, its banner and the hand-built kit are gone", () => {
    for (const gone of [
      "app/(app)/projects/[slug]/analytics-bklit",
      "components/charts/bklit-preview-banner.tsx",
      "components/analytics-kit.ts",
      "components/analytics-kit-bklit.tsx",
      "components/analytics-kit-original.tsx",
      "components/analytics-chart.tsx",
      "components/analytics-top-list.tsx",
      "components/analytics-insights.tsx",
      "components/analytics-more.tsx",
      "components/analytics-numbers.tsx",
    ]) {
      expect(existsSync(path.join(src, gone)), gone).toBe(false);
    }
  });

  it("imports no chart library besides the d3 pieces Bklit itself uses (d3-geo draws the visitor map)", () => {
    const chartLibs = /recharts|chart\.?js|victory|visx|nivo|echarts|apexcharts|plotly|highcharts|uplot|lightweight-charts/i;
    expect(packages.filter((p) => chartLibs.test(p))).toEqual([]);
    // d3-sankey lays out the flow chart and sits behind the sankey wrapper only.
    expect(packages.filter((p) => p.startsWith("d3-")).sort()).toEqual(
      ["d3-array", "d3-geo", "d3-sankey", "d3-scale", "d3-shape"].filter((p) => packages.includes(p))
    );
  });

  it("has the bar, line, area and axis components copied in", () => {
    for (const f of ["bar-chart.tsx", "bar.tsx", "line-chart.tsx", "line.tsx", "area-chart.tsx", "y-axis.tsx", "bar-y-axis.tsx"]) {
      expect(existsSync(path.join(src, "components/charts/bklit", f)), f).toBe(true);
    }
  });
});

describe("every chart in Egg is a Bklit UI chart", () => {
  it("draws only through Bklit components, never an svg or canvas of its own", () => {
    for (const file of CHART_FILES) {
      const source = readFileSync(path.join(src, file), "utf8");
      expect(source, file).not.toMatch(/<svg|<canvas|<rect|<polyline|<polygon|<path/);
    }
    const kitSource = readFileSync(path.join(src, "components/charts/bklit-kit.tsx"), "utf8");
    for (const name of ["AreaChart", "BarChart", "LineChart", "BarXAxis", "BarYAxis", "ChartTooltip"]) {
      expect(kitSource).toContain(`<${name}`);
    }
    const imports = importsOf(path.join(src, "components/charts/bklit-kit.tsx")).filter((s) => s.startsWith("@/components/charts/"));
    expect(imports.length).toBeGreaterThan(8);
    for (const spec of imports) expect(spec).toMatch(/^@\/components\/charts\/(bklit\/|bklit-)/);
  });

  it("reaches the copied Bklit files only through the kit, so every chart gets the theme and the motion rule", () => {
    const sources = [...walk(path.join(src, "app")), ...walk(path.join(src, "components"))].filter(
      (f) => /\.tsx?$/.test(f) && !/\.test\./.test(f) && !f.includes(`${path.sep}charts${path.sep}`)
    );
    const direct = sources.filter((f) => importsOf(f).some((spec) => spec.startsWith("@/components/charts/bklit/")));
    expect(direct.map((f) => path.relative(src, f))).toEqual([]);
  });

  it("has no hand-drawn chart left: the old sparkline is gone", () => {
    expect(existsSync(path.join(src, "components/sparkline.tsx"))).toBe(false);
    for (const file of CHART_FILES.filter((f) => !f.includes("charts/"))) {
      expect(readFileSync(path.join(src, file), "utf8"), file).toMatch(/from "@\/components\/charts\/bklit-kit"/);
    }
  });

  it("turns the entrance animation off when motion is reduced", () => {
    const kitSource = readFileSync(path.join(src, "components/charts/bklit-kit.tsx"), "utf8");
    expect(kitSource).toContain("prefers-reduced-motion: reduce");
    expect(kitSource).toContain('"data-motion"');
    // Each of the four chart roots takes the duration from the motion rule.
    expect(kitSource.match(/animationDuration=\{/g)).toHaveLength(4);
    expect(kitSource).toContain("animate={!reduced}");
  });
});

describe("the heatmap, funnel, gauge, sankey, radar, radial and live line charts", () => {
  const chartLibs = /recharts|chart\.?js|victory|visx|nivo|echarts|apexcharts|plotly|highcharts|uplot|lightweight-charts/i;

  it("have a wrapper each, and a copied Bklit component behind it", () => {
    for (const file of ADDED_WRAPPERS) expect(existsSync(path.join(src, file)), file).toBe(true);
    for (const dir of ["heatmap", "sankey"]) expect(existsSync(path.join(src, "components/charts/bklit", dir, "index.ts")), dir).toBe(true);
    for (const f of ["funnel-chart.tsx", "gauge.tsx", "radar-chart.tsx", "radial-chart.tsx", "live-line-chart.tsx"]) {
      expect(existsSync(path.join(src, "components/charts/bklit", f)), f).toBe(true);
    }
  });

  it("draw only through Bklit components, never an svg or canvas of their own, and fetch nothing", () => {
    for (const file of ADDED_WRAPPERS) {
      const source = readFileSync(path.join(src, file), "utf8");
      expect(source, file).not.toMatch(/<svg|<canvas|<rect|<polyline|<polygon|<path|<line\b|<circle/);
      expect(source, file).not.toMatch(/\bfetch\(|XMLHttpRequest|WebSocket|EventSource/);
      const imports = importsOf(path.join(src, file));
      expect(imports.some((spec) => spec.startsWith("@/components/charts/bklit/")), file).toBe(true);
      expect(imports.filter((spec) => chartLibs.test(spec)), file).toEqual([]);
    }
  });

  it("set the theme variables, are client components and stand still when motion is reduced", () => {
    for (const file of ADDED_WRAPPERS) {
      const source = readFileSync(path.join(src, file), "utf8");
      expect(source.startsWith('"use client";'), file).toBe(true);
      expect(source, file).toContain("bklitThemeStyle");
      expect(source, file).toContain("useReducedChartMotion");
      expect(source, file).toContain('reducedMotion={reduced ? "always" : "never"}');
    }
  });

  it("stop their own entrance animation, each in the way that chart allows", () => {
    const read = (f: string) => readFileSync(path.join(src, "components/charts", f), "utf8");
    expect(read("bklit-heatmap.tsx")).toContain("animate={!reduced}");
    expect(read("bklit-heatmap.tsx")).toContain("instant={reduced}");
    expect(read("bklit-funnel.tsx")).toContain("animateLabels={!reduced}");
    expect(read("bklit-gauge.tsx")).toContain("geometryScrubbing={reduced}");
    expect(read("bklit-sankey.tsx")).toContain("animationDuration={reduced ? 0 : undefined}");
    expect(read("bklit-radar.tsx")).toContain("animate={!reduced}");
    expect(read("bklit-radial.tsx")).toContain("animate={!reduced}");
    // The live line does not scroll when motion is reduced.
    expect(read("bklit-live-line.tsx")).toContain("paused={paused || reduced}");
  });

  it("are reached by pages only through their wrapper", () => {
    const sources = [...walk(path.join(src, "app")), ...walk(path.join(src, "components"))].filter(
      (f) => /\.tsx?$/.test(f) && !/\.test\./.test(f) && !f.includes(`${path.sep}charts${path.sep}`)
    );
    const direct = sources.filter((f) =>
      importsOf(f).some((spec) => /^@\/components\/charts\/bklit\/(heatmap|sankey|funnel-chart|gauge|radar-|radial-|live-)/.test(spec))
    );
    expect(direct.map((f) => path.relative(src, f))).toEqual([]);
  });
});
