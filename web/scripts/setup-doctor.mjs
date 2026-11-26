#!/usr/bin/env node
// `node scripts/setup-doctor.mjs`: checks this computer BEFORE `pnpm run setup` writes .env.local.
// It never changes anything. Each check is a pure function of `facts`; both the machine probes and
// the checks themselves can be replaced by tests (see runSetupDoctor).

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_NODE_RANGE,
  MIN_SECRET_LENGTH,
  hasBlocker,
  isPortFree,
  parseEnvFile,
  satisfiesRange,
} from "./doctor-checks.mjs";

export const WEB_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
/** Setup uses the default Next port; check that fixed port, not whatever APP_URL says. */
export const SETUP_PORT = 3000;
export const SETUP_HOST = "127.0.0.1";
export const ENV_FILE = ".env.local";

const result = (name, ok, severity, message, fix = "") => ({ ok, name, message, fix: ok ? "" : fix, severity });
const isOn = (value) => ["1", "true"].includes(String(value ?? "").trim().toLowerCase());
const isSet = (value) => String(value ?? "").trim() !== "";

// ---------------------------------------------------------------- checks (pure)

/** `nodeRange` is engines.node from package.json, or the project's default. */
export function checkNodeVersion({ nodeVersion, nodeRange }) {
  const name = "Node.js";
  let wanted = typeof nodeRange === "string" && nodeRange.trim() ? nodeRange.trim() : DEFAULT_NODE_RANGE;
  let verdict = satisfiesRange(nodeVersion, wanted);
  if (verdict === null && wanted !== DEFAULT_NODE_RANGE) {
    wanted = DEFAULT_NODE_RANGE;
    verdict = satisfiesRange(nodeVersion, wanted);
  }
  if (verdict === null) {
    return result(name, false, "blocker", `Could not read the Node version "${String(nodeVersion)}"`, "Install Node.js from https://nodejs.org, then run this again.");
  }
  if (verdict) return result(name, true, "blocker", `${nodeVersion} (needs ${wanted})`);
  return result(name, false, "blocker", `${nodeVersion} is too old (needs ${wanted})`, "Install a newer Node.js from https://nodejs.org, then run this again.");
}

/** `pnpmVersion` is the output of `pnpm --version`, or null when pnpm could not be run. */
export function checkPnpmAvailable({ pnpmVersion }) {
  const version = typeof pnpmVersion === "string" ? pnpmVersion.trim() : "";
  if (version) return result("pnpm", true, "blocker", version);
  return result("pnpm", false, "blocker", "pnpm was not found on the PATH", "Run `corepack enable` (comes with Node), then run this again.");
}

/** `portFree` is true, an error code such as "EADDRINUSE", or false. */
export function checkPort3000({ portFree }) {
  const name = "Port 3000";
  if (portFree === true) return result(name, true, "blocker", "3000 is free");
  if (portFree === "EADDRINUSE") {
    return result(name, false, "blocker", "Port 3000 is already in use", "Stop the program on port 3000, then run this again.");
  }
  if (portFree === "EACCES") {
    return result(name, false, "blocker", "Not allowed to listen on port 3000", "Use a port above 1024: set APP_URL in .env.local.");
  }
  const why = typeof portFree === "string" ? ` (${portFree})` : "";
  return result(name, false, "blocker", `Could not use port 3000${why}`, "Pick another port with APP_URL in .env.local, then run this again.");
}

/**
 * Setup never overwrites .env.local. Report what it will do with the file it finds, and flag a
 * secret that exists but is too short to use. Never print the secret itself.
 */
export function checkEnvLocal({ envLocalExists, settings }) {
  const name = "Settings file";
  if (!envLocalExists) return result(name, true, "warning", "no .env.local yet; setup will create it");
  const secret = String(settings?.APP_SECRET ?? "").trim();
  if (secret.length < MIN_SECRET_LENGTH) {
    const length = secret ? `${secret.length} characters` : "not set";
    return result(
      name,
      false,
      "blocker",
      `.env.local exists but APP_SECRET is ${length} (needs ${MIN_SECRET_LENGTH}+)`,
      "Edit .env.local by hand; setup never overwrites it. See docs/selfhost/README.md."
    );
  }
  return result(name, true, "warning", ".env.local already exists; setup will leave it alone");
}

/**
 * The two sign-in methods must not be mixed: with both set, anyone with a Hack Club account can
 * get their own account on a local instance (see docs/selfhost/README.md, "Confirming again").
 */
export function checkSignInChoice({ settings }) {
  const name = "Sign-in";
  const local = isOn(settings?.LOCAL_MODE);
  const hackClub = isSet(settings?.HACKCLUB_CLIENT_ID) && isSet(settings?.HACKCLUB_CLIENT_SECRET);
  if (local && hackClub) {
    return result(
      name,
      false,
      "blocker",
      "LOCAL_MODE=1 and Hack Club keys are both set: sign-up is open to any Hack Club account",
      "Clear HACKCLUB_CLIENT_ID and HACKCLUB_CLIENT_SECRET in .env.local, or set LOCAL_MODE=0 if you use Hack Club Auth."
    );
  }
  if (local) return result(name, true, "warning", "LOCAL_MODE=1: local sign-in (keep LOCAL_MODE_SECRET private)");
  if (hackClub) return result(name, true, "warning", "Hack Club Auth keys are set");
  return result(name, true, "warning", "no sign-in set yet; setup will write LOCAL_MODE=1");
}

/** The checks run in this order; tests may pass their own object with the same shape. */
export const defaultChecks = {
  node: checkNodeVersion,
  pnpm: checkPnpmAvailable,
  port: checkPort3000,
  envLocal: checkEnvLocal,
  signIn: checkSignInChoice,
};

// ------------------------------------------------------- machine-facing probes

/** The only places that touch the machine. Tests replace them with small fakes. */
export const realProbes = {
  pnpmVersion() {
    // On Windows pnpm is pnpm.cmd, which Node only starts through a shell. The command is a fixed string.
    const r =
      process.platform === "win32"
        ? spawnSync("pnpm --version", { encoding: "utf8", timeout: 15000, shell: true })
        : spawnSync("pnpm", ["--version"], { encoding: "utf8", timeout: 15000 });
    return r.status === 0 ? String(r.stdout).trim() : null;
  },
  port3000(port = SETUP_PORT, host = SETUP_HOST) {
    return isPortFree(port, host);
  },
  readEnvLocal(file) {
    try {
      return { exists: true, values: parseEnvFile(readFileSync(file, "utf8")) };
    } catch {
      return { exists: existsSync(file), values: {} };
    }
  },
  nodeRange(webDir) {
    try {
      return JSON.parse(readFileSync(path.join(webDir, "package.json"), "utf8"))?.engines?.node;
    } catch {
      return undefined;
    }
  },
};

/** Gather the facts once, so each check stays pure. Real environment values win over the file. */
export async function collectFacts({ webDir = WEB_DIR, env = process.env, nodeVersion = process.versions.node, probes = realProbes } = {}) {
  const file = await probes.readEnvLocal(path.join(webDir, ENV_FILE));
  const settings = {
    ...file.values,
    ...Object.fromEntries(Object.entries(env ?? {}).filter(([, value]) => value !== undefined)),
  };
  return {
    nodeVersion,
    nodeRange: await probes.nodeRange(webDir),
    pnpmVersion: await probes.pnpmVersion(),
    portFree: await probes.port3000(SETUP_PORT, SETUP_HOST),
    envLocalExists: file.exists,
    settings,
    webDir,
  };
}

/** Collect facts, then run every injected check on them. */
export async function runSetupDoctor({ checks = defaultChecks, ...options } = {}) {
  const facts = await collectFacts(options);
  const results = [];
  for (const check of Object.values(checks)) results.push(await check(facts));
  return { results, facts };
}

// --------------------------------------------------------------------- output

/** One line per check, one Fix line per problem, then the exact commands to run next. */
export function formatSetupReport({ results, facts }) {
  const lines = ["Setup check"];
  for (const r of results) {
    const mark = r.ok ? "✓" : r.severity === "blocker" ? "✗" : "!";
    lines.push(`${mark} ${r.name}: ${r.message}`);
    if (!r.ok && r.fix) lines.push(`    Fix: ${r.fix}`);
  }
  const blockers = results.filter((r) => !r.ok && r.severity === "blocker").length;
  const warnings = results.filter((r) => !r.ok && r.severity !== "blocker").length;
  if (blockers > 0) lines.push(`${blockers} problem${blockers === 1 ? "" : "s"} to fix before setup.`);
  else if (warnings > 0) lines.push(`Ready for setup, with ${warnings} note${warnings === 1 ? "" : "s"}.`);
  else lines.push("Ready for setup.");

  lines.push("", "Next:");
  let step = 1;
  const add = (command) => lines.push(`  ${step++}. ${command}`);
  if (blockers > 0) add("Fix the lines marked ✗, then run `node scripts/setup-doctor.mjs`");
  if (results.some((r) => r.name === "pnpm" && !r.ok)) add("corepack enable");
  add("pnpm install");
  // Setup is safe to re-run but leaves an existing file untouched; check that file instead.
  add(facts?.envLocalExists ? "pnpm run doctor" : "pnpm run setup");
  add("pnpm egg start");
  return lines.join("\n") + "\n";
}

/** Run, print, and return 1 only when a blocker was found. */
export async function setupDoctorCommand({ out = (text) => process.stdout.write(text), ...options } = {}) {
  const { results, facts } = await runSetupDoctor(options);
  out(formatSetupReport({ results, facts }));
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
  setupDoctorCommand().then(
    (code) => {
      process.exitCode = code;
    },
    (error) => {
      process.stderr.write(`Error: ${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    }
  );
}
