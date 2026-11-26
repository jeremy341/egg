import { eq } from "drizzle-orm";
import { BUILD_STEP_FLOOR_MB, CONTAINER_RESERVE_MB } from "@/lib/build-memory";
import { getDb, schema } from "@/server/db";
import { BuildLockError, withBuildLock, type StaleLock } from "@/server/deploy/build-lock";
import { DOWNLOAD_CACHE_MAX_MB, npmCacheScript, type NpmCachePlan } from "@/server/deploy/download-cache";
import { measureStage, startStage, type StageRecorder } from "@/server/deploy/performance";
import type { BuildResult } from "@/server/deploy/build";
import {
  evaluatePreflight,
  type PreflightNeeds,
  type PreflightRunner,
} from "@/server/deploy/container-probe";
import {
  RELEASE_ID,
  SH_MARKER_HELPERS,
  currentLink,
  envFileOf,
  incomingArchive,
  projectDir,
  releaseDir,
} from "@/server/deploy/layout";
import { ENV_KEY } from "@/server/deploy/runtime";
import { SshError, shellQuote, type NestSession } from "@/server/ssh/connection";

/**
 * Building on the Nest container. The source is uploaded, unpacked into a new release
 * folder, and installed and built there under a systemd scope that caps memory and CPU,
 * while the running app keeps serving. A build that fails, runs out of memory, times out
 * or is canceled removes its own folder and leaves the running release and the `current`
 * link alone. Switching to the new release is the pipeline's job and happens only after
 * this returns.
 */

/** A build stops after this long. */
export const BUILD_TIMEOUT_SECONDS = 15 * 60;
/** The smallest cap worth starting a build with. Below this the container is too small to build on. */
export const MIN_CONTAINER_CAP_MB = 256;
/** Builds yield to the running app when the CPU is busy. */
export const BUILD_CPU_WEIGHT = 20;
/** Raised so the kernel's out-of-memory killer picks the build before the app. */
export const BUILD_OOM_SCORE_ADJUST = 500;
/** Written into the app's service file so the app is the last thing the kernel kills. */
export const APP_OOM_SCORE_ADJUST = -500;

/**
 * The memory cap does not cover disk, so a build is also watched while it runs. Both limits live
 * here and nowhere else (they are not per-server settings). The disk floor keeps room on the
 * container for the app's logs and for any release it still has to write: when the free space on
 * the release area falls below it, the build is stopped. The build budget keeps one build from
 * eating the container's disk: when its release folder grows past it, the build is stopped.
 * The pre-upload check (container-probe.ts) still asks for 2048 MB free before anything is uploaded.
 */
export const BUILD_DISK_FLOOR_MB = 1024;
export const BUILD_DISK_BUDGET_MB = 2048;
/** The free space is read this often (a cheap `df`), and the folder size every fifth time (a slower `du`). */
export const DISK_WATCH_SECONDS = 2;
export const DISK_SIZE_EVERY_TICKS = 5;
/** Exit codes the capped build script uses when the disk watchdog stopped the build. */
export const EXIT_DISK_FLOOR = 43;
export const EXIT_DISK_BUDGET = 44;
/** Exit code of the stop and cleanup scripts when a build scope may still be running on the container. */
export const EXIT_SCOPE_RUNNING = 46;
/** Written into the release folder by the watchdog; the build script reads it to say which limit was crossed. */
export const DISK_STOP_MARKER = ".egg-disk-stop";

/** Raised for anything that stops a container build; the message is shown to the owner as is. */
export class ContainerBuildError extends Error {}

// ----------------------------------------------------------------- the cap

/**
 * The memory cap of a build in MB: the server's setting, raised to at least 1024 MB when the
 * project has a build step and the container has room for that (its reported memory minus the
 * 512 MB kept for the app is at least 1024 MB). Never more than the container's own memory minus
 * what is kept for the app. Refuses when that leaves under 256 MB.
 */
export function containerMemoryCapMb(
  settingMb: number,
  containerMemoryMb: number | null | undefined,
  hasBuildStep = false
): number {
  let cap = Math.floor(settingMb);
  if (typeof containerMemoryMb === "number" && Number.isFinite(containerMemoryMb) && containerMemoryMb > 0) {
    const room = Math.floor(containerMemoryMb) - CONTAINER_RESERVE_MB;
    if (hasBuildStep && room >= BUILD_STEP_FLOOR_MB) cap = Math.max(cap, BUILD_STEP_FLOOR_MB);
    cap = Math.min(cap, room);
  }
  if (!Number.isFinite(cap) || cap < MIN_CONTAINER_CAP_MB) {
    throw new ContainerBuildError(
      `The build did not start: your container reports ${Math.floor(containerMemoryMb ?? 0)} MB of memory, and ${CONTAINER_RESERVE_MB} MB of that is kept for your app, which leaves too little to build in. Use a larger container.`
    );
  }
  return cap;
}

/** CPUQuota in percent for a number of cores: 2 cores is 200%. */
export function cpuQuotaPercent(cores: number): number {
  return Math.max(10, Math.round(cores * 100));
}

/** Name of the systemd scope a build runs in. */
export function buildScopeName(releaseId: string): string {
  if (!RELEASE_ID.test(releaseId)) throw new ContainerBuildError("The release id is not valid.");
  return `egg-build-${releaseId.slice(0, 8)}`;
}

/**
 * The `systemd-run` command and its arguments, up to and including `--`. The kernel enforces
 * the limits on the scope: MemoryMax (with no swap, so the limit is a real one), CPUQuota, a
 * low CPUWeight so the running app wins when the CPU is busy, and a cap on the number of tasks.
 */
export function systemdRunArgs(o: { scope: string; memoryMb: number; cpuPercent: number }): string[] {
  if (!/^egg-build-[0-9a-f]{8}$/.test(o.scope)) throw new ContainerBuildError("The build scope name is not valid.");
  if (!Number.isInteger(o.memoryMb) || o.memoryMb < MIN_CONTAINER_CAP_MB) {
    throw new ContainerBuildError("The build memory cap is not valid.");
  }
  if (!Number.isInteger(o.cpuPercent) || o.cpuPercent < 1) {
    throw new ContainerBuildError("The build CPU cap is not valid.");
  }
  return [
    "systemd-run",
    "--scope",
    "--quiet",
    "--collect",
    `--unit=${o.scope}`,
    `--property=MemoryMax=${o.memoryMb}M`,
    "--property=MemorySwapMax=0",
    `--property=CPUQuota=${o.cpuPercent}%`,
    `--property=CPUWeight=${BUILD_CPU_WEIGHT}`,
    "--property=TasksMax=4096",
    "--",
  ];
}

// ----------------------------------------------------------------- messages

/** What the owner is told when the build ends with `code`. */
export function describeBuildFailure(
  code: number,
  ctx: { memoryCapMb: number; appRunning: boolean; archiveRoot?: string }
): string {
  const tail = ctx.appRunning ? " Your app is still running." : "";
  switch (code) {
    case 137:
      return `The build needed more memory than the cap of ${ctx.memoryCapMb} MB.${tail}`;
    case 124:
      return `The build took longer than ${BUILD_TIMEOUT_SECONDS / 60} minutes and was stopped.${tail}`;
    case EXIT_DISK_FLOOR:
      return `The build stopped because the container's free disk space fell below ${BUILD_DISK_FLOOR_MB} MB.${tail} Free up disk space on your container, then deploy again.`;
    case EXIT_DISK_BUDGET:
      return `The build used more than ${BUILD_DISK_BUDGET_MB} MB of disk space and was stopped.${tail}`;
    case 41:
      return `The output folder "${ctx.archiveRoot ?? "."}" was not created by the build.${tail}`;
    case 20:
      return `The upload was corrupted (checksum mismatch). Deploy again.${tail}`;
    default:
      return `The build failed (exit ${code}).${tail}`;
  }
}

// ----------------------------------------------------------------- remote scripts

const HEAD = "set -euo pipefail\n";

export function buildEnvFile(home: string, slug: string, releaseId: string) {
  return `${projectDir(home, slug)}/incoming/${releaseId}.buildenv`;
}

/** The resolved Compose forms Docker itself produced, kept like the build variables files. */
export function composeConfigFiles(home: string, slug: string, releaseId: string) {
  if (!RELEASE_ID.test(releaseId)) throw new ContainerBuildError("The release id is not valid.");
  const base = `${projectDir(home, slug)}/incoming/${releaseId}.compose`;
  return { canonical: `${base}.yaml`, json: `${base}.json` };
}

/** Shell lines that export the build variables. Names were checked when they were saved. */
export function renderBuildEnv(vars: Record<string, string>): string {
  const lines: string[] = [];
  for (const [k, v] of Object.entries(vars)) {
    if (!ENV_KEY.test(k)) throw new ContainerBuildError(`Invalid environment variable name: ${k}`);
    if (v === "") continue;
    lines.push(`export ${k}=${shellQuote(v)}`);
  }
  return lines.join("\n") + "\n";
}

/** A folder to serve that is inside the release: relative, no `..`. */
function safeRelative(p: string): string {
  const clean = p.replace(/\\/g, "/").replace(/^\.\/+/, "");
  if (!clean || clean === "." ) return ".";
  if (clean.startsWith("/") || clean.split("/").includes("..") || /[\u0000-\u001f]/.test(clean)) {
    throw new ContainerBuildError(`The output folder "${p}" must be inside the project.`);
  }
  return clean.replace(/\/+$/, "");
}

/** Verify the uploaded source and unpack it into a fresh release folder. */
export function unpackSourceScript(a: { home: string; slug: string; releaseId: string; sha256: string }) {
  if (!RELEASE_ID.test(a.releaseId)) throw new ContainerBuildError("The release id is not valid.");
  const archive = incomingArchive(a.home, a.slug, a.releaseId);
  const dir = releaseDir(a.home, a.slug, a.releaseId);
  return (
    HEAD +
    `archive=${shellQuote(archive)}\ndir=${shellQuote(dir)}\n` +
    `if command -v sha256sum >/dev/null 2>&1; then\n` +
    `  actual=$(sha256sum "$archive" | cut -d' ' -f1)\n` +
    `  if [ "$actual" != ${shellQuote(a.sha256)} ]; then echo "Upload is corrupted: checksum mismatch" >&2; rm -f "$archive"; exit 20; fi\n` +
    `  echo "Checksum verified"\n` +
    `else echo "sha256sum is required to verify source before extraction" >&2; exit 21; fi\n` +
    `rm -rf "$dir"\nmkdir -p "$dir"\n` +
    // Bound the uncompressed tar stream before tar writes any files. Measure
    // the reserve after upload, and fail closed if free space cannot be read.
    `free_kb=$(df -Pk "$dir" 2>/dev/null | awk 'NR==2 {print $4}' || true)\n` +
    `case "$free_kb" in ''|*[!0-9]*) echo "Could not measure free disk space before extraction" >&2; exit 43;; esac\n` +
    `reserve_kb=${BUILD_DISK_FLOOR_MB * 1024}\n` +
    `if [ "$free_kb" -le "$reserve_kb" ]; then echo "Not enough free disk space to extract the source safely" >&2; exit 43; fi\n` +
    `extract_limit=$(( (free_kb - reserve_kb) * 1024 ))\n` +
    `max_extract=${BUILD_DISK_BUDGET_MB * 1024 * 1024}\n` +
    `if [ "$extract_limit" -gt "$max_extract" ]; then extract_limit=$max_extract; fi\n` +
    `if ! gzip -dc -- "$archive" | head -c "$extract_limit" | tar -xf - -C "$dir"; then\n` +
    `  echo "Source extraction failed or exceeded the safe disk budget" >&2; exit 43\nfi\n` +
    `rm -f "$archive"\n` +
    `echo "Unpacked the source"\n`
  );
}

export type BuildStep = { label: string; command: string };

/** The install and build commands of a project, in order, with the production install last. */
export function buildSteps(spec: {
  buildInstall: string | null;
  buildCommand: string | null;
  remoteInstall: string | null;
}): BuildStep[] {
  const steps: BuildStep[] = [];
  if (spec.buildInstall) steps.push({ label: "Installing", command: spec.buildInstall });
  if (spec.buildCommand) steps.push({ label: "Building", command: spec.buildCommand });
  if (spec.remoteInstall) steps.push({ label: "Installing production dependencies", command: spec.remoteInstall });
  return steps;
}

/**
 * The disk watchdog: a small loop that starts with the build and watches the container's disk.
 * It runs in the build script, outside the build's scope, and uses the script's own `$dir`.
 *
 * Every DISK_WATCH_SECONDS it reads the free space on the release area with `df -Pm`, and every
 * DISK_SIZE_EVERY_TICKS ticks (10 seconds) the size of the release folder with `du -sm`; the
 * cheaper check runs more often. When a limit is crossed it writes the marker file (mode 600, the
 * limit and the numbers) and stops the build scope. The only things it stops are the processes in
 * that scope: it never touches the app's unit or the app's folder. To stop the scope it runs
 * `systemctl stop` on it; if that fails (the scope may not exist yet at the very first check) it
 * retries, and falls back to sending TERM to the processes listed in the scope's own cgroup. A
 * process group is not used, because the build shares the script's group and TERM to it would
 * end the script and the watchdog too. If nothing works after five tries it says so and leaves
 * the build to the time limit; the marker is already written, so the release is still discarded.
 *
 * A `df` or `du` that is missing, fails or prints something unreadable is a warning (once), and
 * that check is skipped: the build is never stopped for what the watchdog could not read.
 */
export function diskWatchdogStartScript(a: { scope: string; cacheRoot?: string; docker?: boolean }): string {
  if (!/^egg-build-[0-9a-f]{8}$/.test(a.scope)) throw new ContainerBuildError("The build scope name is not valid.");
  const unit = shellQuote(`${a.scope}.scope`);
  const floor = BUILD_DISK_FLOOR_MB;
  const budget = BUILD_DISK_BUDGET_MB;
  return [
    `egg_wd_marker="$dir/${DISK_STOP_MARKER}"`,
    `egg_wd_area="\${dir%/*}"`,
    // Docker keeps images and build cache outside the release area. A build that
    // fills that daemon storage can still strand the container, so watch it too.
    `egg_wd_docker_root=""`,
    ...(a.docker ? [
      `if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then egg_wd_docker_root=$(docker info -f '{{.DockerRootDir}}' 2>/dev/null || true); fi`,
    ] : []),
    `egg_wd_parent=$$`,
    `egg_wd_stop() {`,
    `  local n=0 cg p sent`,
    `  while [ "$n" -lt 5 ]; do`,
    `    if systemctl stop ${unit} >/dev/null 2>&1; then return 0; fi`,
    `    cg=$(systemctl show -p ControlGroup --value ${unit} 2>/dev/null | head -n 1)`,
    `    case "$cg" in /*)`,
    `      if [ -r "/sys/fs/cgroup$cg/cgroup.procs" ]; then`,
    `        sent=0`,
    `        while read -r p; do if [ -n "$p" ] && kill -TERM "$p" 2>/dev/null; then sent=1; fi; done < "/sys/fs/cgroup$cg/cgroup.procs"`,
    `        if [ "$sent" -eq 1 ]; then return 0; fi`,
    `      fi;;`,
    `    esac`,
    `    n=$((n + 1)); sleep ${DISK_WATCH_SECONDS}`,
    `  done`,
    `  echo "Disk watchdog: could not stop the build scope; the build time limit will end it." >&2`,
    `  return 1`,
    `}`,
    `egg_wd_trip() {`,
    `  ( umask 077; printf '%s\\n' "$1 $2" > "$egg_wd_marker" ) 2>/dev/null && chmod 600 "$egg_wd_marker" 2>/dev/null`,
    `  echo "Disk watchdog: the $1 limit was crossed ($2). Stopping the build." >&2`,
    `  egg_wd_stop`,
    `}`,
    `egg_wd_loop() {`,
    `  trap 'exit 0' HUP INT TERM`,
    `  local tick=0 free used warned_df=0 warned_du=0 start=$SECONDS`,
    `  while kill -0 "$egg_wd_parent" 2>/dev/null && [ $((SECONDS - start)) -lt ${BUILD_TIMEOUT_SECONDS + 300} ]; do`,
    `    free=""`,
    `    if command -v df >/dev/null 2>&1; then free=$(df -Pm "$egg_wd_area" 2>/dev/null | awk 'NR==2 {print $4}'); fi`,
    `    case "$free" in`,
    `      ''|*[!0-9]*)`,
    `        if [ "$warned_df" -eq 0 ]; then warned_df=1; echo "Disk watchdog: could not read the free disk space with df, so the disk floor is not being checked." >&2; fi;;`,
    `      *)`,
    `        if [ "$free" -lt ${floor} ]; then egg_wd_trip floor "free=\${free}MB limit=${floor}MB"; exit ${EXIT_DISK_FLOOR}; fi;;`,
    `    esac`,
    `    if [ -n "$egg_wd_docker_root" ] && [ -d "$egg_wd_docker_root" ]; then`,
    `      dfree=""`,
    `      if command -v df >/dev/null 2>&1; then dfree=$(df -Pm "$egg_wd_docker_root" 2>/dev/null | awk 'NR==2 {print $4}'); fi`,
    `      if [[ "$dfree" =~ ^[0-9]+$ ]] && [ "$dfree" -lt ${floor} ]; then egg_wd_trip docker "free=\${dfree}MB limit=${floor}MB"; exit ${EXIT_DISK_FLOOR}; fi`,
    `    fi`,
    `    if [ $((tick % ${DISK_SIZE_EVERY_TICKS})) -eq 0 ]; then`,
    `      used=""`,
    `      if command -v du >/dev/null 2>&1; then used=$(du -sm "$dir" 2>/dev/null | awk 'NR==1 {print $1}'); fi`,
    `      case "$used" in`,
    `        ''|*[!0-9]*)`,
    `          if [ "$warned_du" -eq 0 ]; then warned_du=1; echo "Disk watchdog: could not read the size of the build folder with du, so the build budget is not being checked." >&2; fi;;`,
    `        *)`,
    `          if [ "$used" -gt ${budget} ]; then egg_wd_trip budget "used=\${used}MB limit=${budget}MB"; exit ${EXIT_DISK_BUDGET}; fi;;`,
    `      esac`,
    `    fi`,
    ...(a.cacheRoot ? [
      `    cache_root=${shellQuote(a.cacheRoot)}; cache_parent="\${cache_root%/*}"; cache_base="\${cache_parent%/*}"`,
      `    if [ $((tick % ${DISK_SIZE_EVERY_TICKS})) -eq 0 ] && [ -d "$cache_root" ] && [ ! -L "$cache_root" ] && [ ! -L "$cache_parent" ] && [ ! -L "$cache_base" ] && [ -f "$cache_base/.egg-cache-managed" ] && [ ! -L "$cache_base/.egg-cache-managed" ]; then`,
      `      used=0; for entry in "$cache_root"/*; do`,
      `        [ -d "$entry" ] && [ ! -L "$entry" ] && [ -f "$entry/.egg-cache-entry-managed" ] && [ ! -L "$entry/.egg-cache-entry-managed" ] || continue`,
      `        [[ "\${entry##*/}" =~ ^[a-f0-9]{64}$ ]] || continue`,
      `        size=$(du -sm "$entry" 2>/dev/null | awk 'NR==1 {print $1}'); [[ "$size" =~ ^[0-9]+$ ]] && used=$((used + size))`,
      `      done`,
      `      if [[ "$used" =~ ^[0-9]+$ ]] && [ "$used" -gt ${DOWNLOAD_CACHE_MAX_MB} ]; then egg_wd_trip cache "used=\${used}MB limit=${DOWNLOAD_CACHE_MAX_MB}MB"; exit ${EXIT_DISK_BUDGET}; fi`,
      `    fi`,
    ] : []),
    `    tick=$((tick + 1))`,
    `    sleep ${DISK_WATCH_SECONDS} &`,
    `    wait $!`,
    `  done`,
    `}`,
    `egg_wd_loop </dev/null &`,
    `egg_wd_pid=$!`,
    `trap 'kill "$egg_wd_pid" 2>/dev/null' EXIT`,
    `trap 'exit 143' HUP INT TERM`,
    ``,
  ].join("\n");
}

/**
 * Runs once the build has ended, whatever its result: ends the watchdog, then reads the marker
 * (or, if the marker could not be written, the watchdog's own exit status) and turns the exit
 * code into the disk floor or build budget code. `$disk` is empty when the watchdog did not stop the build.
 */
export function diskWatchdogEndScript(): string {
  return [
    `kill "$egg_wd_pid" 2>/dev/null`,
    `wait "$egg_wd_pid" 2>/dev/null`,
    `egg_wd_status=$?`,
    `disk=""`,
    `if [ -f "$egg_wd_marker" ] && [ ! -L "$egg_wd_marker" ]; then read -r disk _ < "$egg_wd_marker" || true; fi`,
    `case "$disk" in`,
    `  floor) code=${EXIT_DISK_FLOOR};;`,
    `  budget) code=${EXIT_DISK_BUDGET};;`,
    `  cache) code=${EXIT_DISK_BUDGET};;`,
    `  docker) code=${EXIT_DISK_FLOOR};;`,
    `  *) disk=""`,
    `     case "$egg_wd_status" in`,
    `       ${EXIT_DISK_FLOOR}) disk=floor; code=${EXIT_DISK_FLOOR};;`,
    `       ${EXIT_DISK_BUDGET}) disk=budget; code=${EXIT_DISK_BUDGET};;`,
    `     esac;;`,
    `esac`,
    ``,
  ].join("\n");
}

/**
 * Run the install and build inside the capped scope, in the release folder. Exit codes the
 * pipeline understands: 0 built, 124 timed out, 137 killed (out of memory, in the cap),
 * 41 the output folder is missing, 43 the disk floor was crossed, 44 the build budget was
 * crossed (both stopped by the disk watchdog), anything else is the build's own exit code.
 */
export function cappedBuildScript(a: {
  home: string;
  slug: string;
  releaseId: string;
  memoryMb: number;
  cpuPercent: number;
  steps: BuildStep[];
  archiveRoot: string;
  hasEnvFile: boolean;
  cache?: NpmCachePlan | null;
  npmLockHash?: string | null;
  /** Docker modes: this build composes its own command instead of the runtime preset. */
  docker?: boolean;
}) {
  const scope = buildScopeName(a.releaseId);
  const dir = releaseDir(a.home, a.slug, a.releaseId);
  const envFile = buildEnvFile(a.home, a.slug, a.releaseId);
  const root = safeRelative(a.docker ? "." : a.archiveRoot);
  const cacheRoot = a.cache && a.npmLockHash ? `${projectDir(a.home, a.slug)}/cache/npm/${a.cache.context}` : undefined;

  const inner = [
    `echo ${BUILD_OOM_SCORE_ADJUST} > /proc/self/oom_score_adj 2>/dev/null || true`,
    `set -e`,
    // The variables are plaintext on the container only while they are being loaded: the file is
    // removed as soon as the shell has read it, and again on exit (the trap) if loading failed.
    // The build steps see the variables because they were exported into this shell.
    a.hasEnvFile ? `trap ${shellQuote(`rm -f -- ${shellQuote(envFile)}`)} EXIT` : ``,
    a.hasEnvFile ? `. ${shellQuote(envFile)}` : ``,
    a.hasEnvFile ? `rm -f -- ${shellQuote(envFile)}` : ``,
    `export CI=true`,
    `cd ${shellQuote(dir)}`,
    cacheRoot && a.npmLockHash ? npmCacheScript(cacheRoot, a.npmLockHash, dir) : ``,
    ...a.steps.flatMap((s) => [`echo ${shellQuote(`${s.label}: ${s.command}`)}`, cacheRoot && (s.command === "npm ci" || s.command === "npm ci --omit=dev") ? s.command.replace(/^npm /, "egg_npm ") : s.command]),
  ]
    .filter((l) => l !== "")
    .join("\n");

  const run = [
    ...systemdRunArgs({ scope, memoryMb: a.memoryMb, cpuPercent: a.cpuPercent }).map(shellQuote),
    "nice",
    "-n",
    "10",
    "timeout",
    "-s",
    "TERM",
    String(BUILD_TIMEOUT_SECONDS),
    "bash",
    "-lc",
    '"$inner"',
  ].join(" ");

  const promote =
    root === "."
      ? ""
      : `if [ "$code" -eq 0 ]; then\n` +
        `  out="$dir"/${shellQuote(root)}\n` +
        `  if [ -d "$out" ] && [ ! -L "$out" ] && case "$(cd "$out" && pwd -P)" in "$(cd "$dir" && pwd -P)"/*) true;; *) false;; esac; then\n` +
        `    tmp="$dir.out"; rm -rf "$tmp"\n` +
        `    mv "$out" "$tmp" && rm -rf "$dir" && mv "$tmp" "$dir" || code=42\n` +
        `  else echo ${shellQuote(`The output folder "${root}" was not created by the build.`)} >&2; code=41; fi\n` +
        `fi\n`;

  return (
    `set -uo pipefail\n` +
    `dir=${shellQuote(dir)}\nenvfile=${shellQuote(envFile)}\n` +
    `inner=${shellQuote(inner)}\n` +
    // The disk watchdog runs beside the build, outside its scope, and ends with it.
    diskWatchdogStartScript({ scope, cacheRoot, docker: a.docker }) +
    // Also remove the variables file when this script ends however it ends (a hangup, a TERM).
    `trap 'kill "$egg_wd_pid" 2>/dev/null; rm -f "$envfile"' EXIT\n` +
    `${run}\ncode=$?\n` +
    diskWatchdogEndScript() +
    (cacheRoot ? `cache_base=${shellQuote(`${projectDir(a.home, a.slug)}/cache`)}; cache_parent="$cache_base/npm"; cache_root=${shellQuote(cacheRoot)}\n` +
      `if [ -f "$cache_base/.egg-cache-managed" ] && [ ! -L "$cache_base/.egg-cache-managed" ] && [ ! -L "$cache_base" ] && [ ! -L "$cache_parent" ] && [ ! -L "$cache_root" ]; then\n` +
      `  for entry in "$cache_root"/*; do [ -d "$entry" ] && [ ! -L "$entry" ] && [ -f "$entry/.egg-cache-entry-managed" ] && [ ! -L "$entry/.egg-cache-entry-managed" ] || continue; [[ "\${entry##*/}" =~ ^[a-f0-9]{64}$ ]] || continue; cache_size=$(du -sm "$entry" 2>/dev/null | awk 'NR==1 {print $1}'); if [ "$disk" = cache ] || { [[ "$cache_size" =~ ^[0-9]+$ ]] && [ "$cache_size" -gt ${DOWNLOAD_CACHE_MAX_MB} ]; }; then rm -rf -- "$entry"; fi; done\n` +
      `fi\n` : "") +
    // Whatever is still in the scope (a build that ignored the timeout) is stopped.
    `systemctl stop ${shellQuote(`${scope}.scope`)} >/dev/null 2>&1 || true\n` +
    `rm -f "$envfile"\n` +
    // The kernel's out-of-memory killer may have taken a child of the build and the build may then exit with its own code.
    `if [ -z "$disk" ] && [ "$code" -ne 0 ] && [ "$code" -ne 124 ] && [ "$code" -ne 137 ]; then\n` +
    `  if journalctl -u ${shellQuote(`${scope}.scope`)} -n 50 --no-pager 2>/dev/null | grep -qiE 'oom-kill|killed by the OOM|out of memory'; then code=137; fi\n` +
    `fi\n` +
    promote +
    `exit "$code"\n`
  );
}

/** Stop a build's scope now (cancel, or a stuck build). Safe to run when it is already gone. */
export function stopBuildScript(releaseId: string) {
  const scope = buildScopeName(releaseId);
  return (
    `systemctl stop ${shellQuote(`${scope}.scope`)} >/dev/null 2>&1 || true\n` +
    `systemctl reset-failed ${shellQuote(`${scope}.scope`)} >/dev/null 2>&1 || true\n` +
    `true\n`
  );
}

/** Shell lines that exit EXIT_SCOPE_RUNNING when the build scope `unit` is still running (or starting, or stopping). */
function scopeStillRunningCheck(unitExpr: string, message: string) {
  return (
    `state=$(systemctl is-active ${unitExpr} 2>/dev/null || true)\n` +
    `case "$state" in active|activating|deactivating|reloading) echo ${shellQuote(message)} >&2; exit ${EXIT_SCOPE_RUNNING};; esac\n`
  );
}

/**
 * Remove what an unfinished build left: its scope, its release folder, the uploaded archive
 * and the variables file. Never touches a release that `current` points at, and only works
 * inside a project folder Egg created. Exits EXIT_SCOPE_RUNNING (after removing the files) when
 * the build's scope is still running once it was asked to stop, so a caller can tell a
 * confirmed stop from one that is not.
 */
export function discardBuildScript(a: { home: string; slug: string; releaseId: string }) {
  if (!RELEASE_ID.test(a.releaseId)) throw new ContainerBuildError("The release id is not valid.");
  const p = projectDir(a.home, a.slug);
  const dir = releaseDir(a.home, a.slug, a.releaseId);
  const scope = `${buildScopeName(a.releaseId)}.scope`;
  const compose = composeConfigFiles(a.home, a.slug, a.releaseId);
  return (
    SH_MARKER_HELPERS +
    stopBuildScript(a.releaseId) +
    `rm -f ${shellQuote(buildEnvFile(a.home, a.slug, a.releaseId))} ${shellQuote(incomingArchive(a.home, a.slug, a.releaseId))} ${shellQuote(compose.canonical)} ${shellQuote(compose.json)}\n` +
    `if egg_dir_managed ${shellQuote(p)}; then\n` +
    `  live=$(readlink ${shellQuote(currentLink(a.home, a.slug))} 2>/dev/null || true)\n` +
    `  if [ "$live" != ${shellQuote(dir)} ]; then rm -rf ${shellQuote(dir)} ${shellQuote(`${dir}.out`)} ${shellQuote(envFileOf(a.home, a.slug, a.releaseId))}; fi\n` +
    `fi\n` +
    scopeStillRunningCheck(shellQuote(scope), `The build scope ${scope} is still running.`) +
    `true\n`
  );
}

/**
 * Remove the build-variables files that earlier builds of this project left in its `incoming`
 * folder (an interrupted build whose own cleanup could not run), except the one named by
 * `keepReleaseId`. Run at the start of a build, while holding the server's build lock, so no
 * other build of any project is running. Only inside a project folder Egg created, and only
 * files named `<release id>.buildenv`.
 */
export function removeLeftoverBuildEnvScript(a: { home: string; slug: string; keepReleaseId: string }) {
  if (!RELEASE_ID.test(a.keepReleaseId)) throw new ContainerBuildError("The release id is not valid.");
  const p = projectDir(a.home, a.slug);
  return (
    SH_MARKER_HELPERS +
    `if egg_dir_managed ${shellQuote(p)}; then\n` +
    `  for f in ${shellQuote(`${p}/incoming`)}/*.buildenv; do\n` +
    `    [ -e "$f" ] || [ -L "$f" ] || continue\n` +
    `    n=\${f##*/}; id=\${n%.buildenv}\n` +
    `    [[ "$id" =~ ^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$ ]] || continue\n` +
    `    [ "$id" = ${shellQuote(a.keepReleaseId)} ] && continue\n` +
    `    rm -f -- "$f" && echo "Removed a leftover build variables file from an earlier build"\n` +
    `  done\n` +
    `fi\n` +
    `true\n`
  );
}

/**
 * Check that no build scope is running on the container, stopping any that is, and confirm that
 * each one is gone. Used by a build that finds the lock stale. Exits EXIT_SCOPE_RUNNING when a
 * scope could not be confirmed stopped, or when the scopes could not be listed at all. Touches
 * only units named `egg-build-` plus eight hex digits.
 */
export function stopAllBuildScopesScript() {
  const named = `^egg-build-[0-9a-f]{8}\\.scope$`;
  const running = `active|activating|deactivating|reloading`;
  return (
    `if ! listing=$(systemctl list-units --type=scope --all --no-legend --plain 'egg-build-*.scope' 2>/dev/null); then\n` +
    `  echo "Could not list the build scopes on this container." >&2; exit ${EXIT_SCOPE_RUNNING}\n` +
    `fi\n` +
    `units=$(printf '%s\\n' "$listing" | awk '{print $1}' | grep -E '${named}' || true)\n` +
    `bad=0\n` +
    `for u in $units; do\n` +
    `  state=$(systemctl is-active "$u" 2>/dev/null || true)\n` +
    `  case "$state" in ${running}) echo "Stopping $u"; systemctl stop "$u" >/dev/null 2>&1 || true;; esac\n` +
    `  systemctl reset-failed "$u" >/dev/null 2>&1 || true\n` +
    `  state=$(systemctl is-active "$u" 2>/dev/null || true)\n` +
    `  case "$state" in ${running}) echo "$u is still running." >&2; bad=1;; esac\n` +
    `done\n` +
    `if [ "$bad" -ne 0 ]; then exit ${EXIT_SCOPE_RUNNING}; fi\n` +
    `echo "No build scope is running."\n`
  );
}

// ----------------------------------------------------------------- the lifecycle

type BuildLog = { info: (m: string) => void; warn: (m: string) => void; error: (m: string) => void };
type BuildSession = Pick<NestSession, "script" | "uploadFile" | "writeFile" | "exec">;

export type ContainerBuildInput = {
  session: BuildSession;
  log: BuildLog;
  serverId: string;
  deploymentId: string;
  home: string;
  slug: string;
  releaseId: string;
  built: Pick<BuildResult, "archivePath" | "sha256" | "sizeBytes" | "spec">;
  /** The project's variables for the build. Never printed. */
  env: Record<string, string>;
  /** The server's build memory setting, in MB. */
  memoryMb: number;
  /** The server's build CPU setting, in cores. */
  cpuCores: number;
  /** Memory the container reported when it was probed for this deploy. */
  containerMemoryMb: number | null;
  /** A release is already serving, so a failed build leaves a running app behind. */
  appRunning: boolean;
  needs: PreflightNeeds;
  preflight: PreflightRunner;
  signal?: AbortSignal;
  lockPollMs?: number;
  lockMaxWaitMs?: number;
  /** How often the build renews its hold on the lock, in ms. */
  lockRenewMs?: number;
  /** How long without a renewal makes another build treat the lock as stale, in ms. */
  lockStaleAfterMs?: number;
  /** What the archive is called in the log. Defaults to "source". */
  artifact?: string;
  recordStage?: StageRecorder;
  cache?: NpmCachePlan | null;
  npmLockHash?: string | null;
  /**
   * Dockerfile mode: the command that builds the release image, run inside the
   * capped scope and the disk watchdog instead of the runtime presets.
   */
  dockerSteps?: BuildStep[];
  /**
   * Compose mode: run after the unpack, under the lock, and return the capped
   * steps for this release. The script asks Docker on the target to resolve the
   * Compose file; the JSON it writes is what Egg reads and validates, and the
   * steps only ever use the resolved output, never the original file.
   */
  dockerPrepare?: { label: string; script: string; jsonPath: string; steps: (json: unknown) => BuildStep[] };
};

/** The pre-upload check. Throws one fix line for the first thing that is missing; changes nothing. */
export async function checkContainerReady(a: {
  preflight: PreflightRunner;
  needs: PreflightNeeds;
  home: string;
  slug: string;
  log: Pick<BuildLog, "warn">;
  signal?: AbortSignal;
}): Promise<void> {
  const facts = await a.preflight(`${projectDir(a.home, a.slug)}/releases`, a.signal);
  const problems = evaluatePreflight(facts, a.needs);
  if (problems.length === 0) return;
  for (const p of problems.slice(1)) a.log.warn(p.fix);
  throw new ContainerBuildError(problems[0].fix);
}

const unconfirmedStaleMessage =
  "A previous build on this container stopped reporting in, and Egg could not confirm that it has stopped running on your container, so this build did not start. Check that nothing named egg-build is running there (systemctl list-units 'egg-build-*'), then deploy again.";

const lockLostMessage = () =>
  new ContainerBuildError(
    "This build stopped reporting in for too long, so another deployment took over this container's build lock and this build was stopped. Deploy again."
  );

/** The release folder of the deployment that holds (or held) the build lock, or null when no such deployment is recorded. */
async function releaseOfDeployment(deploymentId: string): Promise<{ releaseId: string; slug: string } | null> {
  const db = await getDb();
  const row = await db
    .select({ releaseId: schema.deployments.releaseId, slug: schema.projects.slug })
    .from(schema.deployments)
    .innerJoin(schema.projects, eq(schema.deployments.projectId, schema.projects.id))
    .where(eq(schema.deployments.id, deploymentId))
    .get();
  return row ?? null;
}

/**
 * Called by a build that finds the build lock stale, before it takes the lock over. Over this
 * build's own SSH session it stops every build scope still running on the container, confirms
 * that none is, and removes what the stale holder's build left (its release folder, archive and
 * variables file). Throws a BuildLockError, and so leaves the lock alone, when any of that cannot be
 * confirmed. A stale holder with no deployment record leaves nothing that can be named, so only the
 * scopes are checked.
 */
export async function verifyStaleBuildHolder(a: {
  session: Pick<NestSession, "script">;
  log: Pick<BuildLog, "info" | "warn">;
  home: string;
  signal?: AbortSignal;
  stale: StaleLock;
}): Promise<void> {
  const { session, log, signal } = a;
  log.warn("A previous build on this container stopped reporting in. Checking that it has stopped before this build starts.");
  try {
    const target = await releaseOfDeployment(a.stale.holder);
    const stopped = await session.script(stopAllBuildScopesScript(), {
      timeoutMs: 60_000,
      signal,
      outputTailBytes: 65536, onLine: (l, s) => (s === "stderr" ? log.warn(l) : log.info(l)),
    });
    if (stopped.code !== 0) throw new BuildLockError(unconfirmedStaleMessage);
    if (target) {
      const cleaned = await session.script(discardBuildScript({ home: a.home, slug: target.slug, releaseId: target.releaseId }), {
        timeoutMs: 60_000,
        signal,
      });
      if (cleaned.code !== 0) throw new BuildLockError(unconfirmedStaleMessage);
    } else {
      log.warn("The previous build has no deployment record, so only its running process was checked.");
    }
  } catch (err) {
    if (signal?.aborted) throw new BuildLockError("The deployment was canceled.");
    if (err instanceof BuildLockError) throw err;
    throw new BuildLockError(unconfirmedStaleMessage);
  }
  log.info("The previous build is confirmed stopped and cleaned up. Taking over the build lock.");
}

/**
 * Upload the source, then unpack it, and install and build it in the release folder under the
 * cap, one at a time per container: the unpack always runs under the server's build lock, with or
 * without a build step, so two deploys never measure the same free disk space and extract
 * together. Resolves when the release folder holds a finished build; throws a ContainerBuildError
 * (or the cancel error) after removing everything the attempt created. If the build's remote
 * process could not be confirmed stopped, the lock is not released; see build-lock.ts.
 */
export async function runContainerBuild(a: ContainerBuildInput): Promise<{ memoryCapMb: number }> {
  const { session, log, signal } = a;
  const record = a.recordStage ?? (async () => {});
  const dockerMode = Boolean(a.dockerSteps || a.dockerPrepare);
  let steps = a.dockerSteps ?? buildSteps(a.built.spec);
  const buildWork = dockerMode || steps.length > 0;
  const memoryCapMb = buildWork ? containerMemoryCapMb(a.memoryMb, a.containerMemoryMb, dockerMode || Boolean(a.built.spec.buildCommand)) : 0;
  const cpuPercent = cpuQuotaPercent(a.cpuCores);
  if (dockerMode) {
    // The systemd scope below caps the build process tree, but the Docker
    // daemon does the actual image build and its buildkit workers live outside
    // that scope. Give `docker build` its own limits so one project cannot eat
    // the container's memory or CPU while the app keeps serving.
    const memoryArg = `--memory=${memoryCapMb}m`;
    const cpusArg = `--cpus=${Math.max(0.1, Number((cpuPercent / 100).toFixed(2)))}`;
    steps = steps.map((s) => s.command.startsWith("docker build ")
      ? { ...s, command: s.command.replace(/^docker build /, `docker build ${memoryArg} ${cpusArg} `) }
      : s);
  }

  /** True once a cleanup has been tried. The cleanup returns true only when the build's scope is confirmed stopped. */
  let discarded = false;
  const discard = async (): Promise<boolean> => {
    discarded = true;
    try {
      const res = await session.script(discardBuildScript({ home: a.home, slug: a.slug, releaseId: a.releaseId }), { timeoutMs: 60_000 });
      if (res.code === 0) {
        log.info("Removed the unfinished release folder. Your running app was not changed.");
        return true;
      }
      log.warn(
        res.code === EXIT_SCOPE_RUNNING
          ? "Could not confirm that the build stopped on your container. The next build on it checks again before it starts."
          : "Could not remove the unfinished release folder; the next deploy cleans it up."
      );
      return false;
    } catch {
      log.warn("Could not remove the unfinished release folder; the next deploy cleans it up.");
      return false;
    }
  };

  try {
    log.info(`Uploading ${(a.built.sizeBytes / 1e6).toFixed(1)} MB of ${a.artifact ?? "source"}`);
    await measureStage("upload", () => session.uploadFile(a.built.archivePath, incomingArchive(a.home, a.slug, a.releaseId), { signal }), record, a.built.sizeBytes);
    if (signal?.aborted) throw new ContainerBuildError("The deployment was canceled.");

    const finishLockWait = startStage("lock_wait", record);
    try {
    await withBuildLock(
      a.serverId,
      a.deploymentId,
      {
        signal,
        pollMs: a.lockPollMs,
        maxWaitMs: a.lockMaxWaitMs,
        renewMs: a.lockRenewMs,
        staleAfterMs: a.lockStaleAfterMs,
        onWait: () => log.info("Another build is running on this container. Waiting for it to finish."),
        verifyStale: (stale) => verifyStaleBuildHolder({ session, log, home: a.home, signal, stale }),
      },
      async (waited, lock) => {
        await finishLockWait("ok");
        // Everything under the lock stops when the deployment is canceled or the lock is lost.
        const runSignal = signal ? AbortSignal.any([signal, lock.lost]) : lock.lost;

        const unpack = async () => {
          const res = await session.script(
            unpackSourceScript({ home: a.home, slug: a.slug, releaseId: a.releaseId, sha256: a.built.sha256 }),
            { timeoutMs: 15 * 60_000, signal: runSignal, outputTailBytes: 65536, onLine: (l, s) => (s === "stderr" ? log.warn(l) : log.info(l)) }
          );
          if (res.code === 20) {
            throw new ContainerBuildError(describeBuildFailure(20, { memoryCapMb, appRunning: a.appRunning }));
          }
          if (res.code === 21) {
            throw new ContainerBuildError(`Your container has no sha256sum, so the upload could not be checked. Install coreutils on the container and deploy again.${a.appRunning ? " Your app is still running." : ""}`);
          }
          if (res.code === EXIT_DISK_FLOOR) {
            throw new ContainerBuildError(`The source could not be unpacked within the safe disk budget.${a.appRunning ? " Your app is still running." : ""}`);
          }
          if (res.code !== 0) {
            throw new ContainerBuildError(
              `The source could not be unpacked on your container (exit ${res.code}).${a.appRunning ? " Your app is still running." : ""}`
            );
          }
        };

        try {
          if (waited) {
            // The disk may have filled while we waited.
            await checkContainerReady({
              preflight: a.preflight,
              needs: a.needs,
              home: a.home,
              slug: a.slug,
              log,
              signal: runSignal,
            });
          }
          if (!buildWork) {
            log.info("No build step for this project.");
          } else {
            // No other build is running now, so a variables file of another release is a leftover.
            await session
              .script(removeLeftoverBuildEnvScript({ home: a.home, slug: a.slug, keepReleaseId: a.releaseId }), {
                timeoutMs: 30_000,
                signal: runSignal,
                outputTailBytes: 65536, onLine: (l) => log.info(l),
              })
              .catch((err) => {
                if (runSignal.aborted) throw err;
                log.warn("Could not look for leftover build variables files; the next deploy tries again.");
              });
          }
          await measureStage("unpack", unpack, record);
          if (a.dockerPrepare) {
            // The Compose file is read by Docker itself on the target, and only the
            // resolved output Egg validates and later runs. Nothing of the
            // original file executes here.
            const prepare = a.dockerPrepare;
            const json = await measureStage("compose", async () => {
              const res = await session.script(prepare.script, {
                timeoutMs: 120_000,
                signal: runSignal,
                outputTailBytes: 65536,
                onLine: (l, s) => (s === "stderr" ? log.warn(l) : log.info(l)),
              });
              if (res.code !== 0) throw new ContainerBuildError(`Docker could not read the Compose file on your container. Check the file path and its format.${a.appRunning ? " Your app is still running." : ""}`);
              const read = await session.exec(`cat ${shellQuote(prepare.jsonPath)}`, { signal: runSignal });
              if (read.code !== 0 || !read.stdout.trim()) throw new ContainerBuildError(`Docker did not return the Compose configuration. Check the file path and its format.${a.appRunning ? " Your app is still running." : ""}`);
              return read.stdout;
            }, record);
            let parsed: unknown;
            try {
              parsed = JSON.parse(json);
            } catch {
              throw new ContainerBuildError("Docker returned a Compose configuration that could not be read.");
            }
            steps = prepare.steps(parsed);
          }
          if (!buildWork) {
            if (lock.lost.aborted) throw lockLostMessage();
            return;
          }

          if (Object.keys(a.env).length > 0) {
            await session.writeFile(buildEnvFile(a.home, a.slug, a.releaseId), renderBuildEnv(a.env), "600", { signal: runSignal });
          }
          log.info(
            `Building on your container, capped at ${memoryCapMb} MB of memory and ${cpuPercent}% of one core's time, for at most ${BUILD_TIMEOUT_SECONDS / 60} minutes. Your app keeps running.`
          );

          log.info(
            `Watching disk use: the build is stopped if free space falls below ${BUILD_DISK_FLOOR_MB} MB or the build folder grows past ${BUILD_DISK_BUDGET_MB} MB.`
          );

          const stop = () => {
            void session.script(stopBuildScript(a.releaseId), { timeoutMs: 30_000 }).catch(() => {});
          };
          runSignal.addEventListener("abort", stop, { once: true });
          let code: number;
          try {
            const res = await measureStage("build", async () => {
              const result = await session.script(
              cappedBuildScript({
                home: a.home,
                slug: a.slug,
                releaseId: a.releaseId,
                memoryMb: memoryCapMb,
                cpuPercent,
                steps,
                archiveRoot: dockerMode ? "." : a.built.spec.archiveRoot,
                hasEnvFile: Object.keys(a.env).length > 0,
                docker: dockerMode || undefined,
                cache: a.cache,
                npmLockHash: a.npmLockHash,
              }),
              {
                // The script enforces the limit itself; this is the backstop if the connection hangs.
                timeoutMs: (BUILD_TIMEOUT_SECONDS + 120) * 1000,
                signal: runSignal,
                outputTailBytes: 65536, onLine: (l, s) => (s === "stderr" ? log.warn(l) : log.info(l)),
              }
              );
              if (result.code !== 0) throw new ContainerBuildError(describeBuildFailure(result.code, { memoryCapMb, appRunning: a.appRunning, archiveRoot: a.built.spec.archiveRoot }));
              return result;
            }, record);
            code = res.code;
          } catch (err) {
            if (err instanceof SshError && err.kind === "timeout") {
              stop();
              throw new ContainerBuildError(describeBuildFailure(124, { memoryCapMb, appRunning: a.appRunning }));
            }
            throw err;
          } finally {
            runSignal.removeEventListener("abort", stop);
          }
          if (code !== 0) {
            throw new ContainerBuildError(
              describeBuildFailure(code, {
                memoryCapMb,
                appRunning: a.appRunning,
                archiveRoot: a.built.spec.archiveRoot,
              })
            );
          }
          // A build that finished after the lock was taken over cannot be trusted: its folder may be gone.
          if (lock.lost.aborted) throw lockLostMessage();
          log.info("Build finished");
        } catch (err) {
          // Stop and clean up while still holding the lock. If the stop cannot be confirmed (the
          // connection is gone, the cleanup could not run), keep the lock: it goes stale, and the
          // next build verifies on the container and takes it over. A lost lock is not ours to keep.
          const stopped = await discard();
          if (!stopped) lock.keep();
          throw lock.lost.aborted && !signal?.aborted ? lockLostMessage() : err;
        }
      }
    );
    } finally { await finishLockWait("failed"); }
    return { memoryCapMb };
  } catch (err) {
    // Failed before or outside the lock (upload, canceled or refused while waiting): only our own files exist.
    if (!discarded) await discard();
    throw err;
  }
}
