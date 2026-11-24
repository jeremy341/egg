/**
 * Time ranges for the resource charts (browser and server). Each range has a
 * window, and a bucket size that the points are averaged into, so a 5-minute
 * view and a 7-day view both draw a readable number of points.
 */

export type MetricRange = "5m" | "1h" | "24h" | "7d";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export const METRIC_RANGES: { value: MetricRange; label: string; windowMs: number; bucketMs: number }[] = [
  { value: "5m", label: "5 minutes", windowMs: 5 * MINUTE, bucketMs: MINUTE },
  { value: "1h", label: "1 hour", windowMs: HOUR, bucketMs: 5 * MINUTE },
  { value: "24h", label: "24 hours", windowMs: DAY, bucketMs: 15 * MINUTE },
  { value: "7d", label: "7 days", windowMs: 7 * DAY, bucketMs: HOUR },
];

export const DEFAULT_METRIC_RANGE: MetricRange = "24h";

/** Unknown or missing values fall back to the default range. */
export function parseMetricRange(value: string | null | undefined): MetricRange {
  return METRIC_RANGES.some((r) => r.value === value) ? (value as MetricRange) : DEFAULT_METRIC_RANGE;
}

export function metricRange(value: MetricRange) {
  return METRIC_RANGES.find((r) => r.value === value) ?? METRIC_RANGES[2];
}

/** The window in hours, as a fraction where needed (5 minutes is 1/12). */
export function metricRangeHours(value: MetricRange): number {
  return metricRange(value).windowMs / HOUR;
}

/** Start of the bucket that holds `atMs`. Buckets are aligned to the epoch. */
export function bucketStart(atMs: number, value: MetricRange): number {
  const { bucketMs } = metricRange(value);
  return Math.floor(atMs / bucketMs) * bucketMs;
}

export type BucketPoint = { at: number; memMb: number | null; cpuPercent: number | null };

/**
 * Average the points into buckets of the range's size. Points outside the
 * window ending at `nowMs` are dropped. A bucket's `at` is its start. Null
 * values are left out of the average; a bucket with no value stays null.
 */
export function bucketPoints(points: BucketPoint[], value: MetricRange, nowMs: number): BucketPoint[] {
  const { windowMs } = metricRange(value);
  const from = nowMs - windowMs;
  const groups = new Map<number, { mem: number[]; cpu: number[] }>();
  for (const p of points) {
    if (p.at < from || p.at > nowMs) continue;
    const key = bucketStart(p.at, value);
    const g = groups.get(key) ?? { mem: [], cpu: [] };
    if (p.memMb !== null) g.mem.push(p.memMb);
    if (p.cpuPercent !== null) g.cpu.push(p.cpuPercent);
    groups.set(key, g);
  }
  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  return [...groups.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([at, g]) => ({ at, memMb: avg(g.mem), cpuPercent: avg(g.cpu) }));
}
