import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  checkDatabaseUrl,
  checkDataFolder,
  checkEnvFile,
  checkNode,
  checkOs,
  checkPnpm,
  checkPort,
  checkProxy,
  checkSignIn,
  dataDirFromDatabaseUrl,
  formatResults,
  hasBlocker,
  isPortFree,
  parseEnvFile,
  portFromAppUrl,
  probeDirectory,
  resolveServer,
  satisfiesRange,
  serverArgs,
} from "./doctor-checks.mjs";

const temp = mkdtempSync(path.join(os.tmpdir(), "egg-doctor-test-"));
afterAll(() => rmSync(temp, { recursive: true, force: true }));

describe("APP_URL to port", () => {
  it("uses the port in the URL", () => {
    expect(portFromAppUrl("http://localhost:3100")).toBe(3100);
    expect(portFromAppUrl("https://egg.example.com:8443/path")).toBe(8443);
  });

  it("uses 3000 when the URL names no port or APP_URL is unset", () => {
    expect(portFromAppUrl("http://localhost")).toBe(3000);
    expect(portFromAppUrl("https://egg.example.com")).toBe(3000);
    expect(portFromAppUrl(undefined)).toBe(3000);
    expect(portFromAppUrl("  ")).toBe(3000);
  });

  it("returns null for something that is not a web address", () => {
    expect(portFromAppUrl("not a url")).toBeNull();
    expect(portFromAppUrl("ftp://localhost:21")).toBeNull();
  });

  it("binds a local address to loopback only and points the browser at the port", () => {
    expect(resolveServer("http://localhost")).toEqual({ ok: true, port: 3000, host: "127.0.0.1", url: "http://localhost:3000" });
    expect(resolveServer("http://127.0.0.1:3100")).toEqual({ ok: true, port: 3100, host: "127.0.0.1", url: "http://127.0.0.1:3100" });
    expect(resolveServer("http://[::1]:3100")).toMatchObject({ host: "::1", port: 3100 });
    const remote = resolveServer("https://egg.example.com");
    expect(remote).toEqual({ ok: true, port: 3000, host: null, url: "https://egg.example.com" });
  });

  it("turns a server into next arguments", () => {
    expect(serverArgs(resolveServer("http://localhost:3100") as never)).toEqual(["-p", "3100", "-H", "127.0.0.1"]);
    expect(serverArgs(resolveServer("https://egg.example.com:4000") as never)).toEqual(["-p", "4000"]);
  });
});

describe("env file parsing", () => {
  it("reads values, quotes, comments and export", () => {
    const env = parseEnvFile(
      ['# comment', 'APP_SECRET=abc   # trailing note', 'A="x # y"', "B='z'", "export C=1", "EMPTY=", "bad line", ""].join("\n")
    );
    expect(env).toEqual({ APP_SECRET: "abc", A: "x # y", B: "z", C: "1", EMPTY: "" });
  });

  it("copes with Windows line endings", () => {
    expect(parseEnvFile("A=1\r\nB=2\r\n")).toEqual({ A: "1", B: "2" });
  });
});

describe("node version", () => {
  it("checks ranges the way engines fields are written", () => {
    expect(satisfiesRange("22.13.0", ">=22.13.0")).toBe(true);
    expect(satisfiesRange("22.12.9", ">=22.13.0")).toBe(false);
    expect(satisfiesRange("24.16.0", ">=22.13.0")).toBe(true);
    expect(satisfiesRange("20.1.0", "^20.9.0 || >=22")).toBe(false);
    expect(satisfiesRange("20.10.0", "^20.9.0 || >=22")).toBe(true);
    expect(satisfiesRange("21.0.0", "^20.9.0 || >=22")).toBe(false);
    expect(satisfiesRange("22.1.0", "22.x")).toBe(true);
    expect(satisfiesRange("23.0.0", "22.x")).toBe(false);
    expect(satisfiesRange("22.5.0", ">=22 <23")).toBe(true);
    expect(satisfiesRange("23.0.0", ">=22 <23")).toBe(false);
    expect(satisfiesRange("22.5.1", "~22.5.0")).toBe(true);
    expect(satisfiesRange("22.6.0", "~22.5.0")).toBe(false);
    expect(satisfiesRange("22.0.0", "22.0.0 - 23.0.0")).toBeNull();
    expect(satisfiesRange("weird", ">=22")).toBeNull();
  });

  it("passes on a new enough Node", () => {
    expect(checkNode({ version: "24.16.0", range: ">=22.13.0" })).toMatchObject({ ok: true, name: "Node.js", fix: "" });
  });

  it("falls back to 22.13 when engines is missing or unreadable", () => {
    expect(checkNode({ version: "22.13.0", range: undefined }).ok).toBe(true);
    expect(checkNode({ version: "22.12.0", range: undefined }).ok).toBe(false);
    expect(checkNode({ version: "22.13.0", range: "a very odd range" }).ok).toBe(true);
  });

  it("blocks on an old Node and says what to do", () => {
    const r = checkNode({ version: "20.11.0", range: ">=22.13.0" });
    expect(r).toMatchObject({ ok: false, severity: "blocker" });
    expect(r.message).toContain("20.11.0");
    expect(r.fix).toContain("nodejs.org");
  });
});

describe("pnpm", () => {
  it("passes with a version and only warns without one", () => {
    expect(checkPnpm({ version: "11.20.0\n" })).toMatchObject({ ok: true, message: "11.20.0" });
    expect(checkPnpm({ version: null })).toMatchObject({ ok: false, severity: "warning" });
    expect(checkPnpm({ version: null }).fix).toContain("corepack");
  });
});

describe(".env.local and APP_SECRET", () => {
  it("fails when the file is missing and points at setup", () => {
    const r = checkEnvFile({ exists: false, env: {} });
    expect(r).toMatchObject({ ok: false, severity: "blocker" });
    expect(r.fix).toContain("pnpm run setup");
  });

  it("fails when APP_SECRET is empty or too short", () => {
    expect(checkEnvFile({ exists: true, env: { APP_SECRET: "" } }).message).toContain("not set");
    const short = checkEnvFile({ exists: true, env: { APP_SECRET: "x".repeat(31) } });
    expect(short.ok).toBe(false);
    expect(short.message).toContain("31 characters");
  });

  it("passes with 32 characters", () => {
    expect(checkEnvFile({ exists: true, env: { APP_SECRET: "x".repeat(32) } }).ok).toBe(true);
  });

  it("never prints the secret", () => {
    const secret = "S".repeat(40);
    expect(JSON.stringify(checkEnvFile({ exists: true, env: { APP_SECRET: secret } }))).not.toContain(secret);
  });
});

describe("port", () => {
  const server = resolveServer("http://localhost:3100");

  it("reports free, in use, not allowed and other errors", () => {
    expect(checkPort({ server, free: true })).toMatchObject({ ok: true, message: "3100 is free" });
    const busy = checkPort({ server, free: "EADDRINUSE" });
    expect(busy).toMatchObject({ ok: false, severity: "blocker" });
    expect(busy.message).toContain("3100");
    expect(checkPort({ server, free: false }).ok).toBe(false);
    expect(checkPort({ server, free: "EACCES" }).message).toContain("Not allowed");
    expect(checkPort({ server, free: "EINVAL" }).message).toContain("EINVAL");
  });

  it("blocks when APP_URL is not a web address", () => {
    expect(checkPort({ server: resolveServer("nope"), free: true })).toMatchObject({ ok: false, severity: "blocker" });
  });

  it("really detects a port that is taken, then free again", async () => {
    const holder = net.createServer();
    await new Promise<void>((resolve) => holder.listen(0, "127.0.0.1", resolve));
    const { port } = holder.address() as net.AddressInfo;
    expect(await isPortFree(port, "127.0.0.1")).toBe("EADDRINUSE");
    await new Promise((resolve) => holder.close(resolve));
    expect(await isPortFree(port, "127.0.0.1")).toBe(true);
  });
});

describe("data folder", () => {
  it("finds the folder of a file: URL, relative to the web folder", () => {
    const cwd = path.resolve("web-dir");
    expect(dataDirFromDatabaseUrl("file:./data/egg.db", cwd)).toBe(path.join(cwd, "data"));
    expect(dataDirFromDatabaseUrl("file:data/egg.db", cwd)).toBe(path.join(cwd, "data"));
    expect(dataDirFromDatabaseUrl(undefined, cwd)).toBe(path.join(cwd, "data"));
    expect(dataDirFromDatabaseUrl(`file:${path.join(temp, "x", "egg.db")}`, cwd)).toBe(path.join(temp, "x"));
    expect(dataDirFromDatabaseUrl("file:./data/egg.db?mode=rwc", cwd)).toBe(path.join(cwd, "data"));
  });

  it("returns null for memory and non-file URLs", () => {
    expect(dataDirFromDatabaseUrl("file::memory:", "/w")).toBeNull();
    expect(dataDirFromDatabaseUrl("libsql://db.example.com", "/w")).toBeNull();
  });

  it("creates a missing folder, writes a temp file and cleans it up", () => {
    const dir = path.join(temp, "fresh", "data");
    const probe = probeDirectory(dir);
    expect(probe).toEqual({ exists: true, writable: true, error: null });
    expect(checkDataFolder({ dir, probe }).ok).toBe(true);
  });

  it("reports a folder that cannot be created", () => {
    const file = path.join(temp, "a-file");
    writeFileSync(file, "x");
    const probe = probeDirectory(path.join(file, "data"));
    expect(probe.writable).toBe(false);
    const r = checkDataFolder({ dir: path.join(file, "data"), probe });
    expect(r).toMatchObject({ ok: false, severity: "blocker" });
    expect(r.message).toContain("cannot be created");
  });

  it("reports a folder that exists but cannot be written, using a fake filesystem", () => {
    const fs = {
      mkdirSync: () => undefined,
      writeFileSync: () => {
        throw Object.assign(new Error("denied"), { code: "EACCES" });
      },
      rmSync: () => undefined,
    };
    const probe = probeDirectory("/data", fs as never);
    expect(probe).toEqual({ exists: true, writable: false, error: "EACCES" });
    expect(checkDataFolder({ dir: "/data", probe }).message).toContain("is not writable (EACCES)");
  });

  it("skips a database that is not a file", () => {
    expect(checkDataFolder({ dir: null, probe: { exists: false, writable: false, error: null } }).ok).toBe(true);
  });
});

describe("operating system and database", () => {
  it("names the system and never blocks", () => {
    expect(checkOs({ platform: "win32" })).toMatchObject({ ok: true, message: "Windows" });
    expect(checkOs({ platform: "darwin" }).message).toBe("macOS");
    expect(checkOs({ platform: "linux" }).message).toBe("Linux");
    const odd = checkOs({ platform: "freebsd" });
    expect(odd.ok).toBe(false);
    expect(hasBlocker([odd])).toBe(false);
  });

  it("reports a DATABASE_URL that is not a file", () => {
    expect(checkDatabaseUrl({ url: "file:./data/egg.db" }).ok).toBe(true);
    expect(checkDatabaseUrl({ url: undefined }).ok).toBe(true);
    expect(checkDatabaseUrl({ url: "libsql://x.turso.io" })).toMatchObject({ ok: false, severity: "warning" });
    expect(checkDatabaseUrl({ url: "file::memory:" }).ok).toBe(false);
  });
});

describe("rate limits", () => {
  it("warns when TRUST_PROXY is off, because limits then have no client address", () => {
    expect(checkProxy({ env: {} }).ok).toBe(false);
    expect(checkProxy({ env: { TRUST_PROXY: "1" } }).ok).toBe(true);
  });
});

describe("sign-in", () => {
  it("passes with LOCAL_MODE or Hack Club keys, and warns with neither", () => {
    expect(checkSignIn({ env: { LOCAL_MODE: "1" }, dev: false }).ok).toBe(true);
    expect(checkSignIn({ env: { HACKCLUB_CLIENT_ID: "a", HACKCLUB_CLIENT_SECRET: "b" }, dev: false }).ok).toBe(true);
    expect(checkSignIn({ env: { HACKCLUB_CLIENT_ID: "a" }, dev: false }).ok).toBe(false);
  });

  it("counts DEV_LOGIN only in development", () => {
    expect(checkSignIn({ env: { DEV_LOGIN: "1" }, dev: true }).ok).toBe(true);
    expect(checkSignIn({ env: { DEV_LOGIN: "1" }, dev: false }).ok).toBe(false);
  });
});

describe("output", () => {
  const pass = { ok: true, name: "A", message: "fine", fix: "", severity: "blocker" };
  const block = { ok: false, name: "B", message: "broken", fix: "do this", severity: "blocker" };
  const warn = { ok: false, name: "C", message: "meh", fix: "maybe this", severity: "warning" };

  it("marks passes, blockers and warnings and prints each fix on its own line", () => {
    const text = formatResults([pass, block, warn]);
    expect(text).toContain("✓ A: fine");
    expect(text).toContain("✗ B: broken\n    Fix: do this");
    expect(text).toContain("! C: meh\n    Fix: maybe this");
    expect(text).toContain("1 problem to fix");
  });

  it("only a failed blocker stops the start", () => {
    expect(hasBlocker([pass, warn])).toBe(false);
    expect(hasBlocker([pass, block])).toBe(true);
    expect(formatResults([pass, warn])).toContain("Ready to start, with 1 warning.");
    expect(formatResults([pass])).toContain("All checks passed.");
  });
});
