import { spawn, type ChildProcess } from "node:child_process";

/**
 * The mock Nest runs its commands in a WSL distro on Windows. WSL stops an idle
 * distro after about a minute, and a cold start (systemd boot) makes the next
 * command take 10 to 20 seconds while it floods the CPU. Holding one session
 * open for the whole run keeps the distro warm, so no test pays for a boot.
 */
const DISTRO = process.env.TEST_WSL_DISTRO ?? "Ubuntu";

let holder: ChildProcess | undefined;

export default function setup() {
  if (process.platform !== "win32") return;
  holder = spawn("wsl.exe", ["-d", DISTRO, "-e", "sleep", "7200"], { stdio: "ignore" });
  holder.on("error", () => {});
  holder.unref();
  return () => {
    holder?.kill();
    holder = undefined;
  };
}
