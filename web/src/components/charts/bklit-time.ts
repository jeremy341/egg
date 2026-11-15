/**
 * Readings over time (CPU, memory, disk) made ready for a Bklit chart, and the words and table
 * rows that go with it. Pure: nothing here smooths, fills in or invents a reading. A stretch with
 * no readings stays a gap.
 */

/** One sample. `value` is null when the worker took a sample but this measurement was missing. */
export type TimePoint = { at: number; value: number | null };

export type Reading = { at: number; value: number };

/**
 * A row of the chart. `value` is null on a gap row. `band` is 1 on the two rows that bracket a gap,
 * so the chart can shade the stretch with no readings; it is null everywhere else.
 */
export type TimeRow = { at: number; value: number | null; band: number | null };

const FIFTEEN_MINUTES = 15 * 60_000;
const HOUR = 3_600_000;

/** The samples that have a value, in the order given. */
export function readings(points: readonly TimePoint[]): Reading[] {
  return points.filter((p): p is Reading => p.value !== null);
}

/**
 * How far apart two readings may be before the line between them is broken: three times the
 * usual spacing, and never less than 15 minutes.
 */
export function gapThreshold(series: readonly Reading[]): number {
  const spacings = series
    .slice(1)
    .map((p, i) => p.at - series[i].at)
    .sort((a, b) => a - b);
  return Math.max((spacings[Math.floor(spacings.length / 2)] ?? 0) * 3, FIFTEEN_MINUTES);
}

/**
 * The readings with two empty rows around every gap, so the chart breaks its line there and can
 * shade the stretch. No reading is moved, dropped or added.
 */
export function withGaps(points: readonly TimePoint[]): TimeRow[] {
  const series = readings(points);
  const limit = gapThreshold(series);
  const rows: TimeRow[] = [];
  series.forEach((p, i) => {
    const before = series[i - 1];
    if (before && p.at - before.at > limit) {
      rows.push({ at: before.at + 1, value: null, band: 1 }, { at: p.at - 1, value: null, band: 1 });
    }
    rows.push({ ...p, band: null });
  });
  return rows;
}

export type ReadingStats = { low: number; average: number; peak: number; latest: number };

/** Lowest, average, peak and newest reading. Null when there is no reading. */
export function readingStats(series: readonly Reading[]): ReadingStats | null {
  if (series.length === 0) return null;
  let low = series[0].value;
  let peak = series[0].value;
  let sum = 0;
  for (const p of series) {
    if (p.value < low) low = p.value;
    if (p.value > peak) peak = p.value;
    sum += p.value;
  }
  return { low, average: sum / series.length, peak, latest: series[series.length - 1].value };
}

export type HourRow = { at: number; low: number; average: number; peak: number; readings: number };

/**
 * The readings grouped by clock hour, for the table under a chart: a week of five-minute
 * readings is two thousand rows, an hour at a time is 168. An hour with no reading has no row.
 */
export function hourly(series: readonly Reading[]): HourRow[] {
  const hours = new Map<number, Reading[]>();
  for (const p of series) {
    const start = Math.floor(p.at / HOUR) * HOUR;
    const list = hours.get(start);
    if (list) list.push(p);
    else hours.set(start, [p]);
  }
  return [...hours.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([at, list]) => {
      const s = readingStats(list)!;
      return { at, low: s.low, average: s.average, peak: s.peak, readings: list.length };
    });
}
