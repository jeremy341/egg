# Bklit UI area chart (copied in)

Source: https://github.com/bklit/bklit-ui, commit 98c3b20a0498d228be268427138b7660ef1282b5.
Taken from the shadcn registry JSON in `apps/web/public/r/` for `area-chart` and its registry
dependencies (`chart-context`, `chart-animation`, `chart-series`, `grid`, `x-axis`,
`chart-tooltip`, `shimmering-text`, `chart-utils`, `chart-parent-size`). File names are kept;
the registry's `components/charts/` folder is this folder. Licence: MIT, below.

Changes made to the copied files:

- `chart-loading-label.tsx`: import of `shimmering-text` now `./shimmering-text`.
- `lib/utils.ts` was not copied; the files use Egg's own `cn` from `@/lib/utils`.
- `gradients.tsx` was not copied (nothing imports it; it holds preset hex colours).
- `grid-lines.tsx`: default stroke `#eaf0f6` is now `var(--border)`.
- `tooltip/*`, `x-axis.tsx`: Tailwind classes that need Bklit's theme file (`bg-chart-tooltip-background`
  and similar) are written as `bg-(--chart-tooltip-background)`; `bg-zinc-900 text-white` on the date pill
  is `bg-foreground text-background`; the two fixed black and white highlight shadows are one shadow
  mixed from `--foreground`.

## Bar chart, line chart and y axis (added for the analytics page)

Same repository and commit. Taken from the registry JSON for `bar-chart`, `line-chart`, `y-axis` and `patterns`
(`bar-chart` and `line-chart` need `patterns`, `chart-series`, `grid`, `x-axis`, `chart-tooltip` and the rest, which
were already here). Every file that was not already in this folder was added under the same name; the `patterns/`
folder keeps its own sub-folder and its `LICENSE-visx-pattern`. Added files: `bar-chart.tsx`, `bar.tsx`,
`bar-x-axis.tsx`, `bar-y-axis.tsx`, `bar-squares.tsx`, `bar-squares-layout.ts`, `bar-depth-geometry.ts`,
`bar-value-label-layout.ts`, `bar-chart-loading.tsx`, `line-chart.tsx`, `line.tsx`, `line-backdrop.tsx`, `band.tsx`,
`band-geometry.ts`, `use-animated-band.ts`, `bollinger.ts`, `projection-line.tsx`, `projection-line-end-marker.tsx`,
`line-series-terminal-marker.tsx`, `line-chart-loading.tsx`, `y-axis.tsx`, `crosshair-store.ts`,
`reference-area-geometry.ts`, `pattern-preset.tsx`, `pattern-tile.tsx`, `visx-pattern.tsx`, `patterns/*`.

Not copied: the `legend`, `pie-chart`, `ring-chart`, `funnel-chart`, `background` and `gradients` registry items. The
page draws its own small key (text and a swatch) and a funnel as horizontal bars, and no chart needs a donut.

Changes made to those files:

- `bar-x-axis.tsx`, `y-axis.tsx`: `text-chart-label` is written as `text-(--chart-label)`.
- `bar-y-axis.tsx`: `var(--color-zinc-500)` fallback is `var(--muted-foreground)`; a new `labelWidth` prop (default 70,
  as before) sets how wide a category label may be before it is cut, so page paths and error messages are readable.
- `pattern-preset.tsx`: the `accent` preset's fixed `#e879f9` is `var(--primary)`.

The `--chart-*` variables are set to Egg tokens in `../bklit-theme.ts`.

## Egg additions (readings over time, and counts that are bounds)

Made when the charts went from the analytics page to the whole site. Each one is marked "Egg addition" where it
sits in the code, and each is opt-in: a chart that does not pass the new prop draws exactly as before.

- `area.tsx`: a row with no number for a series is a gap. The fill and the stroke stop there and start again at the
  next reading (`defined` on the d3 area and line), instead of dropping to zero. A series with a number in every row
  is unchanged.
- `area-chart.tsx`: new `yDomain` prop, a fixed `[min, max]` for the y axis (the resource charts use `[0, 1]`), and
  new `decimate` prop. Both are passed to the shell; `yDomain` goes in as the shell's existing `yDomainOverrides`.
- `time-series-chart-shell.tsx`: new `decimate` prop, default true. `false` draws every row instead of thinning the
  series to the plot width, so the row that marks a gap is never dropped.
- `tooltip/chart-tooltip.tsx`: no dot for a series that has no value at the hovered row.
- `bar-chart.tsx`: new `valueMax` prop, the top of the value axis from zero. The public stats charts use it so a
  hatched "fewer than 10" stub stays a small share of the plot when no bar is to scale.

Charts are used only through `../bklit-kit.tsx`, which sets the theme variables, turns the entrance animation off
when motion is reduced (the device setting, or the choice in Settings), and gives each chart its text alternative.

`@number-flow/react` is listed by the registry for the tooltip but nothing imports it, so it is not installed.

## Licence

MIT License

Copyright (c) 2026 uixmat

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## Choropleth chart (added for the visitor map)

Source: https://github.com/bklit/bklit-ui, commit a02b9496b0ea4b665bd12f234d75ec2aa87baa5a (the current `main` when
copied; the files above are from the earlier commit). Taken by hand from the registry JSON in `apps/web/public/r/`
for `choropleth-chart` and `background`; no shadcn CLI was run. New files: `choropleth/*` (`choropleth-chart.tsx`,
`choropleth-feature.tsx`, `choropleth-tooltip.tsx`, `choropleth-graticule.tsx`, `choropleth-context.tsx`,
`choropleth-camera.tsx`, `choropleth-projection.ts`, `choropleth-zoom-matrix.ts`, `use-choropleth-zoom-state.ts`,
`choropleth-background.tsx`, `choropleth-dot-grid.tsx`, `choropleth-marker.tsx`, `index.ts`), `chart-scale.ts` and
`background.tsx`. The other registry dependencies (`chart-animation`, `chart-utils`, `chart-tooltip`,
`chart-parent-size`) were already here, so their files were not copied again; the existing `tooltip/cursor-tooltip-box.tsx`
and `tooltip/tooltip-content.tsx` (with the Egg edits above) are the ones the choropleth tooltip uses. Licence: MIT.
It needs `d3-geo`, `topojson-client` (used by Egg to build the shapes), `@types/geojson` and `motion`.

Changes made to those files:

- `choropleth/choropleth-graticule.tsx`: the default stroke `rgba(255,255,255,0.1)` is `var(--chart-grid)`.
- `choropleth/choropleth-dot-grid.tsx` keeps one `rgb()` in its canvas hit test (a unique colour per region, never
  drawn on screen); `bklit-colours.test.ts` exempts that file for that reason. Egg does not use the dot grid.
- The `--chart-scale-01` to `--chart-scale-05` variables the files read are set in `../bklit-theme.ts` as the
  chart colour mixed into the card, so they follow every theme.

The map is used only through `../bklit-map.tsx` (colours from the scale variables, entrance and tooltip springs off when
motion is reduced, zoom off).

## Heatmap, funnel, gauge, sankey, radar, radial and live line charts

Source: https://github.com/bklit/bklit-ui, commit a02b9496b0ea4b665bd12f234d75ec2aa87baa5a (the same commit as the
choropleth). Taken by hand from the registry JSON in `apps/web/public/r/` for `heatmap-chart`, `funnel-chart`,
`gauge-chart` (the docs page calls it Gauge), `sankey-chart`, `radar-chart`, `radial-chart` and `live-line-chart`; no
shadcn CLI was run. The registry's `components/charts/` folder is this folder, with `heatmap/` and `sankey/` as
sub-folders as in the registry. Licence: MIT. Files already here (`chart-scale.ts`, `chart-child-passthrough.ts`,
`local-point.ts`, `pattern-tile.tsx`, `visx-pattern.tsx`, and the Egg-edited `chart-loading-label.tsx` and
`pattern-preset.tsx`) were not copied again; the files this folder shares with the earlier commit (`chart-context`,
`chart-phase`, `animation`, `tooltip/*`, `grid`, `x-axis`, `y-axis` and the rest) were compared with this commit's
registry JSON and differ only by the Egg edits listed above. Registry items not copied: `utils` (Egg's own `cn` is used),
`background`, `legend` and `patterns` (already here or not used), and `radial-legend.tsx` (it needs the `legend` registry
item; the wrapper draws no legend, a radial clock has one series).

New files, by chart:

- Heatmap: `heatmap/` (`heatmap-chart.tsx`, `heatmap-context.tsx`, `heatmap-cells.tsx`, `heatmap-rect-cells.ts`,
  `heatmap-x-axis.tsx`, `heatmap-y-axis.tsx`, `heatmap-legend.tsx`, `heatmap-legend-swatch.tsx`,
  `heatmap-legend-gradient.tsx`, `heatmap-tooltip.tsx`, `heatmap-separator.tsx`, `heatmap-resolve-separator.ts`,
  `heatmap-colors.ts`, `heatmap-utils.ts`, `heatmap-animation.ts`, `heatmap-pattern-defs.tsx`,
  `heatmap-chart-loading.tsx`, `generate-heatmap-skeleton-data.ts`, `index.ts`).
- Funnel: `funnel-chart.tsx`.
- Gauge: `gauge.tsx`, `gauge-dial.tsx`, `gauge-arc-layers.tsx`, `gauge-label-layout.tsx`, `notch-gauge-shared.ts`,
  `pie-context.tsx`, `pie-center-shell.tsx`, `pie-center.tsx`, `chart-stat-flow.tsx`, `chart-center-typography.ts`.
- Sankey: `sankey/` (`sankey-chart.tsx`, `sankey-context.tsx`, `sankey-node.tsx`, `sankey-link.tsx`,
  `sankey-tooltip.tsx`, `index.ts`). Needs `d3-sankey`.
- Radar: `radar-chart.tsx`, `radar-context.tsx`, `radar-area.tsx`, `radar-axis.tsx`, `radar-grid.tsx`, `radar-labels.tsx`.
- Radial: `radial-chart.tsx`, `radial-geometry.ts`, `arc-geometry.ts`, `radial-series-color.ts`, `radial-axis.tsx`,
  `radial-bar.tsx`, `radial-ring-bar.tsx`, `radial-dot-bar.tsx`, `radial-dot-bar-layout.ts`, `radial-line.tsx`,
  `radial-area.tsx`, `radial-scrubber.tsx`, `radial-center.tsx`.
- Live line: `live-line-chart.tsx`, `live-line.tsx`, `live-x-axis.tsx`, `live-y-axis.tsx`.

Changes made to those files (fixed colours and theme-file classes, as before):

- `heatmap/heatmap-colors.ts`: the pattern preset's `#e879f9` is `var(--primary)`; the pattern stroke fallback
  `color-mix(in oklch, ... white)` is `color-mix(in oklab, ... var(--foreground))`.
- `heatmap/heatmap-legend.tsx`, `heatmap-separator.tsx`, `heatmap-x-axis.tsx`, `heatmap-y-axis.tsx`,
  `live-x-axis.tsx`, `live-y-axis.tsx`, `chart-stat-flow.tsx`: `text-chart-label` is `text-(--chart-label)`.
  `heatmap/heatmap-tooltip.tsx`: `text-chart-tooltip-muted` and `text-chart-tooltip-foreground` are written as
  `text-(--chart-tooltip-muted)` and `text-(--chart-tooltip-foreground)`.
- `live-x-axis.tsx`: the time pill's `bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900` is
  `bg-foreground text-background`.
- `gauge-label-layout.tsx`: `text-[length:var(--chart-foreground-muted)]` and `text-[length:var(--chart-foreground)]` set a
  font size from a colour variable, which does nothing; they are now `text-(color:--chart-foreground-muted)` and
  `text-(color:--chart-foreground)`.
- `notch-gauge-shared.ts`: the default gradient `#bef264` to `#10b981` is `var(--chart-1)` to `var(--chart-5)`. It is only
  read when a caller gives its own gradient, which has to be hex for the notch colours to blend; Egg does not.
- `gauge.tsx`: the linear track's `var(--chart-background)` (the card's own colour, so invisible on a card) is `var(--border)`,
  like the arc track.
- `radar-context.tsx`, `sankey/sankey-context.tsx`: the `oklch()` and `hsl()` fallbacks inside `var()` are dropped.
- `funnel-chart.tsx`: the hex colours in a doc comment are written as `var(--chart-*)`. The `var(--color-muted)` band colour
  is an Egg token already.
- `live-line.tsx`, `radial-line.tsx`: keep `stopColor="white"` and `stroke="white"`; both paint an alpha mask that fades the
  line, never anything on screen, so they are not theme colours. `bklit-colours.test.ts` does not read them as colours.

Egg changes that are not colours (each marked "Egg addition" or "Egg change" where it sits, each opt-in unless noted):

- `chart-stat-flow.tsx`: rewritten without `@number-flow/react`; the number is plain text, formatted with `Intl.NumberFormat("en")`
  (the registry used the browser locale, which the server cannot know). Same exports and props. `pie-center-shell.tsx`:
  `animateEntrance` defaults to false, so the middle of a gauge never shows 0 for a moment before the number.
- `use-mount-progress.ts`: a transition with `duration: 0` is "no entrance"; the progress starts at 1 and is not replayed. Used by
  the funnel, radar and sankey wrappers under reduced motion. Any other transition behaves as before.
- `heatmap/heatmap-context.tsx`, `heatmap-cells.tsx`: `HeatmapBin.skip`, a cell with nothing to show: not drawn, no tooltip. This is
  how a day or an hour with no reading stays empty instead of being drawn as 0.
- `heatmap/heatmap-chart.tsx`, `heatmap-colors.ts`, `heatmap-cells.tsx`, `heatmap-legend.tsx`, `heatmap-context.tsx`: `levelOf`,
  which colour level (0 to 4) a count takes. The registry fixes it at 0, 1, 2, 3 and "4 or more", which suits a few
  contributions a day and turns a page-views grid into one colour. The cells, the colour scale and the legend's hover all take it.
- `heatmap/heatmap-x-axis.tsx`: `labels`, one text per column, for a grid whose columns are hours and not weeks.
  `heatmap-tooltip.tsx`: `formatTitle`, the panel's header, for a cell that is a weekday and an hour and not a date.
- `sankey/sankey-node.tsx`: `formatValue` for the number under a node (the registry wrote "N sessions"); the number is what flows into
  the node, or out of it when nothing flows in (the registry used the node's `category`, so a first-column node without one read 0).
  `sankey-tooltip.tsx`: the default row label "Sessions" is "Value". `sankey-link.tsx`: gradient ids carry `useId`, so two charts on
  one page do not share them.
- `radar-grid.tsx`: `formatLevel` for the ring labels (the registry printed the bare 0 to 100 number). The rings also started half a
  step round and ran the other way from the spokes and the values, so each ring was turned against the polygons drawn on it; they now
  start at the top and run clockwise like the spokes.
- `funnel-chart.tsx`: `animateLabels`, false shows the labels at once.

Packages: `d3-sankey` 0.12.3 (BSD-3-Clause) and `@types/d3-sankey` 0.12.5 (MIT). `d3-array`, `d3-scale`, `d3-shape` and `motion`
were already installed. `d3-hierarchy` is not needed (only the sunburst uses it, and it is not copied).

The charts are used only through `../bklit-heatmap.tsx`, `../bklit-funnel.tsx`, `../bklit-gauge.tsx`, `../bklit-sankey.tsx`,
`../bklit-radar.tsx`, `../bklit-radial.tsx` and `../bklit-live-line.tsx`. The plain-data rules they share (turning days into weeks,
checking flows for a loop, finding the reading nearest to the pointer, the text alternatives) are in `../bklit-heatmap-data.ts` and
`../bklit-chart-data.ts`, which a server component can import.
