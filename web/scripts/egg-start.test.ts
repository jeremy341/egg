import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { run } from "./egg-cli.mjs";
import { openCommand, startEgg, waitForPort } from "./egg-start.mjs";

const OK = { ok: true, name: "x", message: "fine", fix: "", severity: "blocker" };
const BLOCKER = { ok: false, name: "Port", message: "Port 3100 is already in use", fix: "Stop the other program.", severity: "blocker" };
const SERVER = { ok: true, port: 3100, host: "127.0.0.1", url: "http://localhost:3100" };

/** Fake machine: records every step in `steps`. */
function harness(over: { files?: string[]; results?: unknown[]; setupCode?: number; buildCode?: number; serverCode?: number; up?: boolean; opens?: boolean } = {}) {
  const steps: string[] = [];
  const files = new Set(over.files ?? [".env.local", ".next/BUILD_ID"]);
  let text = "";
  // The fake server keeps running until the launcher has finished waiting for it, as a real one does.
  let release: () => void = () => {};
  const running = new Promise<void>((resolve) => (release = resolve));
  const deps = {
    existsSync: (p: string) => [...files].some((f) => p.replace(/\\/g, "/").endsWith(f)),
    runSetup: () => {
      steps.push("setup");
      return over.setupCode ?? 0;
    },
    runDoctor: async () => {
      steps.push("doctor");
      return { results: over.results ?? [OK], server: SERVER, env: {} };
    },
    spawnNext: (args: string[]) => {
      steps.push(`next ${args.join(" ")}`);
      if (args[0] === "build") return { exited: Promise.resolve(over.buildCode ?? 0), stop() {} };
      return { exited: running.then(() => over.serverCode ?? 0), stop() {} };
    },
    waitForPort: async () => {
      steps.push("wait");
      setTimeout(release, 0);
      return over.up ?? true;
    },
    openBrowser: (platform: string, url: string) => {
      steps.push(`open ${platform} ${url}`);
      return over.opens ?? true;
    },
  };
  const start = (options: Record<string, unknown> = {}) => startEgg({ webDir: "/w", platform: "darwin", out: (t: string) => void (text += t), deps, ...options } as never);
  return { steps, start, output: () => text };
}

describe("egg start", () => {
  it("runs the doctor, starts the production server on the APP_URL port and opens the browser", async () => {
    const h = harness();
    expect(await h.start()).toBe(0);
    expect(h.steps).toEqual(["doctor", "next start -p 3100 -H 127.0.0.1", "wait", "open darwin http://localhost:3100"]);
    expect(h.output()).toContain("Starting Egg at http://localhost:3100");
  });

  it("runs setup first when .env.local is missing", async () => {
    const h = harness({ files: [".next/BUILD_ID"] });
    expect(await h.start()).toBe(0);
    expect(h.steps.slice(0, 2)).toEqual(["setup", "doctor"]);
  });

  it("stops when setup fails", async () => {
    const h = harness({ files: [], setupCode: 1 });
    expect(await h.start()).toBe(1);
    expect(h.steps).toEqual(["setup"]);
  });

  it("stops at a doctor blocker, prints the fix, and starts nothing", async () => {
    const h = harness({ results: [OK, BLOCKER] });
    expect(await h.start()).toBe(1);
    expect(h.steps).toEqual(["doctor"]);
    expect(h.output()).toContain("Fix: Stop the other program.");
  });

  it("does not stop for a warning", async () => {
    const h = harness({ results: [OK, { ...BLOCKER, severity: "warning" }] });
    expect(await h.start()).toBe(0);
    expect(h.steps).toContain("next start -p 3100 -H 127.0.0.1");
  });

  it("builds first when there is no build yet", async () => {
    const h = harness({ files: [".env.local"] });
    expect(await h.start()).toBe(0);
    expect(h.steps.slice(0, 3)).toEqual(["doctor", "next build", "next start -p 3100 -H 127.0.0.1"]);
  });

  it("does not start the server when the build fails", async () => {
    const h = harness({ files: [".env.local"], buildCode: 1 });
    expect(await h.start()).toBe(1);
    expect(h.steps).toEqual(["doctor", "next build"]);
  });

  it("--dev runs next dev and never builds", async () => {
    const h = harness({ files: [".env.local"] });
    expect(await h.start({ dev: true })).toBe(0);
    expect(h.steps).toContain("next dev -p 3100 -H 127.0.0.1");
    expect(h.steps).not.toContain("next build");
  });

  it("prints the address when the browser cannot be opened or the server is slow", async () => {
    const noOpen = harness({ opens: false });
    await noOpen.start();
    expect(noOpen.output()).toContain("Open http://localhost:3100 in your browser.");
    const slow = harness({ up: false });
    await slow.start();
    expect(slow.output()).toContain("taking a while");
    expect(slow.steps.some((s) => s.startsWith("open"))).toBe(false);
  });

  it("returns the server's exit code", async () => {
    expect(await harness({ serverCode: 3 }).start()).toBe(3);
  });
});

describe("opening the browser", () => {
  it("uses open, xdg-open and the Windows URL handler", () => {
    expect(openCommand("darwin", "http://localhost:3000")).toEqual({ command: "open", args: ["http://localhost:3000"] });
    expect(openCommand("linux", "http://localhost:3000")).toEqual({ command: "xdg-open", args: ["http://localhost:3000"] });
    expect(openCommand("win32", "http://localhost:3000")?.args).toEqual(["url.dll,FileProtocolHandler", "http://localhost:3000"]);
    expect(openCommand("freebsd", "http://x")).toBeNull();
  });

  it("gives up waiting for a port when cancelled", async () => {
    expect(await waitForPort(1, "127.0.0.1", 5000, { cancelled: () => true })).toBe(false);
  });
});

describe("egg start and egg doctor in the CLI", () => {
  const capture = () => {
    const chunks = { out: "", err: "" };
    return {
      chunks,
      stdout: { write: (t: string) => void (chunks.out += t) },
      stderr: { write: (t: string) => void (chunks.err += t) },
    };
  };

  const webDir = mkdtempSync(path.join(os.tmpdir(), "egg-cli-doctor-"));
  writeFileSync(path.join(webDir, ".env.local"), `APP_SECRET=${"s".repeat(40)}
APP_URL=http://localhost:3777
`);
  afterAll(() => rmSync(webDir, { recursive: true, force: true }));

  it("need no token", async () => {
    const io = capture();
    const code = await run(["doctor"], { env: {}, ...io, local: { webDir, env: {}, probes: fakeProbes() } } as never);
    expect(code).toBe(0);
    expect(io.chunks.out).toContain("Node.js");
    expect(io.chunks.err).not.toContain("EGG_TOKEN");
  });

  it("--dev only works with start", async () => {
    const io = capture();
    expect(await run(["doctor", "--dev"], { env: {}, ...io } as never)).toBe(2);
    expect(io.chunks.err).toContain("--dev only works with egg start");
  });
});

function fakeProbes() {
  return {
    pnpmVersion: () => "11.0.0",
    dockerWorks: () => true,
    portFree: async () => true,
    directory: () => ({ exists: true, writable: true, error: null }),
  };
}
