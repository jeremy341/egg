import { createHash } from "node:crypto";
import { createWriteStream, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, statfsSync } from "node:fs";
import { spawn } from "node:child_process";
import { lstat, readdir, statfs } from "node:fs/promises";
import { devNull } from "node:os";
import { Transform } from "node:stream";
import { pipeline as pipelineStream } from "node:stream/promises";
import { StringDecoder } from "node:string_decoder";
import path from "node:path";
import * as tar from "tar";
import { config } from "@/server/config";
import {
  resolveRuntime,
  selectLockfile,
  type ProjectFiles,
  type RuntimeInput,
  type RuntimeSpec,
} from "@/server/deploy/runtime";
import { maskSecrets, secretNeedles } from "@/server/deploy/redact";
import { genericGitEnvironment, validateGitVersion } from "@/server/providers/generic";

export type LogFn = (level: "info" | "warn" | "error", message: string) => void;

export type BuildRequest = {
  deploymentId: string;
  runtime: RuntimeInput;
  rootDir: string;
  source: {
    cloneUrl: string;
    /** GitHub installation token for private repos. */
    token?: string | null;
    provider?: "github" | "generic";
    branch: string;
    sha?: string | null;
  };
  /** Variables for the build step. Never printed. */
  env: Record<string, string>;
  log: LogFn;
  signal?: AbortSignal;
  enableDownloadCache?: boolean;
};

export type BuildResult = {
  archivePath: string;
  npmLockHash?: string | null;
  sha256: string;
  sizeBytes: number;
  commit: { sha: string; message: string; author: string };
  spec: RuntimeSpec;
  files: ProjectFiles;
  /** Folder to delete when the deployment finishes. */
  workDir: string;
};

export type Builder = (req: BuildRequest) => Promise<BuildResult>;

export const MAX_ARCHIVE_BYTES = 500 * 1024 * 1024;
/** Also bound total source bytes and paths while packaging, not just final gzip size. */
export const MAX_SOURCE_UNPACKED_BYTES = 2 * 1024 * 1024 * 1024;
export const MAX_SOURCE_ENTRIES = 200_000;
/** The working tree plus git's own data (the .git folder) while cloning. */
export const MAX_CLONE_BYTES = MAX_SOURCE_UNPACKED_BYTES + MAX_ARCHIVE_BYTES;
/** Keep this much free on the disk that holds the work folder. */
export const MIN_FREE_BYTES = 1024 * 1024 * 1024;
/** How often the clone folder is measured while git runs. */
export const CLONE_WATCH_MS = 2000;

export class BuildError extends Error {}

const ALLOWED_GIT_HOSTS = ["github.com"];

/** Only clone https URLs from hosts we expect. Blocks file://, ssh and internal hosts. */
export function assertCloneUrl(url: string) {
  // git/curl and the WHATWG parser disagree about authority characters: a backslash
  // can be a path separator to URL but part of the host to git, and an @ can turn
  // what URL reads as a path into userinfo that changes where git connects. Refuse
  // the raw text before parsing so the two can never disagree about the host.
  if (url.includes("\\") || url.includes("@")) {
    throw new BuildError("Only plain https repository URLs without @ or \\ are supported.");
  }
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new BuildError("The repository URL is not valid.");
  }
  if (u.protocol !== "https:" || u.username || u.password) {
    throw new BuildError("Only plain https repository URLs are supported.");
  }
  if (!ALLOWED_GIT_HOSTS.includes(u.hostname.toLowerCase())) {
    throw new BuildError(
      `Repositories on ${u.hostname} are not supported yet. Supported: ${ALLOWED_GIT_HOSTS.join(", ")}.`
    );
  }
}

const within = (root: string, full: string) => full === root || full.startsWith(root + path.sep);

/**
 * Resolve a user-supplied folder inside `base`, refusing `..` escapes and
 * links. A cloned repository can hold a link to any path on this machine; the
 * folder that gets archived is read here, so the real location must stay inside
 * `base` too.
 */
export function resolveInside(base: string, rel: string): string {
  const full = path.resolve(base, rel || ".");
  const root = path.resolve(base);
  if (!within(root, full)) {
    throw new BuildError(`"${rel}" is outside the repository.`);
  }
  // The nearest part that exists decides where the rest would land.
  let probe = full;
  while (!existsSync(probe) && probe !== root) probe = path.dirname(probe);
  if (existsSync(probe) && !within(realpathSync(root), realpathSync(probe))) {
    throw new BuildError(`"${rel}" leads outside the repository.`);
  }
  return full;
}

const REF_BAD = /[\s\u0000-\u001f\u007f:?*[\\^~]/;

/** A branch name that is safe to hand to git: it cannot be read as an option and uses no revision syntax. */
export function assertGitRef(ref: string): string {
  if (
    typeof ref !== "string" ||
    ref.length === 0 ||
    ref.length > 200 ||
    ref.startsWith("-") ||
    ref.includes("..") ||
    ref.includes("@{") ||
    REF_BAD.test(ref)
  ) {
    throw new BuildError("The branch name is not valid.");
  }
  return ref;
}

/** A full commit hash (SHA-1 or SHA-256), the only thing we pass to `git fetch` by value. */
export function assertGitSha(sha: string): string {
  if (typeof sha !== "string" || !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i.test(sha)) {
    throw new BuildError("The commit hash is not valid.");
  }
  return sha.toLowerCase();
}

/** What a spawned git may inherit from the server: the executable path, the locale and the temp folder, and nothing else. */
const GIT_ENV_KEEP = /^(?:PATH|PATHEXT|LANG|LC_[A-Z_]+|HOME|USERPROFILE|TMPDIR|TEMP|TMP|SYSTEMROOT|SYSTEMDRIVE|COMSPEC)$/i;
/** No inherited Git, proxy or curl setting, the same protection the generic clone path applies. */
const GIT_ENV_DROP = /^(?:git_|.*proxy$|curl_)/i;

/**
 * Configure Git authentication through its environment, keeping the token out
 * of argv. The clone itself is of a repository somebody else chose, so git gets
 * a minimal environment with the server's own configuration, credentials and
 * secrets left out, just as `genericGitEnvironment` does for the generic path.
 */
export function gitEnvironment(token?: string | null): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const key of Object.keys(env)) {
    if (!GIT_ENV_KEEP.test(key) || GIT_ENV_DROP.test(key)) delete env[key];
  }
  env.GIT_CONFIG_NOSYSTEM = "1";
  env.GIT_CONFIG_GLOBAL = devNull;
  env.GIT_TERMINAL_PROMPT = "0";
  env.GIT_ASKPASS = "echo";
  if (token) {
    const basic = Buffer.from(`x-access-token:${token}`).toString("base64");
    env.GIT_CONFIG_COUNT = "1";
    env.GIT_CONFIG_KEY_0 = "http.https://github.com/.extraheader";
    env.GIT_CONFIG_VALUE_0 = `AUTHORIZATION: basic ${basic}`;
  }
  return env;
}

type RunOptions = {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  onLine?: (line: string) => void;
  timeoutMs?: number;
  signal?: AbortSignal;
};

/** Spawn a process, stream its output by line, and resolve with the exit code. */
export function runProcess(
  command: string,
  args: string[],
  opts: RunOptions = {}
): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: opts.cwd,
      env: opts.env ?? process.env,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let timedOut = false;
    const timer = opts.timeoutMs
      ? setTimeout(() => {
          timedOut = true;
          child.kill("SIGKILL");
        }, opts.timeoutMs)
      : undefined;
    const abort = () => {
      child.kill("SIGKILL");
    };
    opts.signal?.addEventListener("abort", abort, { once: true });

    const pump = (stream: NodeJS.ReadableStream) => {
      let buf = "";
      // Decode as a stream: a multi-byte character can straddle two chunks.
      const decoder = new StringDecoder("utf8");
      stream.on("data", (d: Buffer) => {
        buf += decoder.write(d);
        const parts = buf.split(/\r?\n/);
        buf = parts.pop() ?? "";
        for (const l of parts) if (l.length) opts.onLine?.(l);
      });
      stream.on("end", () => {
        buf += decoder.end();
        if (buf.length) opts.onLine?.(buf);
      });
    };
    pump(child.stdout);
    pump(child.stderr);

    child.on("error", (e) => {
      if (timer) clearTimeout(timer);
      reject(new BuildError(`Could not start ${command}: ${e.message}`));
    });
    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      opts.signal?.removeEventListener("abort", abort);
      if (timedOut) reject(new BuildError("The build timed out."));
      else if (opts.signal?.aborted) reject(new BuildError("The build was canceled."));
      else resolve(code ?? 1);
    });
  });
}

export function detectFiles(dir: string): ProjectFiles {
  const has = (f: string) => existsSync(path.join(dir, f));
  let hasBuildScript = false;
  let nodeEngine: string | null = null;
  let packageManager: unknown;
  const hasPackageJson = has("package.json");
  if (hasPackageJson) {
    try {
      // Only a regular, small file is read. A symlink to a device or a huge file must not be read into memory.
      const manifest = path.join(dir, "package.json");
      const stat = lstatSync(manifest);
      if (!stat.isFile() || stat.size > 1_000_000) throw new Error("package.json is not a small regular file");
      const pkg = JSON.parse(readFileSync(manifest, "utf8"));
      packageManager = pkg?.packageManager;
      hasBuildScript = typeof pkg?.scripts?.build === "string";
      if (typeof pkg?.engines?.node === "string") nodeEngine = pkg.engines.node.trim().slice(0, 200) || null;
    } catch {
      /* a broken package.json is reported by the build itself */
    }
  }
  return {
    lockfile: selectLockfile(has, packageManager),
    hasPackageJson,
    hasBuildScript,
    hasRequirements: has("requirements.txt"),
    hasPyproject: has("pyproject.toml"),
    hasGemfile: has("Gemfile"),
    hasComposer: has("composer.json"),
    hasCargoLock: has("Cargo.lock"),
    hasMaven: has("pom.xml"),
    hasGradle: has("build.gradle") || has("build.gradle.kts"),
    nodeEngine,
  };
}

function redactor(secrets: string[]) {
  const list = secretNeedles(secrets);
  return (line: string) => maskSecrets(line, list);
}

/** Refuse to silently substitute a branch tip for an explicitly requested commit. */
export function assertRequestedCommit(requested: string, actual: string): string {
  requested = assertGitSha(requested);
  assertGitSha(actual);
  if (actual.toLowerCase() !== requested.toLowerCase()) {
    throw new BuildError(`Could not build requested commit ${requested.slice(0, 7)}. The branch tip was not used.`);
  }
  return requested.toLowerCase();
}

/** Fetch, check out and re-verify one exact SHA before any build step runs. */
export async function ensureRequestedCommit(
  requested: string,
  ops: { readHead: () => Promise<string>; fetch: () => Promise<number>; checkout: () => Promise<number> }
): Promise<string> {
  requested = assertGitSha(requested);
  let actual = await ops.readHead();
  if (actual.toLowerCase() !== requested.toLowerCase()) {
    if ((await ops.fetch()) !== 0) {
      throw new BuildError(`Could not fetch requested commit ${requested.slice(0, 7)}. The branch tip was not used.`);
    }
    if ((await ops.checkout()) !== 0) {
      throw new BuildError(`The requested commit checkout failed for ${requested.slice(0, 7)}. The branch tip was not used.`);
    }
    actual = await ops.readHead();
  }
  return assertRequestedCommit(requested, actual);
}

export type CloneLimits = { maxBytes: number; minFreeBytes: number; intervalMs: number };

const NEARLY_FULL_MESSAGE = "Egg's disk is nearly full, so the repository was not cloned. Try again later.";

/** Bytes used by files under `dir`, not following symbolic links. Stops counting once the total passes `stopAt`. */
export function directorySize(dir: string, stopAt: number): number {
  let total = 0;
  const pending = [dir];
  while (pending.length) {
    const current = pending.pop()!;
    let names: string[];
    try {
      names = readdirSync(current);
    } catch {
      continue;
    }
    for (const name of names) {
      const full = path.join(current, name);
      let info;
      try {
        info = lstatSync(full);
      } catch {
        continue; // removed while reading
      }
      if (info.isSymbolicLink()) continue;
      if (info.isDirectory()) {
        pending.push(full);
      } else if (info.isFile()) {
        total += info.size;
        if (total > stopAt) return total;
      }
    }
  }
  return total;
}

/** Asynchronous traversal keeps large checkouts from blocking unrelated requests. */
export async function directorySizeAsync(dir: string, stopAt: number): Promise<number> {
  let total = 0;
  const pending = [dir];
  while (pending.length) {
    const current = pending.pop()!;
    let names: string[];
    try { names = await readdir(current); } catch { continue; }
    for (const name of names) {
      let info;
      const full = path.join(current, name);
      try { info = await lstat(full); } catch { continue; }
      if (info.isSymbolicLink()) continue;
      if (info.isDirectory()) pending.push(full);
      else if (info.isFile()) {
        total += info.size;
        if (total > stopAt) return total;
      }
    }
  }
  return total;
}

async function nearlyFullErrorAsync(dir: string, minFreeBytes: number): Promise<BuildError | null> {
  try {
    const fs = await statfs(dir);
    return fs.bavail * fs.bsize < minFreeBytes ? new BuildError(NEARLY_FULL_MESSAGE) : null;
  } catch { return null; }
}

/** A BuildError when the disk holding `dir` has less than `minFreeBytes` free. Null when it is fine or cannot be read. */
function nearlyFullError(dir: string, minFreeBytes: number): BuildError | null {
  let freeBytes: number;
  try {
    const fs = statfsSync(dir);
    freeBytes = fs.bavail * fs.bsize;
  } catch {
    return null;
  }
  return freeBytes < minFreeBytes ? new BuildError(NEARLY_FULL_MESSAGE) : null;
}

/**
 * Check `dir` every `limits.intervalMs`. Calls `onExceed` once and stops when the folder is over `maxBytes`
 * or the disk is below `minFreeBytes`.
 */
export function watchCloneSize(
  dir: string,
  limits: CloneLimits,
  onExceed: (error: BuildError) => void
): { stop(): void } {
  let diskTimer: NodeJS.Timeout | undefined;
  let sizeTimer: NodeJS.Timeout | undefined;
  let stopped = false;
  const stop = () => {
    stopped = true;
    if (diskTimer) clearTimeout(diskTimer);
    if (sizeTimer) clearTimeout(sizeTimer);
  };
  const exceed = (error: BuildError) => {
    if (stopped) return;
    stop();
    onExceed(error);
  };
  const checkDisk = async () => {
    const error = await nearlyFullErrorAsync(dir, limits.minFreeBytes);
    if (stopped) return;
    if (error) { exceed(error); return; }
    diskTimer = setTimeout(() => void checkDisk(), limits.intervalMs);
    diskTimer.unref();
  };
  const checkSize = async () => {
    const tooLarge = await directorySizeAsync(dir, limits.maxBytes) > limits.maxBytes;
    if (stopped) return;
    if (tooLarge) {
      exceed(new BuildError(`The repository is larger than ${Math.round(limits.maxBytes / (1024 * 1024))} MB, so it was not cloned.`));
      return;
    }
    sizeTimer = setTimeout(() => void checkSize(), limits.intervalMs);
    sizeTimer.unref();
  };
  diskTimer = setTimeout(() => void checkDisk(), limits.intervalMs);
  sizeTimer = setTimeout(() => void checkSize(), limits.intervalMs);
  diskTimer.unref();
  sizeTimer.unref();
  return { stop };
}

/**
 * Clone the repository into `srcDir` (the branch tip, or the exact commit asked for) and read the commit,
 * after the checks on the URL, branch and commit and before git runs. The work folder is watched while git
 * runs, and git is stopped if it grows past the limit or the disk runs low.
 */
export async function cloneSource(
  req: BuildRequest,
  srcDir: string,
  log: LogFn,
  line: (l: string) => void,
  limits: Partial<CloneLimits> = {}
): Promise<BuildResult["commit"]> {
  if (req.source.provider !== "generic") assertCloneUrl(req.source.cloneUrl);
  if (req.source.provider === "generic" && req.source.token) throw new BuildError("Generic Git supports public repositories only.");
  assertGitRef(req.source.branch);
  if (req.source.sha) assertGitSha(req.source.sha);
  const resolved: CloneLimits = {
    maxBytes: limits.maxBytes ?? MAX_CLONE_BYTES,
    minFreeBytes: limits.minFreeBytes ?? MIN_FREE_BYTES,
    intervalMs: limits.intervalMs ?? CLONE_WATCH_MS,
  };
  const workDir = path.dirname(srcDir);
  const lowDisk = nearlyFullError(workDir, resolved.minFreeBytes);
  if (lowDisk) throw lowDisk;

  log("info", `Cloning ${req.source.cloneUrl} (branch ${req.source.branch})`);
  const gitEnv = req.source.provider === "generic" ? await genericGitEnvironment(req.source.cloneUrl) : gitEnvironment(req.source.token);
  const watched: { error: BuildError | null } = { error: null };
  const controller = new AbortController();
  const signal = AbortSignal.any(
    [controller.signal, req.signal].filter((s): s is AbortSignal => s !== undefined)
  );
  const watcher = watchCloneSize(workDir, resolved, (error) => {
    watched.error = error;
    controller.abort();
  });
  try {
    if (req.source.provider === "generic") {
      const version: string[] = [];
      if (await runProcess("git", ["--version"], { env: gitEnv, onLine: (s) => version.push(s), timeoutMs: 10_000, signal }) !== 0) throw new BuildError("Could not check Git version.");
      validateGitVersion(version[0] ?? "");
      const refs: string[] = [];
      const branchRef = `refs/heads/${req.source.branch}`;
      if (await runProcess("git", ["ls-remote", "--exit-code", "--heads", "--", req.source.cloneUrl, branchRef], { env: gitEnv, onLine: (s) => refs.push(s), timeoutMs: 30_000, signal }) !== 0) throw new BuildError("Could not read the public repository branch.");
      const match = refs.map((line) => line.split(/\s+/)).find((parts) => parts[1] === branchRef);
      if (!match) throw new BuildError("Could not verify the public repository branch.");
      req = { ...req, source: { ...req.source, sha: req.source.sha ?? assertGitSha(match[0]) } };
    }
    let cloneCode: number;
    try {
      cloneCode = await runProcess(
        "git",
        [
          "clone",
          "--depth",
          "1",
          "--branch",
          req.source.branch,
          "--single-branch",
          "--no-tags",
          "--",
          req.source.cloneUrl,
          srcDir,
        ],
        { env: gitEnv, onLine: line, timeoutMs: 5 * 60_000, signal }
      );
    } catch (error) {
      throw watched.error ?? error;
    }
    if (watched.error) throw watched.error;
    if (cloneCode !== 0) {
      throw new BuildError(
        "Could not clone the repository. Check the branch name and that Egg has access to it."
      );
    }

    if (req.source.sha) {
      try {
        await ensureRequestedCommit(req.source.sha, {
          readHead: async () => {
            const output: string[] = [];
            const code = await runProcess("git", ["rev-parse", "HEAD"], {
              cwd: srcDir,
              env: gitEnv,
              onLine: (l) => output.push(l.trim()),
              timeoutMs: 30_000,
              signal: req.signal,
            });
            if (code !== 0 || !output[0]) throw new BuildError("Could not verify the requested commit. The branch tip was not used.");
            return output[0];
          },
          fetch: () => runProcess("git", ["fetch", "--depth", "1", "origin", assertGitSha(req.source.sha!)], {
            cwd: srcDir,
            env: gitEnv,
            onLine: line,
            timeoutMs: 3 * 60_000,
            signal,
          }),
          checkout: () => runProcess("git", ["checkout", "--detach", "FETCH_HEAD"], {
            cwd: srcDir,
            env: gitEnv,
            onLine: line,
            timeoutMs: 30_000,
            signal,
          }),
        });
      } catch (error) {
        throw watched.error ?? error;
      }
    }
  } finally {
    watcher.stop();
  }

  // A short clone can finish between watchdog ticks, or while a scan is in flight.
  // Check once more before accepting it, after stopping the periodic scanner.
  const finalLowDisk = await nearlyFullErrorAsync(workDir, resolved.minFreeBytes);
  if (finalLowDisk) throw finalLowDisk;
  if (await directorySizeAsync(workDir, resolved.maxBytes) > resolved.maxBytes) {
    throw new BuildError(`The repository is larger than ${Math.round(resolved.maxBytes / (1024 * 1024))} MB, so it was not cloned.`);
  }

  const info: string[] = [];
  const commitCode = await runProcess("git", ["log", "-1", "--format=%H%n%an%n%s"], {
    cwd: srcDir,
    env: gitEnv,
    onLine: (l) => info.push(l),
  });
  // An empty repository has no commits to anchor the deployment to: fail cleanly
  // instead of recording an empty commit.
  if (commitCode !== 0 || !info[0]) {
    throw new BuildError(`No commits found on branch ${req.source.branch}.`);
  }
  const commit = {
    sha: info[0] ?? "",
    author: info[1] ?? "",
    message: info.slice(2).join(" ").slice(0, 300),
  };
  log("info", `Commit ${commit.sha.slice(0, 7)}: ${commit.message}`);
  return commit;
}

/** Pack `root` into a gzipped tar and refuse one over the size limit. Returns the size in bytes. */
export async function packArchiveWithHash(
  root: string,
  archivePath: string,
  excludeNodeModules: boolean,
  what: string,
  log: LogFn,
  limits: { maxArchiveBytes?: number; maxUnpackedBytes?: number; maxEntries?: number } = {}
): Promise<{ sizeBytes: number; sha256: string }> {
  const hash = createHash("sha256");
  const maxArchiveBytes = limits.maxArchiveBytes ?? MAX_ARCHIVE_BYTES;
  const maxUnpackedBytes = limits.maxUnpackedBytes ?? MAX_SOURCE_UNPACKED_BYTES;
  const maxEntries = limits.maxEntries ?? MAX_SOURCE_ENTRIES;
  let unpackedBytes = 0;
  let entries = 0;
  let size = 0;
  const included = new Set<string>();
  const cap = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      size += chunk.length;
      hash.update(chunk);
      if (size > maxArchiveBytes) {
        callback(new BuildError(`${what} compressed source archive exceeds the ${maxArchiveBytes} byte limit.`));
      } else callback(null, chunk);
    },
  });
  let limitError: BuildError | null = null;
  // The filter runs after an asynchronous stat, so `pack` is always assigned by the time it is used.
  const pack: tar.Pack = tar.create({
    gzip: true,
    cwd: root,
    portable: true,
    filter: (p, entry) => {
      const normalized = p.replace(/^\.\//, "").replace(/\\/g, "/");
      const parts = normalized.split("/");
      if (parts[0] === ".git") return false;
      if (excludeNodeModules && parts.includes("node_modules")) return false;
      if (parts[0] === ".next" && parts[1] === "cache") return false;
      if (included.has(normalized)) return true;
      included.add(normalized);
      entries++;
      if (entries > maxEntries) {
        limitError = new BuildError(`${what} contains more than ${maxEntries} source entries.`);
        pack.destroy(limitError);
        return false;
      }
      if ("isFile" in entry && entry.isFile()) {
        unpackedBytes += entry.size;
        if (unpackedBytes > maxUnpackedBytes) {
          limitError = new BuildError(`${what} exceeds the ${maxUnpackedBytes} byte unpacked source limit.`);
          pack.destroy(limitError);
          return false;
        }
      }
      return true;
    },
  }, ["."]);
  try {
    await pipelineStream(pack, cap, createWriteStream(archivePath, { flags: "wx", mode: 0o600 }));
  } catch (error) {
    rmSync(archivePath, { force: true });
    if (limitError) throw limitError;
    if (error instanceof BuildError) throw error;
    throw new BuildError(`${what} could not be packaged safely: ${error instanceof Error ? error.message : "unknown error"}`);
  }
  log("info", `Packed source: ${(size / 1e6).toFixed(1)} MB`);
  return { sizeBytes: size, sha256: hash.digest("hex") };
}

/** Compatibility wrapper for callers that only need the byte count. */
export async function packArchive(
  root: string, archivePath: string, excludeNodeModules: boolean, what: string, log: LogFn,
  limits: { maxArchiveBytes?: number; maxUnpackedBytes?: number; maxEntries?: number } = {}
): Promise<number> {
  return (await packArchiveWithHash(root, archivePath, excludeNodeModules, what, log, limits)).sizeBytes;
}

/**
 * Clone and pack the source only. No install and no build run on this machine: the archive is the
 * project folder as it is in the repository, and the build runs later on the Nest container.
 * The GitHub token is used for the clone here and never leaves this machine.
 */
export const defaultSourceBuilder: Builder = async (req) => {
  const c = config();
  const workDir = path.resolve(c.DEPLOY_WORK_DIR, req.deploymentId);
  const srcDir = path.join(workDir, "src");
  mkdirSync(workDir, { recursive: true });

  const basicAuth = req.source.token
    ? Buffer.from(`x-access-token:${req.source.token}`).toString("base64")
    : "";
  const redact = redactor([req.source.token ?? "", basicAuth, ...Object.values(req.env)]);
  const log: LogFn = (level, msg) => req.log(level, redact(msg));
  const line = (l: string) => log("info", l);

  try {
    const commit = await cloneSource(req, srcDir, log, line);

    const appDir = resolveInside(srcDir, req.rootDir);
    if (!existsSync(appDir)) {
      throw new BuildError(`The root directory "${req.rootDir}" does not exist in this repository.`);
    }
    const files = detectFiles(appDir);
    const spec = resolveRuntime(req.runtime, files);
    let npmLockHash: string | null = null;
    if (req.enableDownloadCache && files.lockfile === "npm" && spec.buildInstall === "npm ci") {
      try {
        const lock = path.join(appDir, "package-lock.json");
        const stat = lstatSync(lock);
        if (stat.isFile() && !stat.isSymbolicLink() && stat.size <= 16 * 1024 * 1024) {
          npmLockHash = createHash("sha256").update(readFileSync(lock)).digest("hex");
        }
      } catch { /* A missing or unreadable lockfile disables the optional cache. */ }
    }
    // The output folder is made by the build on the container; one that leads outside the project is refused now.
    resolveInside(appDir, spec.archiveRoot);

    const archivePath = path.join(workDir, "source.tar.gz");
    const packed = await packArchiveWithHash(appDir, archivePath, spec.excludeNodeModules, "The source", log);
    return {
      archivePath,
      npmLockHash,
      sha256: packed.sha256,
      sizeBytes: packed.sizeBytes,
      commit,
      spec,
      files,
      workDir,
    };
  } catch (err) {
    // A stopped git can leave a child writing for a moment, so retry, and never let a failed
    // cleanup replace the real error.
    try {
      rmSync(workDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    } catch {
      log("warn", "Could not remove the work folder of this deployment.");
    }
    throw err;
  }
};
