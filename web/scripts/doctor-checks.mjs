// The checks behind `pnpm run doctor`. Every check is a pure function: it takes what it needs
// as arguments and returns a result, so the unit tests need no real machine state. The few
// functions that do touch the machine (a TCP listen, a temp file) are marked as probes and take
// their dependencies as arguments too.
//
// A result is { ok, name, message, fix, severity }. `severity` says what a failure means:
// "blocker" stops `egg start`, "warning" is shown but does not stop anything. `fix` is one line
// and is empty when the check passed.

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** What the app needs when package.json has no `engines.node`. */
export const DEFAULT_NODE_RANGE = ">=22.13.0";
export const DEFAULT_APP_URL = "http://localhost:3000";
export const DEFAULT_DATABASE_URL = "file:./data/egg.db";
/** The port `next start` uses when APP_URL does not name one. */
export const DEFAULT_PORT = 3000;
export const MIN_SECRET_LENGTH = 32;

const result = (name, ok, severity, message, fix = "") => ({ ok, name, message, fix: ok ? "" : fix, severity });

// ------------------------------------------------------------- parsing helpers

/** Read the KEY=value lines of a .env file. Handles quotes, comments and `export`. */
export function parseEnvFile(text) {
  const env = {};
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    let value = match[2];
    const quote = value[0];
    if (quote === '"' || quote === "'" || quote === "`") {
      const end = value.indexOf(quote, 1);
      value = end === -1 ? value.slice(1) : value.slice(1, end);
    } else {
      value = value.replace(/\s+#.*$/, "").trim();
    }
    env[match[1]] = value;
  }
  return env;
}

const isLoopbackHost = (hostname) => {
  const host = hostname.replace(/^\[|\]$/g, "");
  return host === "localhost" || host === "::1" || /^127(\.\d{1,3}){3}$/.test(host);
};

/**
 * Where the server listens, from APP_URL. An explicit port wins. With no port the URL points at
 * a proxy (https://egg.example.com), so the app itself listens on Next's default, 3000.
 * A loopback address binds to 127.0.0.1 only, so a copy meant for one computer is not open
 * to the whole network. Returns { ok: true, port, host, url } or { ok: false, message }.
 */
export function resolveServer(appUrl) {
  const text = String(appUrl ?? "").trim() || DEFAULT_APP_URL;
  let url;
  try {
    url = new URL(text);
  } catch {
    return { ok: false, message: `APP_URL "${text}" is not a web address` };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, message: `APP_URL "${text}" must start with http:// or https://` };
  }
  const loopback = isLoopbackHost(url.hostname);
  const explicit = url.port !== "";
  const port = explicit ? Number(url.port) : DEFAULT_PORT;
  if (loopback && !explicit) url.port = String(port);
  const host = loopback ? (url.hostname === "[::1]" ? "::1" : "127.0.0.1") : null;
  return { ok: true, port, host, url: url.origin };
}

/** The port from APP_URL, or null when APP_URL is not a web address. */
export function portFromAppUrl(appUrl) {
  const server = resolveServer(appUrl);
  return server.ok ? server.port : null;
}

/** Extra arguments for `next start` / `next dev` that match APP_URL. */
export function serverArgs(server) {
  return ["-p", String(server.port), ...(server.host ? ["-H", server.host] : [])];
}

/**
 * The folder that holds the database file, or null when DATABASE_URL is not a file: URL (or is
 * in memory). A relative path is relative to `cwd`, which is the web folder: the database layer
 * resolves it the same way.
 */
export function dataDirFromDatabaseUrl(databaseUrl, cwd) {
  const url = String(databaseUrl ?? "").trim() || DEFAULT_DATABASE_URL;
  if (!url.startsWith("file:") || url.startsWith("file::memory:")) return null;
  let file;
  if (url.startsWith("file://")) {
    try {
      file = fileURLToPath(url);
    } catch {
      file = url.slice("file:".length);
    }
  } else {
    file = url.slice("file:".length).split("?")[0];
  }
  return path.dirname(path.resolve(cwd, file));
}

// --------------------------------------------------------------- node version

const parseVersion = (text) => {
  const match = /^v?(\d+)\.(\d+)\.(\d+)/.exec(String(text));
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
};

const compare = (a, b) => {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  return 0;
};

const COMPARATOR = /(>=|<=|>|<|=|\^|~)?\s*v?(\d+)(?:\.(\d+|x|\*))?(?:\.(\d+|x|\*))?/g;

/** One comparator as a list of [lower, upper) bounds, either of which may be null. */
function bounds(op, major, minorText, patchText) {
  const wild = (t) => t === undefined || t === "x" || t === "*";
  const minorWild = wild(minorText);
  const patchWild = minorWild || wild(patchText);
  const minor = minorWild ? 0 : Number(minorText);
  const patch = patchWild ? 0 : Number(patchText);
  const low = [major, minor, patch];
  const partialUpper = minorWild ? [major + 1, 0, 0] : [major, minor + 1, 0];
  if (op === "" || op === "=") return [low, patchWild ? partialUpper : [major, minor, patch + 1]];
  if (op === "^") {
    if (major > 0 || minorWild) return [low, [major + 1, 0, 0]];
    return [low, minor > 0 || patchWild ? [0, minor + 1, 0] : [0, 0, patch + 1]];
  }
  if (op === "~") return [low, partialUpper];
  if (op === ">=") return [low, null];
  if (op === ">") return patchWild ? [partialUpper, null] : [[major, minor, patch + 1], null];
  if (op === "<=") return [null, patchWild ? partialUpper : [major, minor, patch + 1]];
  return [null, low]; // "<"
}

/**
 * Does `version` satisfy `range`? Understands the forms an `engines` field normally uses
 * (>=, >, <=, <, =, ^, ~, x-ranges, spaces for "and", || for "or"). Returns true or false, or
 * null when the range uses something this small parser does not know.
 */
export function satisfiesRange(version, range) {
  const v = parseVersion(version);
  if (!v) return null;
  for (const alternative of String(range).split("||")) {
    const matches = [...alternative.matchAll(COMPARATOR)];
    const leftover = alternative.replace(COMPARATOR, "").trim();
    if (matches.length === 0 || leftover !== "") return null;
    const allMet = matches.every(([, op = "", major, minor, patch]) => {
      const [low, high] = bounds(op, Number(major), minor, patch);
      return (low === null || compare(v, low) >= 0) && (high === null || compare(v, high) < 0);
    });
    if (allMet) return true;
  }
  return false;
}

/** `version` is process.versions.node. `range` is engines.node from package.json, if any. */
export function checkNode({ version, range }) {
  const name = "Node.js";
  let wanted = typeof range === "string" && range.trim() ? range.trim() : DEFAULT_NODE_RANGE;
  let verdict = satisfiesRange(version, wanted);
  if (verdict === null && wanted !== DEFAULT_NODE_RANGE) {
    wanted = DEFAULT_NODE_RANGE;
    verdict = satisfiesRange(version, wanted);
  }
  if (verdict === null) return result(name, false, "blocker", `Could not read the Node version "${version}"`, "Install Node.js from https://nodejs.org");
  if (verdict) return result(name, true, "blocker", `${version} (needs ${wanted})`);
  return result(name, false, "blocker", `${version} is too old (needs ${wanted})`, "Install a newer Node.js from https://nodejs.org, then run this again.");
}

// ----------------------------------------------------------------------- pnpm

/** `version` is the output of `pnpm --version`, or null when pnpm could not be run. */
export function checkPnpm({ version }) {
  const name = "pnpm";
  const text = typeof version === "string" ? version.trim() : "";
  if (text) return result(name, true, "warning", `${text}`);
  return result(name, false, "warning", "pnpm was not found on the PATH", "Run `corepack enable` (comes with Node), or install it from https://pnpm.io/installation");
}

// ------------------------------------------------------------- .env.local file

/** `exists`: is .env.local there. `env`: the merged settings (file plus real environment). */
export function checkEnvFile({ exists, env }) {
  const name = "Settings file";
  if (!exists) {
    return result(name, false, "blocker", ".env.local is missing", "Run `pnpm run setup` to create it with a new APP_SECRET.");
  }
  const secret = String(env?.APP_SECRET ?? "").trim();
  if (!secret) {
    return result(name, false, "blocker", "APP_SECRET is not set in .env.local", "Add a line APP_SECRET=<32 or more random characters>, or delete .env.local and run `pnpm run setup`.");
  }
  if (secret.length < MIN_SECRET_LENGTH) {
    return result(name, false, "blocker", `APP_SECRET is ${secret.length} characters (needs at least ${MIN_SECRET_LENGTH})`, "Use a longer APP_SECRET. Changing it makes saved SSH keys and variables unreadable, so back up the old one first.");
  }
  return result(name, true, "blocker", ".env.local found, APP_SECRET is set");
}

// ----------------------------------------------------------------------- port

/**
 * `server` comes from resolveServer. `free` is true, or false, or an error code string such as
 * "EADDRINUSE" or "EACCES" from the listen attempt.
 */
export function checkPort({ server, free }) {
  const name = "Port";
  if (!server.ok) return result(name, false, "blocker", server.message, "Set APP_URL in .env.local, for example APP_URL=http://localhost:3000");
  const { port } = server;
  if (free === true) return result(name, true, "blocker", `${port} is free`);
  if (free === "EACCES") {
    return result(name, false, "blocker", `Not allowed to listen on port ${port}`, "Use a port above 1024: set APP_URL=http://localhost:3000 in .env.local.");
  }
  if (typeof free === "string" && free !== "EADDRINUSE") {
    return result(name, false, "blocker", `Could not use port ${port} (${free})`, "Pick another port in APP_URL in .env.local.");
  }
  return result(name, false, "blocker", `Port ${port} is already in use`, `Stop the other program on port ${port}, or set a different port in APP_URL in .env.local.`);
}

/** Probe: can a TCP server listen on this port? Resolves true, or an error code string. */
export function isPortFree(port, host, listen = net) {
  return new Promise((resolve) => {
    const server = listen.createServer();
    server.once("error", (error) => resolve(error && typeof error.code === "string" ? error.code : "ERROR"));
    server.once("listening", () => server.close(() => resolve(true)));
    server.listen(port, host ?? undefined);
  });
}

// ---------------------------------------------------------------- data folder

/**
 * `dir` is the data folder, or null when the database is not a file. `probe` is the result of
 * probeDirectory: { exists, writable, error }.
 */
export function checkDataFolder({ dir, probe }) {
  const name = "Data folder";
  if (dir === null) return result(name, true, "blocker", "Not a file database, so there is no data folder to check");
  if (probe.writable) return result(name, true, "blocker", `${dir} is writable`);
  const why = probe.error ? ` (${probe.error})` : "";
  return result(name, false, "blocker", `${dir} ${probe.exists ? "is not writable" : "cannot be created"}${why}`, "Change DATABASE_URL in .env.local to a folder you can write to, or fix the folder's permissions.");
}

/**
 * Probe: create the folder if it is missing (the app would do the same on its first start), then
 * write and delete a temp file in it. `fs` is replaceable for tests.
 */
export function probeDirectory(dir, fs = { mkdirSync, writeFileSync, rmSync }) {
  const probeFile = path.join(dir, `.egg-doctor-${process.pid}-${Date.now()}.tmp`);
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (error) {
    return { exists: false, writable: false, error: errorCode(error) };
  }
  try {
    fs.writeFileSync(probeFile, "ok");
    fs.rmSync(probeFile, { force: true });
    return { exists: true, writable: true, error: null };
  } catch (error) {
    return { exists: true, writable: false, error: errorCode(error) };
  }
}

const errorCode = (error) => (error && typeof error.code === "string" ? error.code : error instanceof Error ? error.message : "unknown error");

// --------------------------------------------------------------------- docker

/**
 * `runner` is BUILD_RUNNER (docker when unset). `dockerWorks` is whether `docker info` succeeded.
 * A missing Docker only matters for the first build, so it is a warning, never a blocker.
 */
export function checkDocker({ runner, dockerWorks }) {
  const name = "Docker";
  const mode = String(runner ?? "").trim() || "docker";
  if (mode !== "docker" && mode !== "local") {
    return result(name, false, "blocker", `BUILD_RUNNER is "${mode}"`, "Set BUILD_RUNNER=docker or BUILD_RUNNER=local in .env.local.");
  }
  if (mode === "local") return result(name, true, "warning", "BUILD_RUNNER=local: builds run on this computer, so only deploy code you trust");
  if (dockerWorks) return result(name, true, "warning", "Docker is running");
  return result(name, false, "warning", "Docker is not running. Builds need Docker, or BUILD_RUNNER=local", "Start Docker Desktop (or the Docker service), or set BUILD_RUNNER=local in .env.local. Egg itself starts without it.");
}

// ------------------------------------------------------------ system and misc

const OS_NAMES = { win32: "Windows", darwin: "macOS", linux: "Linux" };

/** Never a blocker: it only reports which system this is. */
export function checkOs({ platform }) {
  const name = "Operating system";
  const known = OS_NAMES[platform];
  if (known) return result(name, true, "warning", known);
  return result(name, false, "warning", `${platform} is not tested`, "Egg is tested on Windows, macOS and Linux. It may still work here.");
}

export function checkDatabaseUrl({ url }) {
  const name = "Database";
  const text = String(url ?? "").trim() || DEFAULT_DATABASE_URL;
  if (text.startsWith("file::memory:")) {
    return result(name, false, "warning", "DATABASE_URL is in memory: everything is lost when Egg stops", "Use DATABASE_URL=file:./data/egg.db to keep your data on disk.");
  }
  if (text.startsWith("file:")) return result(name, true, "warning", `${text} (one file, migrations run on start)`);
  return result(name, false, "warning", "DATABASE_URL is not a file: URL, so this check cannot test saving to disk", "Use DATABASE_URL=file:./data/egg.db for a database on this computer.");
}

/**
 * Can anyone sign in? A production build ignores DEV_LOGIN, so a fresh `pnpm run setup` file
 * alone gives no way in. `dev` is true when started with --dev.
 */
export function checkSignIn({ env, dev }) {
  const name = "Sign-in";
  const on = (key) => String(env?.[key] ?? "").trim() === "1";
  const set = (key) => String(env?.[key] ?? "").trim() !== "";
  if (on("LOCAL_MODE")) return result(name, true, "warning", "LOCAL_MODE=1: sign in on this computer");
  if (set("HACKCLUB_CLIENT_ID") && set("HACKCLUB_CLIENT_SECRET")) return result(name, true, "warning", "Sign-in with Hack Club Auth is set up");
  if (dev && on("DEV_LOGIN")) return result(name, true, "warning", "DEV_LOGIN=1 (development sign-in)");
  return result(name, false, "warning", "No way to sign in is set up", "Add LOCAL_MODE=1 to .env.local to sign in on this computer, or set the Hack Club Auth keys.");
}

// --------------------------------------------------------------------- output

export const hasBlocker = (results) => results.some((r) => !r.ok && r.severity === "blocker");

/** Plain text, one line per check, the fix on the line below a failure. */
export function formatResults(results) {
  const lines = [];
  for (const r of results) {
    const mark = r.ok ? "✓" : r.severity === "blocker" ? "✗" : "!";
    lines.push(`${mark} ${r.name}: ${r.message}`);
    if (!r.ok && r.fix) lines.push(`    Fix: ${r.fix}`);
  }
  const blockers = results.filter((r) => !r.ok && r.severity === "blocker").length;
  const warnings = results.filter((r) => !r.ok && r.severity !== "blocker").length;
  lines.push("");
  if (blockers > 0) lines.push(`${blockers} problem${blockers === 1 ? "" : "s"} to fix before Egg can start.`);
  else if (warnings > 0) lines.push(`Ready to start, with ${warnings} warning${warnings === 1 ? "" : "s"}.`);
  else lines.push("All checks passed.");
  return lines.join("\n") + "\n";
}
