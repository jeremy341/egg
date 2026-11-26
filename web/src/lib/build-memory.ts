/**
 * The memory limit of the build sandbox, per server. Builds run in a Docker
 * sandbox on the Egg side, and a standard Nest container is happy with
 * 2 GB. Some Nest servers can request more, so the owner can change it on the
 * Container page. This file has no server code, so the page can use it too.
 */
export const DEFAULT_BUILD_MEMORY_MB = 2048;
export const MIN_BUILD_MEMORY_MB = 512;
/** The top of the range when the server probe did not report its total memory. */
export const FALLBACK_MAX_BUILD_MEMORY_MB = 8192;

/** 512 up to the memory the server reports, or up to 8192 when it does not report any. */
export function buildMemoryRange(totalMb: number | null | undefined): { min: number; max: number } {
  const min = MIN_BUILD_MEMORY_MB;
  const reported = typeof totalMb === "number" && Number.isFinite(totalMb) && totalMb > 0;
  return { min, max: reported ? Math.max(min, Math.floor(totalMb)) : FALLBACK_MAX_BUILD_MEMORY_MB };
}

/** A plain message when the value cannot be used, or null when it can. */
export function checkBuildMemory(value: unknown, totalMb: number | null | undefined): string | null {
  const { min, max } = buildMemoryRange(totalMb);
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
    return `Build memory must be a whole number of MB from ${min} to ${max}.`;
  }
  return null;
}

/** The total memory in the stored server probe (JSON text), or null when it was not reported or cannot be read. */
export function reportedMemoryMb(probeJson: string | null | undefined): number | null {
  if (!probeJson) return null;
  try {
    const v = (JSON.parse(probeJson) as { memTotalMb?: unknown } | null)?.memTotalMb;
    return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null;
  } catch {
    return null;
  }
}
