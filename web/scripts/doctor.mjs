#!/usr/bin/env node
// `pnpm run doctor`: checks that this computer can run Egg and prints one fix per problem.
// Exit code 1 only when something blocks starting (see doctor-checks.mjs); warnings exit 0.
// The checks live in doctor-checks.mjs. This file reads the real machine and passes the facts in.

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  checkDatabaseUrl,
  checkDataFolder,
  checkEnvFile,
  checkNode,
  checkOs,
  checkPnpm,
  checkPort,
  checkSignIn,
  dataDirFromDatabaseUrl,
  formatResults,
  hasBlocker,
  isPortFree,
  parseEnvFile,
  probeDirectory,
  resolveServer,
} from "./doctor-checks.mjs";

export const WEB_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** The commands doctor runs against the machine. Tests replace them. */
export const realProbes = {
  pnpmVersion() {
    // On Windows pnpm is pnpm.cmd, which Node only starts through a shell. The command is a fixed string.
    const r =
      process.platform === "win32"
        ? spawnSync("pnpm --version", { encoding: "utf8", timeout: 15000, shell: true })
        : spawnSync("pnpm", ["--version"], { encoding: "utf8", timeout: 15000 });
    return r.status === 0 ? String(r.stdout).trim() : null;
  },
  portFree: isPortFree,
  directory: probeDirectory,
};

function readEnvFile(file) {
  try {
    return { exists: true, values: parseEnvFile(readFileSync(file, "utf8")) };
  } catch {
    return { exists: existsSync(file), values: {} };
  }
}

function enginesNode(webDir) {
  try {
    const pkg = JSON.parse(readFileSync(path.join(webDir, "package.json"), "utf8"));
    return pkg?.engines?.node;
  } catch {
    return undefined;
  }
}

/**
 * Run every check. Returns { results, server, env }: `server` is where the app will listen
 * (from resolveServer), `env` is .env.local overlaid with the real environment, as Next does.
 */
export async function runDoctor({ webDir = WEB_DIR, env = process.env, platform = process.platform, nodeVersion = process.versions.node, dev = false, probes = realProbes } = {}) {
  const file = readEnvFile(path.join(webDir, ".env.local"));
  const merged = { ...file.values, ...Object.fromEntries(Object.entries(env).filter(([, v]) => v !== undefined)) };
  const server = resolveServer(merged.APP_URL);
  const dir = dataDirFromDatabaseUrl(merged.DATABASE_URL, webDir);

  const results = [
    checkNode({ version: nodeVersion, range: enginesNode(webDir) }),
    checkPnpm({ version: probes.pnpmVersion() }),
    checkEnvFile({ exists: file.exists, env: merged }),
    checkPort({ server, free: server.ok ? await probes.portFree(server.port, server.host) : true }),
    checkDataFolder({ dir, probe: dir === null ? { exists: false, writable: false, error: null } : probes.directory(dir) }),
    checkSignIn({ env: merged, dev }),
    checkOs({ platform }),
    checkDatabaseUrl({ url: merged.DATABASE_URL }),
  ];
  return { results, server, env: merged };
}

/** Run, print, and return the exit code (1 only for a blocker). */
export async function doctorCommand({ out = (text) => process.stdout.write(text), ...options } = {}) {
  const { results } = await runDoctor(options);
  out(formatResults(results));
  return hasBlocker(results) ? 1 : 0;
}

function isMain() {
  try {
    return Boolean(process.argv[1]) && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isMain()) {
  doctorCommand().then(
    (code) => {
      process.exitCode = code;
    },
    (error) => {
      process.stderr.write(`Error: ${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    }
  );
}
