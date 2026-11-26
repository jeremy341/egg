/**
 * Post-deploy regression check, pure part. Compares the 15 minutes before a
 * deploy became ready with the 15 minutes after, using the health checks the
 * monitor already makes once a minute. No database access here.
 */

export const REGRESSION_WINDOW_MS = 15 * 60_000;
/** Fewer checks than this on either side means nothing can be said either way. */
export const MIN_WINDOW_SAMPLES = 5;

export type CheckSample = {
  at: Date;
  /** Health path time in ms; null when nothing answered or it was not timed. */
  healthMs: number | null;
  /** True when the health path answered below a server error; null when not checked. */
  healthOk: boolean | null;
  /** systemd's restart counter at the time of the check. */
  restarts: number | null;
};

export type WindowStats = {
  /** Number of checks in the window. */
  samples: number;
  p95Ms: number | null;
  /** Failed checks as a fraction of the checks that were made, 0 to 1. Null when none were made. */
  errorRate: number | null;
  /** Restarts that happened inside the window (increases of the counter; resets are not counted). */
  restarts: number;
};

export type Verdict = "regressed" | "ok" | "insufficient_data";

export type RegressionResult = {
  verdict: Verdict;
  /** One plain sentence per threshold that was crossed. Empty unless regressed. */
  reasons: string[];
  before: WindowStats;
  after: WindowStats;
};

/** Nearest-rank 95th percentile. Null for an empty list. */
export function p95(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil(0.95 * sorted.length);
  return sorted[Math.max(0, rank - 1)];
}

/** Restarts inside a window: the sum of increases between consecutive readings. A drop means a new service, so it is not counted. */
export function restartsWithin(samples: CheckSample[]): number {
  const readings = samples
    .filter((s) => s.restarts !== null)
    .sort((a, b) => a.at.getTime() - b.at.getTime())
    .map((s) => s.restarts as number);
  let total = 0;
  for (let i = 1; i < readings.length; i++) {
    const rise = readings[i] - readings[i - 1];
    if (rise > 0) total += rise;
  }
  return total;
}

/** Pure: the numbers for one window of checks. */
export function windowStats(samples: CheckSample[]): WindowStats {
  const latencies = samples.map((s) => s.healthMs).filter((v): v is number => v !== null);
  const checked = samples.filter((s) => s.healthOk !== null);
  const failed = checked.filter((s) => s.healthOk === false).length;
  return {
    samples: samples.length,
    p95Ms: p95(latencies),
    errorRate: checked.length === 0 ? null : failed / checked.length,
    restarts: restartsWithin(samples),
  };
}

/**
 * Pure: is the "after" window a regression of the "before" window?
 *
 * Regressed when any of these hold:
 * - P95 latency rises by at least 25% and by at least 50 ms;
 * - the error rate doubles and rises by at least 0.5 percentage points;
 * - the service restarts at least twice after the deploy.
 *
 * Not enough checks on either side gives "insufficient_data", never "ok".
 */
export function compareWindows(before: WindowStats, after: WindowStats): RegressionResult {
  if (before.samples < MIN_WINDOW_SAMPLES || after.samples < MIN_WINDOW_SAMPLES) {
    return { verdict: "insufficient_data", reasons: [], before, after };
  }
  const reasons: string[] = [];

  if (before.p95Ms !== null && after.p95Ms !== null) {
    const rise = after.p95Ms - before.p95Ms;
    if (rise >= 50 && rise >= before.p95Ms * 0.25) {
      reasons.push(`P95 latency rose from ${Math.round(before.p95Ms)} ms to ${Math.round(after.p95Ms)} ms.`);
    }
  }

  if (before.errorRate !== null && after.errorRate !== null) {
    const rise = after.errorRate - before.errorRate;
    if (rise >= 0.005 && after.errorRate >= before.errorRate * 2) {
      reasons.push(
        `Error rate rose from ${pct(before.errorRate)} to ${pct(after.errorRate)}.`
      );
    }
  }

  if (after.restarts >= 2) {
    reasons.push(`The service restarted ${after.restarts} times after the deploy.`);
  }

  return { verdict: reasons.length > 0 ? "regressed" : "ok", reasons, before, after };
}

function pct(fraction: number): string {
  return `${Math.round(fraction * 1000) / 10}%`;
}

/** Splits checks into the windows either side of the moment the deploy became ready. */
export function splitAroundReady(samples: CheckSample[], readyAt: Date, windowMs = REGRESSION_WINDOW_MS) {
  const t = readyAt.getTime();
  const before = samples.filter((s) => s.at.getTime() >= t - windowMs && s.at.getTime() < t);
  const after = samples.filter((s) => s.at.getTime() > t && s.at.getTime() <= t + windowMs);
  return { before, after };
}

/** The stored form of a finished comparison, kept on the deployment. */
export type StoredPostDeployCheck = RegressionResult & { readyAt: string; checkedAt: string };

export function parseStoredCheck(text: string | null): StoredPostDeployCheck | null {
  if (!text) return null;
  try {
    return JSON.parse(text) as StoredPostDeployCheck;
  } catch {
    return null;
  }
}
