#!/usr/bin/env node
// `pnpm quickstart` (or `node scripts/quickstart.mjs`): get Egg running locally in one command.
//
//   1. Check the Node.js and pnpm prerequisites.
//   2. Install dependencies when node_modules is missing.
//   3. Create .env.local with the password-only (LOCAL_MODE) setup when it is missing.
//   4. Print the local address and the next step.
//
// Pass --start to also run the development server. Safe to re-run: it never overwrites
// .env.local and skips work that is already done. Everything that touches the machine lives
// in `deps`, so the steps can be exercised with fakes.

import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_APP_URL,
  checkNode,
  checkPnpm,
  parseEnvFile,
  resolveServer,
} from "./doctor-checks.mjs";
import { WEB_DIR, realProbes } from "./doctor.mjs";

export const USAGE = `Egg local quickstart

Usage: node scripts/quickstart.mjs [--start] [--help]

  --start   Run the development server once setup is done.
  --help    Show this help.

Creates .env.local if needed and never overwrites one that exists.
`;

/** Parse the two flags. Unknown flags are an error rather than being silently ignored. */
export function parseArgs(argv = []) {
  let start = false;
  let help = false;
  for (const arg of argv) {
    if (arg === "--start") start = true;
    else if (arg === "--help" || arg === "-h") help = true;
    else return { ok: false, message: `Unknown option ${arg}.` };
  }
  return { ok: true, start, help };
}

/**
 * The command used to invoke pnpm. On Windows pnpm is pnpm.cmd, which Node only starts
 * through a shell (the same workaround doctor.mjs uses). The arguments here are fixed.
 */
export function pnpmCommand(args, platform = process.platform) {
  return platform === "win32"
    ? { command: `pnpm ${args.join(" ")}`, args: [], shell: true }
    : { command: "pnpm", args, shell: false };
}

function enginesNode(webDir) {
  try {
    return JSON.parse(readFileSync(path.join(webDir, "package.json"), "utf8"))?.engines?.node;
  } catch {
    return undefined;
  }
}

function installSync(args, webDir, platform) {
  const { command, args: pnpmArgs, shell } = pnpmCommand(args, platform);
  const result = spawnSync(command, pnpmArgs, { cwd: webDir, stdio: "inherit", shell });
  if (result.error) throw result.error;
  return result.status ?? 1;
}

/** Start a long-running pnpm command and forward stop signals, as egg-start.mjs does. */
function spawnPnpm(args, webDir, platform) {
  const { command, args: pnpmArgs, shell } = pnpmCommand(args, platform);
  const child = spawn(command, pnpmArgs, { cwd: webDir, stdio: "inherit", shell });
  const forward = (signal) => () => child.kill(signal);
  const onInt = forward("SIGINT");
  const onTerm = forward("SIGTERM");
  process.on("SIGINT", onInt);
  process.on("SIGTERM", onTerm);
  const exited = new Promise((resolve) => {
    const done = (code) => {
      process.off("SIGINT", onInt);
      process.off("SIGTERM", onTerm);
      resolve(code);
    };
    child.once("error", () => done(1));
    child.once("exit", (code, signal) => done(code ?? (signal ? 128 : 1)));
  });
  return { exited, stop: () => child.kill("SIGTERM") };
}

function readEnvValues(file) {
  try {
    return parseEnvFile(readFileSync(file, "utf8"));
  } catch {
    return {};
  }
}

/** The real machine calls. Tests replace the ones they do not want to run. */
export const realDeps = {
  out: (text) => process.stdout.write(text),
  existsSync,
  nodeVersion: () => process.versions.node,
  pnpmVersion: () => realProbes.pnpmVersion(),
  enginesNode,
  readEnvValues,
  // setup.mjs checks for an existing file itself, so this cannot overwrite .env.local.
  runSetup: (webDir) => spawnSync(process.execPath, [path.join(webDir, "scripts", "setup.mjs")], { cwd: webDir, stdio: "inherit" }).status ?? 1,
  runInstall: (webDir, platform) => installSync(["install"], webDir, platform),
  startDev: (webDir, platform) => spawnPnpm(["dev"], webDir, platform),
};

/**
 * Where Egg will listen, from .env.local overlaid with the real environment, as Next does.
 * Returns { url, warning }: a bad APP_URL falls back to the default address with a warning.
 */
export function localUrl(file, env = process.env, deps = realDeps) {
  const values = deps.readEnvValues(file);
  const merged = { ...values, ...Object.fromEntries(Object.entries(env).filter(([, v]) => v !== undefined)) };
  const server = resolveServer(merged.APP_URL);
  return server.ok
    ? { url: server.url, warning: "" }
    : { url: DEFAULT_APP_URL, warning: `${server.message}. Using ${DEFAULT_APP_URL} instead.` };
}

const checkLine = (result) => `${result.ok ? "✓" : "✗"} ${result.name}: ${result.message}${result.ok || !result.fix ? "" : `\n    Fix: ${result.fix}`}\n`;

/**
 * Run the quickstart and return the exit code: 0 when setup finished, 1 when a step failed,
 * 2 for a bad command line. With --start the code is the development server's exit code.
 */
export async function quickstart({
  webDir = WEB_DIR,
  argv = [],
  env = process.env,
  platform = process.platform,
  out,
  deps: given = {},
} = {}) {
  const deps = { ...realDeps, ...given };
  const emit = out ?? given.out ?? (given.stdout ? (text) => given.stdout.write(text) : realDeps.out);
  deps.out = emit;

  const parsed = parseArgs(argv);
  if (!parsed.ok) {
    emit(`${parsed.message}\n\n${USAGE}`);
    return 2;
  }
  if (parsed.help) {
    emit(USAGE);
    return 0;
  }

  emit("Egg local quickstart\n");

  const node = checkNode({ version: deps.nodeVersion(), range: deps.enginesNode(webDir) });
  const pnpm = checkPnpm({ version: deps.pnpmVersion() });
  emit(checkLine(node));
  emit(checkLine(pnpm));
  if (!node.ok || !pnpm.ok) {
    emit("Fix the lines above, then run the quickstart again.\n");
    return 1;
  }

  if (!deps.existsSync(path.join(webDir, "node_modules"))) {
    emit("Installing dependencies with pnpm install...\n");
    const code = deps.runInstall(webDir, platform);
    if (code !== 0) {
      emit("Install failed. Fix the error above and run the quickstart again.\n");
      return 1;
    }
  } else {
    emit("Dependencies are already installed.\n");
  }

  const envFile = path.join(webDir, ".env.local");
  if (deps.existsSync(envFile)) {
    emit(".env.local already exists, leaving it alone.\n");
  } else {
    emit("Creating .env.local with a local sign-in password...\n");
    const code = deps.runSetup(webDir);
    if (code !== 0) {
      emit("Setup failed. Fix the error above and run the quickstart again.\n");
      return 1;
    }
  }

  const { url, warning } = localUrl(envFile, env, deps);
  if (warning) emit(`${warning}\n`);
  emit(`\nEgg is ready at ${url}\n`);

  if (parsed.start) {
    emit(`Starting the development server. Open ${url} and sign in with the LOCAL_MODE_SECRET in .env.local.\n`);
    const server = await deps.startDev(webDir, platform);
    // The real launcher returns { exited, stop } like egg-start.mjs; a fake may just return a code.
    return server && typeof server === "object" && "exited" in server ? await server.exited : server;
  }
  emit("Next: run the quickstart again with --start (or run pnpm dev) to start Egg.\n");
  emit(`Then open ${url} and sign in with the LOCAL_MODE_SECRET in .env.local.\n`);
  return 0;
}

/** Alias matching doctorCommand / startEgg naming. */
export const quickstartCommand = quickstart;

/** CLI-shaped entry: run(argv, deps), like egg-cli's run(). */
export function run(argv = [], deps = {}) {
  return quickstart({
    argv,
    env: deps.env ?? process.env,
    webDir: deps.webDir ?? WEB_DIR,
    platform: deps.platform ?? process.platform,
    stdout: deps.stdout,
    deps,
  });
}

function isMain() {
  try {
    return Boolean(process.argv[1]) && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isMain()) {
  quickstart({ argv: process.argv.slice(2) }).then(
    (code) => {
      process.exitCode = code;
    },
    (error) => {
      process.stderr.write(`Error: ${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    }
  );
}
