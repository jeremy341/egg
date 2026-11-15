import type { Table } from "@/components/charts/bklit-kit";

/**
 * The plain-data rules behind the funnel, gauge, sankey, radar, radial and live-line wrappers, kept
 * apart from the components so a page (a server component) can build the text alternative with
 * them and a test can check them without a browser. Nothing here sorts, adds up, smooths or fills
 * in a number the caller did not give; where an input cannot be drawn truthfully it says so
 * (`...Problem` returns a sentence) and the wrapper draws nothing instead.
 */

const number = new Intl.NumberFormat("en");
const oneDecimal = new Intl.NumberFormat("en", { maximumFractionDigits: 1 });

export const isFiniteNumber = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);

// ------------------------------------------------------------ funnel

export type FunnelStep = {
  label: string;
  value: number;
  /** Replaces the number drawn in the step, such as "1.2k". */
  displayValue?: string;
};

/** Why the steps cannot be drawn as a funnel, or null. Each step is shown against the first one. */
export function funnelProblem(steps: readonly FunnelStep[]): string | null {
  if (steps.length === 0) return "There are no steps.";
  if (steps.some((s) => !isFiniteNumber(s.value) || s.value < 0)) return "A step has no number or a negative one.";
  if (steps[0].value === 0) return "The first step is 0, so nothing can be shown against it.";
  if (new Set(steps.map((s) => s.label)).size !== steps.length) return "Two steps have the same label.";
  return null;
}

/** The share of the first step, as the chart prints it ("42%"), for the text alternative. */
export function funnelTable(steps: readonly FunnelStep[], caption: string, valueHeader = "Count"): Table {
  const first = steps[0]?.value ?? 0;
  return {
    caption,
    headers: ["Step", valueHeader, "Share of the first step"],
    rows: steps.map((s) => [s.label, number.format(s.value), first > 0 ? `${oneDecimal.format((s.value / first) * 100)}%` : "n/a"]),
  };
}

// ------------------------------------------------------------ gauge

export type GaugeTone = "good" | "warning" | "bad" | "neutral";

/** A stretch of the scale with a meaning, in the same units as the value (not 0 to 100). */
export type GaugeRange = { from: number; to: number; tone: GaugeTone };

export const GAUGE_TONE_COLOR: Record<GaugeTone, string> = {
  good: "var(--chart-good)",
  warning: "var(--chart-warning)",
  bad: "var(--chart-bad)",
  neutral: "var(--chart-foreground-muted)",
};

/** Why a gauge cannot be drawn: a scale that is not a range, or a value that is not a number. */
export function gaugeProblem(value: number, min: number, max: number): string | null {
  if (![value, min, max].every(isFiniteNumber)) return "The value, the minimum or the maximum is not a number.";
  if (!(max > min)) return "The maximum must be above the minimum.";
  return null;
}

/** Where a value sits on the 0 to 100 scale the gauge draws. Outside the range it stops at the end; the middle still says the real number. */
export function gaugePercent(value: number, min: number, max: number): number {
  return Math.min(100, Math.max(0, ((value - min) / (max - min)) * 100));
}

/** Ranges on the gauge's own 0 to 100 scale, with a colour variable each. */
export function gaugeZones(ranges: readonly GaugeRange[], min: number, max: number) {
  return ranges.map((r) => ({
    from: gaugePercent(r.from, min, max),
    to: gaugePercent(r.to, min, max),
    color: GAUGE_TONE_COLOR[r.tone],
  }));
}

export function gaugeTable(
  value: number,
  min: number,
  max: number,
  label: string,
  ranges: readonly GaugeRange[] = [],
  format: (n: number) => string = (n) => number.format(n)
): Table {
  const tone = { good: "Good", warning: "Warning", bad: "Bad", neutral: "Neutral" } as const;
  return {
    caption: `${label}, on a scale from ${format(min)} to ${format(max)}`,
    headers: ["", "Value"],
    rows: [
      [label, format(value)],
      ...ranges.map((r) => [`${tone[r.tone]} range`, `${format(r.from)} to ${format(r.to)}`] as (string | number)[]),
    ],
  };
}

// ------------------------------------------------------------ sankey

export type FlowNode = { id: string; label: string };
export type Flow = { from: string; to: string; value: number };

/**
 * Why the flows cannot be drawn, or null. A Sankey diagram needs each flow to be above zero and to
 * join two different known nodes, and the flows must not run in a circle (the layout cannot place a loop).
 */
export function sankeyProblem(nodes: readonly FlowNode[], flows: readonly Flow[]): string | null {
  if (nodes.length < 2) return "There are fewer than two nodes.";
  if (flows.length === 0) return "There are no flows.";
  const ids = new Set(nodes.map((n) => n.id));
  if (ids.size !== nodes.length) return "Two nodes have the same id.";
  if (new Set(nodes.map((n) => n.label)).size !== nodes.length) return "Two nodes have the same label.";
  for (const f of flows) {
    if (!ids.has(f.from) || !ids.has(f.to)) return `A flow names a node that is not in the list (${f.from} to ${f.to}).`;
    if (f.from === f.to) return `A flow goes from ${f.from} to itself.`;
    if (!isFiniteNumber(f.value) || f.value <= 0) return `The flow from ${f.from} to ${f.to} is not above zero.`;
  }
  const seen = new Set(flows.map((f) => `${f.from}\u0000${f.to}`));
  if (seen.size !== flows.length) return "Two flows join the same pair of nodes in the same direction.";
  // A loop: depth-first search for a node that is reached again on its own path.
  const next = new Map<string, string[]>();
  for (const f of flows) next.set(f.from, [...(next.get(f.from) ?? []), f.to]);
  const state = new Map<string, 1 | 2>();
  const visit = (id: string): boolean => {
    state.set(id, 1);
    for (const to of next.get(id) ?? []) {
      const s = state.get(to);
      if (s === 1) return true;
      if (s === undefined && visit(to)) return true;
    }
    state.set(id, 2);
    return false;
  };
  for (const n of nodes) if (state.get(n.id) === undefined && visit(n.id)) return "The flows run in a circle.";
  return null;
}

/** What goes into a node and what comes out, from the flows as given. */
export function nodeTotals(nodes: readonly FlowNode[], flows: readonly Flow[]) {
  const totals = new Map<string, { into: number; out: number; hasIn: boolean; hasOut: boolean }>();
  for (const n of nodes) totals.set(n.id, { into: 0, out: 0, hasIn: false, hasOut: false });
  for (const f of flows) {
    const a = totals.get(f.from);
    const b = totals.get(f.to);
    if (a) {
      a.out += f.value;
      a.hasOut = true;
    }
    if (b) {
      b.into += f.value;
      b.hasIn = true;
    }
  }
  return totals;
}

export function sankeyTable(nodes: readonly FlowNode[], flows: readonly Flow[], caption: string, valueHeader = "Count"): Table {
  const label = new Map(nodes.map((n) => [n.id, n.label]));
  return {
    caption,
    headers: ["From", "To", valueHeader],
    rows: flows.map((f) => [label.get(f.from) ?? f.from, label.get(f.to) ?? f.to, number.format(f.value)]),
  };
}

// ------------------------------------------------------------ radar

export type RadarAxis = { key: string; label: string };
export type RadarSeries = {
  label: string;
  /** One number for every axis, by key. */
  values: Record<string, number>;
};

/** Why the radar cannot be drawn: it needs three axes or more, a number for each axis in each series, and a top of scale above zero. */
export function radarProblem(
  axes: readonly RadarAxis[],
  series: readonly RadarSeries[],
  max: number | Readonly<Record<string, number>>
): string | null {
  if (axes.length < 3) return "A radar chart needs at least three axes.";
  if (new Set(axes.map((a) => a.key)).size !== axes.length) return "Two axes have the same key.";
  if (series.length === 0) return "There are no series.";
  if (series.length > 3) return "More than three series cannot be told apart.";
  for (const a of axes) {
    const top = typeof max === "number" ? max : max[a.key];
    if (!isFiniteNumber(top) || top <= 0) return `The top of the scale for "${a.label}" is missing or not above zero.`;
    for (const s of series) {
      if (!isFiniteNumber(s.values[a.key])) return `"${s.label}" has no number for "${a.label}".`;
    }
  }
  return null;
}

/** Each value as a share of its axis's top of scale, 0 to 100 (more than the top is held at 100, the rim). */
export function radarScaled(
  axes: readonly RadarAxis[],
  series: readonly RadarSeries[],
  max: number | Readonly<Record<string, number>>
) {
  return series.map((s) => ({
    label: s.label,
    values: Object.fromEntries(
      axes.map((a) => {
        const top = typeof max === "number" ? max : (max[a.key] as number);
        return [a.key, Math.min(100, Math.max(0, (s.values[a.key] / top) * 100))];
      })
    ) as Record<string, number>,
  }));
}

export function radarTable(
  axes: readonly RadarAxis[],
  series: readonly RadarSeries[],
  max: number | Readonly<Record<string, number>>,
  caption: string,
  format: (n: number) => string = (n) => number.format(n)
): Table {
  return {
    caption,
    headers: ["Axis", "Top of scale", ...series.map((s) => s.label)],
    rows: axes.map((a) => [
      a.label,
      format(typeof max === "number" ? max : (max[a.key] ?? Number.NaN)),
      ...series.map((s) => (isFiniteNumber(s.values[a.key]) ? format(s.values[a.key]) : "No reading")),
    ]),
  };
}

// ------------------------------------------------------------ radial clock

/** The value of one hour of the day. An hour that is left out, or has `value` null, has no reading. */
export type HourValue = { hour: number; value: number | null };

export const hourLabel = (h: number) => String(h).padStart(2, "0");

/** The 24 hours as the chart's data: one row per hour, in hour order, `value` null where there is no reading. */
export function clockData(hours: readonly HourValue[]): { ok: boolean; rows: { hour: string; value: number | null }[]; ignored: number } {
  const byHour = new Map<number, number | null>();
  let ignored = 0;
  for (const h of hours) {
    if (!Number.isInteger(h.hour) || h.hour < 0 || h.hour > 23 || (h.value !== null && !isFiniteNumber(h.value)) || (h.value !== null && h.value < 0)) {
      ignored += 1;
      continue;
    }
    if (byHour.has(h.hour)) ignored += 1;
    byHour.set(h.hour, h.value);
  }
  const rows = Array.from({ length: 24 }, (_, h) => ({ hour: hourLabel(h), value: byHour.get(h) ?? null }));
  return { ok: [...byHour.values()].some((v) => v !== null), rows, ignored };
}

/** "14:00 to 15:00". */
export function hourSpan(hour: number): string {
  return `${hourLabel(hour)}:00 to ${hourLabel((hour + 1) % 24)}:00`;
}

export function clockTable(hours: readonly HourValue[], caption: string, valueHeader = "Count"): Table {
  const { rows } = clockData(hours);
  return {
    caption,
    headers: ["Hour", valueHeader],
    rows: rows.map((r, h) => [hourSpan(h), r.value === null ? "No reading" : number.format(r.value)]),
  };
}

// ------------------------------------------------------------ live line

/** One reading: `at` is milliseconds since the epoch (`Date.now()`, `date.getTime()`). */
export type LiveReading = { at: number; value: number };

/** The readings in time order (a sorted copy, equal times keep their order), without any that are not numbers. */
export function liveReadings(readings: readonly LiveReading[]): LiveReading[] {
  return readings.filter((r) => isFiniteNumber(r.at) && isFiniteNumber(r.value)).sort((a, b) => a.at - b.at);
}

/**
 * The reading nearest in time to `atMs`, or null when `atMs` is before the first reading: the
 * chart's window may start earlier than the data, and nothing was read there.
 */
export function nearestReading(sorted: readonly LiveReading[], atMs: number): LiveReading | null {
  if (sorted.length === 0 || atMs < sorted[0].at) return null;
  let lo = 0;
  let hi = sorted.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid].at <= atMs) lo = mid;
    else hi = mid;
  }
  const a = sorted[lo];
  const b = sorted[hi];
  return Math.abs(atMs - a.at) <= Math.abs(b.at - atMs) ? a : b;
}

const clockTime = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

/** "14:05:03" in the reader's own time zone. */
export function formatClock(ms: number): string {
  return clockTime.format(ms);
}

export function liveTable(readings: readonly LiveReading[], caption: string, valueHeader = "Value", format: (n: number) => string = (n) => number.format(n)): Table {
  return { caption, headers: ["Time", valueHeader], rows: liveReadings(readings).map((r) => [formatClock(r.at), format(r.value)]) };
}
