/**
 * Suggests a memory and CPU size for an app from what it measured. Nothing is applied: the owner reads the
 * suggestion and decides. The inputs are the per-app samples kept by the monitor (memory in MB, CPU as a
 * share of one core in percent), over up to 14 days.
 *
 * Memory: 115% of the highest daily peak, and never below 128 MiB.
 * CPU: the larger of 115% of the P99 and 150% of the P95, and never below 100 millicores.
 * Percentiles use the nearest-rank method. One CPU core is 1000 millicores, so 1% of a core is 10m.
 * At least 3 UTC days of samples are needed before anything is suggested.
 */

export const RIGHT_SIZE_WINDOW_DAYS = 14;
export const RIGHT_SIZE_MIN_DAYS = 3;
export const MEMORY_MIN_MB = 128;
export const CPU_MIN_MILLICORES = 100;

const DAY_MS = 24 * 60 * 60 * 1000;

export type RightSizeSample = { at: number; memMb: number | null; cpuPercent: number | null };

export type RightSize =
  | { status: "not_enough_history"; days: number; neededDays: number }
  | {
      status: "ok";
      days: number;
      /** Null when no memory was measured. */
      memoryMb: number | null;
      /** Null when no CPU was measured. */
      cpuMillicores: number | null;
      basis: { memoryPeakMb: number | null; cpuP95Percent: number | null; cpuP99Percent: number | null };
    };

/** Nearest-rank percentile of an ascending list. Returns null for an empty list. */
export function percentile(sortedAscending: number[], p: number): number | null {
  if (sortedAscending.length === 0) return null;
  const rank = Math.ceil((p / 100) * sortedAscending.length);
  return sortedAscending[Math.min(sortedAscending.length, Math.max(1, rank)) - 1];
}

export function suggestRightSize(samples: RightSizeSample[], now: number): RightSize {
  const from = now - RIGHT_SIZE_WINDOW_DAYS * DAY_MS;
  const inWindow = samples.filter((s) => s.at >= from && s.at <= now);
  const measured = inWindow.filter((s) => s.memMb != null || s.cpuPercent != null);
  const days = new Set(measured.map((s) => Math.floor(s.at / DAY_MS)));
  if (days.size < RIGHT_SIZE_MIN_DAYS) {
    return { status: "not_enough_history", days: days.size, neededDays: RIGHT_SIZE_MIN_DAYS };
  }

  // Memory: the highest single-day peak, plus 15%.
  const peakByDay = new Map<number, number>();
  for (const s of measured) {
    if (s.memMb == null) continue;
    const day = Math.floor(s.at / DAY_MS);
    peakByDay.set(day, Math.max(peakByDay.get(day) ?? 0, s.memMb));
  }
  const memoryPeak = peakByDay.size > 0 ? Math.max(...peakByDay.values()) : null;
  // Integer arithmetic, so 115% of a whole number of MB never picks up a float error.
  const memoryMb = memoryPeak === null ? null : Math.max(MEMORY_MIN_MB, Math.ceil((memoryPeak * 115) / 100));

  // CPU: the larger of 115% of P99 and 150% of P95, converted from percent of a core to millicores.
  const cpu = measured.filter((s) => s.cpuPercent != null).map((s) => s.cpuPercent as number).sort((a, b) => a - b);
  const p95 = percentile(cpu, 95);
  const p99 = percentile(cpu, 99);
  const cpuMillicores =
    p95 === null || p99 === null
      ? null
      // 115% of P99 in millicores is p99 * 11.5 (p99 * 115 / 10); 150% of P95 is p95 * 15 (p95 * 150 / 10).
      // Scaling by whole numbers before the divide keeps an exact result exact.
      : Math.max(CPU_MIN_MILLICORES, Math.ceil(Math.max(p99 * 115, p95 * 150) / 10));

  return {
    status: "ok",
    days: days.size,
    memoryMb,
    cpuMillicores,
    basis: { memoryPeakMb: memoryPeak, cpuP95Percent: p95, cpuP99Percent: p99 },
  };
}
