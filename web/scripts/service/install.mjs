#!/usr/bin/env node
// `pnpm run service:install` and `pnpm run service:remove`: opt-in start on login.
//
//   install  writes the service file for this OS and prints the command that turns it on.
//            It never enables or starts anything by itself.
//   remove   stops the service if it is running, then deletes the file.
//
// The text of the files comes from templates.mjs. This file only finds the paths and does the I/O.

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnvFile, resolveServer, serverArgs } from "../doctor-checks.mjs";
import { servicePlan } from "./templates.mjs";

const WEB_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/** The absolute path of pnpm, or null. */
function findPnpm(platform) {
  const finder = platform === "win32" ? ["where.exe", ["pnpm"]] : ["sh", ["-c", "command -v pnpm"]];
  const r = spawnSync(finder[0], finder[1], { encoding: "utf8" });
  if (r.status !== 0) return null;
  return String(r.stdout).split(/\r?\n/).map((l) => l.trim()).find(Boolean) ?? null;
}

function appUrlFromEnvFile(webDir) {
  try {
    return parseEnvFile(readFileSync(path.join(webDir, ".env.local"), "utf8")).APP_URL;
  } catch {
    return undefined;
  }
}

const realDeps = {
  platform: process.platform,
  home: os.homedir(),
  localAppData: process.env.LOCALAPPDATA ?? path.join(os.homedir(), "AppData", "Local"),
  nodePath: process.execPath,
  webDir: WEB_DIR,
  findPnpm,
  appUrl: () => appUrlFromEnvFile(WEB_DIR),
  existsSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  run: (command, args) => spawnSync(command, args, { stdio: "inherit" }).status === 0,
  out: (text) => process.stdout.write(text),
  err: (text) => process.stderr.write(text),
};

function buildPlan(deps) {
  const pnpmPath = deps.platform === "win32" ? "pnpm" : deps.findPnpm(deps.platform);
  if (!pnpmPath) return { error: "pnpm was not found on the PATH. Run `corepack enable`, then try again." };
  const server = resolveServer(deps.appUrl());
  const plan = servicePlan({
    platform: deps.platform,
    home: deps.home,
    webDir: deps.webDir,
    pnpmPath,
    nodePath: deps.nodePath,
    localAppData: deps.localAppData,
    args: server.ok ? serverArgs(server) : [],
  });
  if (!plan) return { error: `Start on login is not available on ${deps.platform}. Use Windows, macOS or Linux.` };
  return { plan };
}

/** Write the service file and print what to run next. Returns the exit code. */
export function installService(given = {}) {
  const deps = { ...realDeps, ...given };
  const { plan, error } = buildPlan(deps);
  if (!plan) {
    deps.err(`${error}\n`);
    return 1;
  }
  deps.mkdirSync(path.dirname(plan.file), { recursive: true });
  deps.writeFileSync(plan.file, plan.content, { mode: 0o644 });
  deps.out(`Wrote ${plan.file}\n\n`);
  deps.out(`Egg is not turned on yet. To start it on login, run:\n  ${plan.enable}\n\n`);
  if (!deps.existsSync(path.join(deps.webDir, ".next", "BUILD_ID"))) {
    deps.out("There is no build yet. Run `pnpm egg start` once first (it builds), then stop it with Ctrl+C.\n\n");
  }
  deps.out(`Logs: ${plan.logs}\nTo remove it later: pnpm run service:remove\n`);
  if (plan.platform === "linux") {
    deps.out("To start it at boot even when you are not signed in: loginctl enable-linger\n");
  }
  return 0;
}

/** Stop the service if it is running, then delete the file. Returns the exit code. */
export function removeService(given = {}) {
  const deps = { ...realDeps, ...given };
  const { plan, error } = buildPlan(deps);
  if (!plan) {
    deps.err(`${error}\n`);
    return 1;
  }
  if (!deps.existsSync(plan.file)) {
    deps.out(`Nothing to remove: ${plan.file} does not exist.\n`);
    return 0;
  }
  // Stop first, while the file still exists. A service that is not running makes these fail; that is fine.
  const [command, ...args] = stopCommand(plan);
  if (!deps.run(command, args)) deps.out(`Could not stop it (it may not have been running). Continuing.\n`);
  deps.rmSync(plan.file, { force: true });
  deps.out(`Removed ${plan.file}\n`);
  if (plan.platform === "linux") deps.run("systemctl", ["--user", "daemon-reload"]);
  if (plan.platform === "win32") deps.out(`The Egg log folder was left in place: ${path.win32.dirname(plan.file)}\n`);
  return 0;
}

/** The stop command as [program, ...args], with no shell involved. */
export function stopCommand(plan) {
  if (plan.platform === "darwin") return ["launchctl", "bootout", `gui/${process.getuid?.() ?? 501}/app.egg.web`];
  if (plan.platform === "linux") return ["systemctl", "--user", "disable", "--now", "egg"];
  return ["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", plan.file, "-Remove"];
}

function isMain() {
  try {
    return Boolean(process.argv[1]) && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isMain()) {
  const action = process.argv[2];
  if (action === "install") process.exitCode = installService();
  else if (action === "remove") process.exitCode = removeService();
  else {
    process.stderr.write("Usage: node scripts/service/install.mjs install|remove\n");
    process.exitCode = 2;
  }
}
