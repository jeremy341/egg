"use client";

import { useId, useMemo, useSyncExternalStore, type ReactNode } from "react";
import { curveMonotoneX } from "d3-shape";
import { MotionConfig } from "motion/react";
import { ExportMenu, type ExportTarget } from "@/components/analytics-export-menu";
import { Area, AreaChart } from "@/components/charts/bklit/area-chart";
import { Bar } from "@/components/charts/bklit/bar";
import { BarChart } from "@/components/charts/bklit/bar-chart";
import { BarXAxis } from "@/components/charts/bklit/bar-x-axis";
import { BarYAxis } from "@/components/charts/bklit/bar-y-axis";
import { Grid } from "@/components/charts/bklit/grid";
import { Line, LineChart } from "@/components/charts/bklit/line-chart";
import { PatternPreset } from "@/components/charts/bklit/pattern-preset";
import { ChartTooltip } from "@/components/charts/bklit/tooltip";
import { XAxis } from "@/components/charts/bklit/x-axis";
import { YAxis } from "@/components/charts/bklit/y-axis";
import { bklitThemeStyle } from "@/components/charts/bklit-theme";
import { withGaps, type TimePoint } from "@/components/charts/bklit-time";
import { formatDay } from "@/components/charts/bklit-visits";
import { number } from "@/components/charts/bklit-summaries";
import { cn } from "@/lib/utils";

/**
 * The frame and the drawing pieces every Bklit chart in Egg is built from.
 *
 * `ChartFrame` gives a chart a visible title, a one-sentence summary, an Export menu and a data
 * table of the same numbers. The table is visually hidden, but it is reachable by keyboard: it is
 * a focusable region, and while it has focus it is shown. `BklitSeries` draws values per day as
 * areas and lines; `BklitBars` draws categories as bars; `BklitTimeSeries` draws readings over
 * time and leaves a gap where there were none. None of them sorts, sums or fills in data.
 *
 * Every chart takes its colours from the `--chart-*` variables set by `bklitThemeStyle`, so it
 * follows the active theme, and none of them plays its entrance when motion is reduced.
 */

export type Table = { caption: string; headers: string[]; rows: (string | number)[][] };

export type SeriesSpec = {
  key: string;
  label: string;
  color: string;
  /** Draw the series hatched instead of solid, for a value that is a bound and not a count. */
  hatched?: boolean;
};

/** The first series of a chart. */
export const CHART_PRIMARY = "var(--chart-line-primary)";
/** The second series of a chart that has two. */
export const CHART_SECOND = "var(--chart-series-2)";

// ------------------------------------------------------------ motion

function subscribeToMotion(onChange: () => void) {
  const query = window.matchMedia("(prefers-reduced-motion: reduce)");
  query.addEventListener("change", onChange);
  // Settings > Preferences can override the device with data-motion on <html>.
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-motion"] });
  return () => {
    query.removeEventListener("change", onChange);
    observer.disconnect();
  };
}

function motionIsReduced() {
  const choice = document.documentElement.getAttribute("data-motion");
  if (choice === "reduce") return true;
  if (choice === "no-preference") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * True when charts should not animate: the same rule as the CSS in globals.css. The Settings
 * choice wins, otherwise the device decides. The charts draw only in the browser, after they
 * have measured their box, so the server's answer (false) is never seen as an animation.
 */
export function useReducedChartMotion(): boolean {
  return useSyncExternalStore(subscribeToMotion, motionIsReduced, () => false);
}

/** Wraps a chart so its entrance, its hover springs and its tooltip all stand still when motion is reduced. */
function ChartMotion({ reduced, children }: { reduced: boolean; children: ReactNode }) {
  return <MotionConfig reducedMotion={reduced ? "always" : "never"}>{children}</MotionConfig>;
}

// ------------------------------------------------------------ frame

/** The text and numbers of a chart, readable without seeing it. */
export function DataTable({ table, label }: { table: Table; label: string }) {
  return (
    <div className="sr-only focus-within:not-sr-only focus-within:mt-3">
      <div
        tabIndex={0}
        role="region"
        aria-label={`Data table for ${label}`}
        className="max-h-64 overflow-auto rounded-md outline-offset-2"
      >
        <table className="w-full text-left text-label">
          <caption className="px-2 py-1 text-left text-caption text-muted-foreground">{table.caption}</caption>
          <thead>
            <tr className="border-b text-label text-muted-foreground">
              {table.headers.map((h) => (
                <th key={h} scope="col" className="px-2 py-1.5 font-normal">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {table.rows.map((row, i) => (
              <tr key={i}>
                {row.map((cell, j) =>
                  j === 0 ? (
                    <th key={j} scope="row" className="px-2 py-1.5 font-normal">
                      {cell}
                    </th>
                  ) : (
                    <td key={j} className="tabular px-2 py-1.5">
                      {cell}
                    </td>
                  )
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** A small key for charts with more than one series, so colour is never the only label. */
export function Legend({ series, className }: { series: readonly SeriesSpec[]; className?: string }) {
  return (
    <ul className={cn("mt-2 flex flex-wrap gap-x-4 gap-y-1 text-caption text-muted-foreground", className)}>
      {series.map((s) => (
        <li key={s.key} className="flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className={cn("size-2 shrink-0 rounded-full", s.hatched && "rounded-none border border-dashed")}
            style={s.hatched ? { borderColor: s.color } : { background: s.color }}
          />
          {s.label}
        </li>
      ))}
    </ul>
  );
}

export function ChartFrame({
  title,
  level = 2,
  summary,
  chartLabel,
  empty,
  table,
  exportTarget,
  legend,
  note,
  children,
}: {
  title: string;
  /** 2 for a card of its own, 3 for a chart inside another card. */
  level?: 2 | 3;
  summary: string;
  /** What the picture is, for a screen reader: "Area chart of page views for each of the last 30 days". */
  chartLabel: string;
  /** When set, the chart and the table are left out and this is said instead. */
  empty?: string | null;
  table: Table;
  exportTarget?: ExportTarget;
  legend?: readonly SeriesSpec[];
  /** A footnote under the chart: what is counted, or how it is stored. */
  note?: ReactNode;
  /** The chart. Left out (null) when there is too little to draw, such as one day. */
  children: ReactNode;
}) {
  const summaryId = useId();
  const card = level === 2;
  const Heading = card ? "h2" : "h3";
  const body = empty ? null : (
    <>
      {children ? (
        <div role="img" aria-label={chartLabel} aria-describedby={summaryId}>
          {children}
        </div>
      ) : null}
      {legend && legend.length > 1 ? <Legend series={legend} /> : null}
      <DataTable table={table} label={title} />
    </>
  );
  return (
    <section
      aria-label={title}
      // No overflow-hidden: the tooltip and the date pill may reach past the plot at its edges.
      className={card ? "rounded-lg bg-card shadow-border-small" : undefined}
      style={bklitThemeStyle}
    >
      <div className={cn("flex items-start justify-between gap-3", card ? "px-4 py-3" : "mb-3", card && body && "border-b")}>
        <div className="min-w-0">
          <Heading className={card ? "text-title-3" : "text-label font-medium"}>{title}</Heading>
          <p id={summaryId} className="tabular mt-0.5 text-label text-muted-foreground">
            {empty ?? summary}
          </p>
        </div>
        {exportTarget && !empty ? <ExportMenu target={exportTarget} label={title} /> : null}
      </div>
      {body ? card ? <div className="p-4">{body}</div> : body : null}
      {note ? (
        <p className={cn("text-caption text-muted-foreground", card ? "border-t px-4 py-3" : "mt-3")}>{note}</p>
      ) : null}
    </section>
  );
}

// ------------------------------------------------------------ per day

export type DayRow = { day: string } & Record<string, number | string>;

/**
 * Values per UTC day. Areas are drawn first, lines on top, all on the same axes. With no area it
 * is a plain line chart. The y axis starts at zero for areas; a line chart lets it fit the values.
 */
export function BklitSeries({
  rows,
  area,
  line,
  height = 176,
  formatValue = (n) => number.format(n),
}: {
  rows: readonly DayRow[];
  area: readonly SeriesSpec[];
  line: readonly SeriesSpec[];
  height?: number;
  formatValue?: (n: number) => string;
}) {
  const reduced = useReducedChartMotion();
  const data = useMemo(() => rows.map((r) => ({ ...r, date: new Date(`${r.day}T00:00:00Z`) })), [rows]);
  const labels = useMemo(() => rows.map((r) => formatDay(r.day)), [rows]);
  const all = [...area, ...line];
  const margin = { top: 12, right: 12, bottom: 40, left: 58 };
  const duration = reduced ? 0 : undefined;
  const tooltip = (
    <ChartTooltip
      dateLabels={labels}
      rows={(point) =>
        all.map((s) => ({ color: s.color, label: s.label, value: formatValue(Number(point[s.key])) }))
      }
    />
  );
  const lines = line.map((s) => (
    <Line key={s.key} dataKey={s.key} stroke={s.color} strokeWidth={2} curve={curveMonotoneX} fadeEdges={false} />
  ));
  return (
    <ChartMotion reduced={reduced}>
      <div style={{ height }}>
        {area.length > 0 ? (
          <AreaChart data={data} margin={margin} aspectRatio="auto" className="h-full" animationDuration={duration}>
            <Grid horizontal />
            {area.map((s) => (
              <Area key={s.key} dataKey={s.key} fill={s.color} fillOpacity={0.25} curve={curveMonotoneX} />
            ))}
            {lines}
            <XAxis labels={labels} />
            <YAxis formatValue={formatValue} />
            {tooltip}
          </AreaChart>
        ) : (
          <LineChart data={data} margin={margin} aspectRatio="auto" className="h-full" animationDuration={duration}>
            <Grid horizontal />
            {lines}
            <XAxis labels={labels} />
            <YAxis formatValue={formatValue} />
            {tooltip}
          </LineChart>
        )}
      </div>
    </ChartMotion>
  );
}

// ------------------------------------------------------------ readings over time

const HOUR = 3_600_000;
// The interface is in English, so the words are too; only the time zone is the reader's own.
const clock = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit" });
const weekday = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric" });
const moment = new Intl.DateTimeFormat("en-GB", { weekday: "short", hour: "2-digit", minute: "2-digit" });

/** "Mon 14:05" in the reader's own time zone. */
export function formatMoment(at: number): string {
  return moment.format(at);
}

/**
 * One measurement over time, as an area under a line. The x axis is real time, so readings that
 * are further apart sit further apart, and a stretch with no readings is a break in the line.
 *
 * `compact` is the small trend line for a table row: no axes, no grid and no tooltip, so it needs
 * words beside it. The times are shown in the reader's own time zone; the chart draws only in the
 * browser, so the server never has to guess one.
 */
export function BklitTimeSeries({
  points,
  label,
  color = CHART_PRIMARY,
  height = 160,
  domain,
  ticks = 4,
  axisWidth = 46,
  compact = false,
  formatValue = (n) => number.format(n),
}: {
  points: readonly TimePoint[];
  /** The series name in the tooltip, such as "Memory". */
  label: string;
  color?: string;
  height?: number;
  /** A fixed y axis, such as [0, 1] for a share of a limit. Left out, the axis fits the readings from zero. */
  domain?: [number, number];
  /** About how many steps the y axis and its grid lines show. */
  ticks?: number;
  /** Room for the y axis labels, in pixels: wider for "200 MB" than for "50%". */
  axisWidth?: number;
  compact?: boolean;
  formatValue?: (n: number) => string;
}) {
  const reduced = useReducedChartMotion();
  const rows = useMemo(() => withGaps(points), [points]);
  // The shaded gap reaches the top of the axis: the fixed domain's top, or the highest reading.
  const bandTop = useMemo(() => domain?.[1] ?? Math.max(0, ...points.flatMap((p) => (p.value === null ? [] : [p.value]))), [domain, points]);
  const data = useMemo(
    () => rows.map((r) => ({ date: new Date(r.at), value: r.value, band: r.band === null ? null : bandTop })),
    [rows, bandTop]
  );
  const span = rows.length > 1 ? rows[rows.length - 1].at - rows[0].at : 0;
  // The axis names times within a day, days over several, and both in between: a full day starts
  // and ends at the same time of day, and two ticks must never read the same.
  const axisLabels = useMemo(() => {
    const format = span > 36 * HOUR ? weekday : span > 20 * HOUR ? moment : clock;
    return rows.map((r) => format.format(r.at));
  }, [rows, span]);
  const tipLabels = useMemo(() => rows.map((r) => moment.format(r.at)), [rows]);
  const margin = compact ? { top: 3, right: 1, bottom: 3, left: 1 } : { top: 12, right: 12, bottom: 36, left: axisWidth };
  return (
    <ChartMotion reduced={reduced}>
      <div style={{ height }}>
        <AreaChart
          data={data}
          margin={margin}
          aspectRatio="auto"
          className="h-full"
          animationDuration={reduced || compact ? 0 : undefined}
          yDomain={domain}
          decimate={false}
        >
          {compact ? null : <Grid horizontal numTicksRows={ticks} />}
          {compact ? null : (
            <Area dataKey="band" fill="var(--muted-foreground)" fillOpacity={0.07} strokeWidth={0} curve={curveMonotoneX} showHighlight={false} />
          )}
          <Area
            dataKey="value"
            fill={color}
            fillOpacity={compact ? 0.12 : 0.2}
            strokeWidth={compact ? 1.5 : 2}
            curve={curveMonotoneX}
            showHighlight={false}
          />
          {compact ? null : <XAxis labels={axisLabels} numTicks={4} />}
          {compact ? null : <YAxis formatValue={formatValue} numTicks={ticks} />}
          {compact ? null : (
            <ChartTooltip
              dateLabels={tipLabels}
              rows={(point) => [
                {
                  color,
                  label,
                  value: typeof point.value === "number" ? formatValue(point.value) : "No reading",
                },
              ]}
            />
          )}
        </AreaChart>
      </div>
    </ChartMotion>
  );
}

// ------------------------------------------------------------ categories

export type BarRow = {
  /** The category, drawn on the axis. Long text is cut on the axis; the table and tooltip keep it whole. */
  label: string;
  /** A null value draws no bar and no tooltip dot for that series. */
  values: Record<string, number | null>;
  /** Overrides the tooltip's number for a series, such as "310 reports (75%)". */
  tip?: Partial<Record<string, string>>;
};

/** Categories as bars, vertical or horizontal, one colour per series, stacked when asked. */
export function BklitBars({
  rows,
  series,
  orientation = "vertical",
  stacked = false,
  height,
  labelWidth = 112,
  maxLabels = 8,
  barWidth,
  showValues = true,
  valueAxis = true,
  valueMax,
  formatValue = (n) => number.format(n),
}: {
  rows: readonly BarRow[];
  series: readonly SeriesSpec[];
  orientation?: "vertical" | "horizontal";
  stacked?: boolean;
  height?: number;
  labelWidth?: number;
  maxLabels?: number;
  /** A fixed bar width in pixels, for a chart with only a few bars. */
  barWidth?: number;
  /** Write the number inside each bar. Off for a dense stacked chart. */
  showValues?: boolean;
  /** Draw the value axis and its grid lines. Off when a series is not to scale, so no height can be read off it. */
  valueAxis?: boolean;
  /** The top of the value axis, from zero. Left out, the axis fits the bars. */
  valueMax?: number;
  formatValue?: (n: number) => string;
}) {
  const reduced = useReducedChartMotion();
  const patternBase = useId().replace(/:/g, "");
  const horizontal = orientation === "horizontal";
  const data = useMemo(() => rows.map((r) => ({ name: r.label, ...r.values })), [rows]);
  const h = height ?? (horizontal ? Math.max(120, rows.length * 30 + 28) : 176);
  const margin = horizontal
    ? { top: 8, right: 16, bottom: 20, left: labelWidth + 8 }
    : { top: 12, right: 12, bottom: 40, left: valueAxis ? 52 : 12 };
  return (
    <ChartMotion reduced={reduced}>
      <div style={{ height: h }}>
        <BarChart
          data={data}
          xDataKey="name"
          margin={margin}
          aspectRatio="auto"
          className="h-full"
          orientation={orientation}
          stacked={stacked}
          barGap={horizontal ? 0.3 : 0.25}
          barWidth={barWidth}
          valueMax={valueMax}
          animationDuration={reduced ? 0 : undefined}
        >
          {series
            .filter((s) => s.hatched)
            .map((s) => (
              <PatternPreset key={`pattern-${s.key}`} id={`${patternBase}-${s.key}`} preset="diagonal-up" color={s.color} />
            ))}
          {valueAxis ? (
            <Grid horizontal={!horizontal} vertical={horizontal} numTicksRows={4} numTicksColumns={4} />
          ) : null}
          {series.map((s) => (
            <Bar
              key={s.key}
              dataKey={s.key}
              fill={s.hatched ? `url(#${patternBase}-${s.key})` : s.color}
              stroke={s.color}
              lineCap={3}
              animate={!reduced}
              showValue={showValues && !s.hatched}
              valueLabelFormatter={formatValue}
              valueLabelColor="var(--background)"
              valueLabelPosition={horizontal ? "top" : undefined}
            />
          ))}
          {horizontal ? <BarYAxis maxLabels={rows.length} labelWidth={labelWidth} /> : <BarXAxis maxLabels={maxLabels} />}
          {horizontal || !valueAxis ? null : <YAxis formatValue={formatValue} />}
          <ChartTooltip
            rows={(point) => {
              const row = rows.find((r) => r.label === point.name);
              return series
                .filter(
                  (s) => !stacked || series.length === 1 || Number(point[s.key]) > 0 || row?.tip?.[s.key] !== undefined
                )
                .map((s) => ({
                  color: s.color,
                  label: s.label,
                  value: row?.tip?.[s.key] ?? formatValue(Number(point[s.key])),
                }));
            }}
          />
        </BarChart>
      </div>
    </ChartMotion>
  );
}
