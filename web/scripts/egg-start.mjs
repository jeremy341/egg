// `egg start`: set up if needed, run the doctor, build if needed, start the server, open the browser.
// Everything that touches the machine is passed in through `deps`, so tests can run it with fakes.

import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import net from "node:net";
import path from "node:path";
import { formatResults, hasBlocker, serverArgs } from "./doctor-checks.mjs";
import { runDoctor, WEB_DIR } from "./doctor.mjs";

const WAIT_FOR_SERVER_MS = 90_000;

/** The command that opens a web address in the default browser, or null on an unknown system. */
export function openCommand(platform, url) {
  if (platform === "darwin") return { command: "open", args: [url] };
  if (platform === "linux") return { command: "xdg-open", args: [url] };
  // `start` is a cmd.exe built-in. This is the call it makes, without a shell to quote for.
  if (platform === "win32") return { command: "rundll32", args: ["url.dll,FileProtocolHandler", url] };
  return null;
}

/** Start `next` with these arguments in the web folder. Returns { exited: Promise<number>, stop() }. */
function spawnNext(args, webDir) {
  const nextBin = createRequire(path.join(webDir, "package.json")).resolve("next/dist/bin/next");
  const child = spawn(process.execPath, [nextBin, ...args], { cwd: webDir, stdio: "inherit" });
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

/**
 * Wait until something accepts connections on the port. Gives up after `timeoutMs`.
 * @param {number} port
 * @param {string | null} host
 * @param {number} timeoutMs
 * @param {{ cancelled?: () => boolean, sleep?: (ms: number) => Promise<unknown> }} [options]
 */
export async function waitForPort(port, host, timeoutMs, { cancelled = () => false, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline && !cancelled()) {
    const up = await new Promise((resolve) => {
      const socket = net.connect({ port, host: host ?? "localhost" });
      socket.once("connect", () => {
        socket.destroy();
        resolve(true);
      });
      socket.once("error", () => resolve(false));
    });
    if (up) return true;
    await sleep(400);
  }
  return false;
}

function openBrowser(platform, url) {
  const open = openCommand(platform, url);
  if (!open) return false;
  try {
    const child = spawn(open.command, open.args, { stdio: "ignore", detached: true });
    child.on("error", () => {});
    child.unref();
    return true;
  } catch {
    return false;
  }
}

const realDeps = {
  runDoctor,
  existsSync,
  runSetup: (webDir) => spawnSync(process.execPath, [path.join(webDir, "scripts", "setup.mjs")], { cwd: webDir, stdio: "inherit" }).status ?? 1,
  spawnNext,
  waitForPort,
  openBrowser,
};

/**
 * Returns the exit code: 0 when the server ran and stopped normally, 1 when setup, the doctor
 * or the build stopped it. `out` receives plain text lines.
 */
export async function startEgg({ dev = false, webDir = WEB_DIR, platform = process.platform, out = (t) => process.stdout.write(t), deps: given = {}, ...doctorOptions } = {}) {
  const deps = { ...realDeps, ...given };

  if (!deps.existsSync(path.join(webDir, ".env.local"))) {
    out("No .env.local yet, so running setup first.\n");
    if (deps.runSetup(webDir) !== 0) {
      out("Setup failed. Fix the error above and run this again.\n");
      return 1;
    }
  }

  const { results, server } = await deps.runDoctor({ webDir, dev, platform, ...doctorOptions });
  out(formatResults(results));
  if (hasBlocker(results) || !server.ok) {
    out("Egg did not start. Fix the lines marked with a cross, then run this again.\n");
    return 1;
  }

  if (!dev && !deps.existsSync(path.join(webDir, ".next", "BUILD_ID"))) {
    out("No build yet, so building first. This takes a minute or two.\n");
    const code = await deps.spawnNext(["build"], webDir).exited;
    if (code !== 0) {
      out("The build failed. Fix the error above and run this again.\n");
      return 1;
    }
  }

  const command = dev ? "dev" : "start";
  out(`Starting Egg${dev ? " in development mode" : ""} at ${server.url}\n`);
  const child = deps.spawnNext([command, ...serverArgs(server)], webDir);
  let finished = false;
  const exited = child.exited.then((code) => {
    finished = true;
    return code;
  });

  const up = await deps.waitForPort(server.port, server.host, WAIT_FOR_SERVER_MS, { cancelled: () => finished });
  if (up && !finished) {
    if (!deps.openBrowser(platform, server.url)) out(`Open ${server.url} in your browser.\n`);
  } else if (!finished) {
    out(`The server is taking a while. Open ${server.url} in your browser when it is ready.\n`);
  }
  return await exited;
}
