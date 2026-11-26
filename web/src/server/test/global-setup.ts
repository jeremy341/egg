import { spawn, spawnSync, type ChildProcess } from "node:child_process";

/**
 * The mock Nest runs its commands in a WSL distro on Windows. WSL stops an idle
 * distro after about a minute, and a cold start (systemd boot) makes the next
 * command take 10 to 20 seconds while it floods the CPU. Holding one session
 * open for the whole run keeps the distro warm, so no test pays for a boot.
 *
 * Only Windows has WSL. On Linux and macOS the mock Nest runs its commands on the
 * host itself, so there is nothing to keep warm and this does nothing. On Windows
 * without the distro it also does nothing: the tests that need a real Linux
 * userland skip themselves (see wslEnabled in mock-ssh.ts).
 */
const DISTRO = process.env.TEST_WSL_DISTRO ?? "Ubuntu";

let holder: ChildProcess | undefined;

function wslAvailable(): boolean {
  const r = spawnSync("wsl.exe", ["-d", DISTRO, "-e", "true"], { stdio: "ignore", timeout: 60000 });
  return r.status === 0;
}

export default function setup() {
  if (process.platform !== "win32") return;
  if (!wslAvailable()) {
    console.warn(`WSL distro "${DISTRO}" is not available, so the WSL warm session is not started.`);
    return;
  }
  holder = spawn("wsl.exe", ["-d", DISTRO, "-e", "sleep", "7200"], { stdio: "ignore" });
  holder.on("error", () => {});
  holder.unref();
  return () => {
    holder?.kill();
    holder = undefined;
  };
}
