/**
 * The memory limit of a build, per server. Builds run on the Nest container, never on
 * Egg's machine, and a standard Nest container is happy with 2 GB. Some Nest servers
 * can request more, so the owner can change it on the Container page. This file has no server code, so the page can use it too.
 */
export const DEFAULT_BUILD_MEMORY_MB = 2048;
/**
 * The build memory a new server starts with. Builds on the Nest container run beside the
 * running app, so they start smaller than the general default above.
 */
export const DEFAULT_CONTAINER_BUILD_MEMORY_MB = 512;
/** Memory a container keeps for the running app and the system: a build cap never reaches into it. */
export const CONTAINER_RESERVE_MB = 512;
/**
 * The least a project with a build step gets while it builds, when the container has room for it
 * (its reported memory minus the reserve is at least this). Applied when a build starts; the
 * server's saved setting is not changed.
 */
export const BUILD_STEP_FLOOR_MB = 1024;
export const MIN_BUILD_MEMORY_MB = 512;
/** The top of the range when the server probe did not report its total memory. */
export const FALLBACK_MAX_BUILD_MEMORY_MB = 8192;

/** CPU limit used for the isolated Docker build, in cores. */
export const DEFAULT_BUILD_CPUS = 2;
export const MIN_BUILD_CPUS = 0.5;
export const BUILD_CPU_STEP = 0.25;

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

/** CPU range from the connected Nest server probe, with the current 2-core cap as fallback. */
export function buildCpuRange(totalCpus: number | null | undefined): { min: number; max: number; default: number } {
  const reported = typeof totalCpus === "number" && Number.isFinite(totalCpus) && totalCpus > 0;
  const max = Math.max(MIN_BUILD_CPUS, reported ? totalCpus : DEFAULT_BUILD_CPUS);
  return { min: MIN_BUILD_CPUS, max, default: Math.min(DEFAULT_BUILD_CPUS, max) };
}

/** A plain message when the CPU limit cannot be used, or null when it can. */
export function checkBuildCpu(value: unknown, totalCpus: number | null | undefined): string | null {
  const { min, max } = buildCpuRange(totalCpus);
  const onStep = typeof value === "number" && Math.abs(value / BUILD_CPU_STEP - Math.round(value / BUILD_CPU_STEP)) < 1e-8;
  if (typeof value !== "number" || !Number.isFinite(value) || !onStep || value < min || value > max) {
    return `Build CPU must be a number from ${min} to ${max} cores in ${BUILD_CPU_STEP}-core steps.`;
  }
  return null;
}

/** The core count from the stored server probe, or null when unavailable. */
export function reportedCpus(probeJson: string | null | undefined): number | null {
  if (!probeJson) return null;
  try {
    const v = (JSON.parse(probeJson) as { cpus?: unknown } | null)?.cpus;
    return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null;
  } catch {
    return null;
  }
}
