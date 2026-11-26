import { describe, expect, it } from "vitest";
import {
  SETUP_HOST,
  SETUP_PORT,
  checkEnvLocal,
  checkNodeVersion,
  checkPnpmAvailable,
  checkPort3000,
  checkSignInChoice,
  collectFacts,
  defaultChecks,
  formatSetupReport,
  runSetupDoctor,
  setupDoctorCommand,
} from "./setup-doctor.mjs";

const OK = { ok: true, name: "A", message: "fine", fix: "", severity: "blocker" };
const BLOCKER = { ok: false, name: "B", message: "broken", fix: "do this", severity: "blocker" };

function fakeProbes(over = {}) {
  return {
    pnpmVersion: over.pnpmVersion ?? (() => "11.20.0"),
    port3000: over.port3000 ?? (() => true),
    readEnvLocal: over.readEnvLocal ?? (() => ({ exists: false, values: {} })),
    nodeRange: over.nodeRange ?? (() => undefined),
  };
}

function run(over = {}) {
  return runSetupDoctor({
    webDir: "/w",
    env: over.env ?? {},
    nodeVersion: over.nodeVersion ?? "24.16.0",
    probes: fakeProbes(over.probes),
    ...(over.checks ? { checks: over.checks } : {}),
  });
}

describe("checks are pure and report one result each", () => {
  it("checks the Node version and names the requirement", () => {
    expect(checkNodeVersion({ nodeVersion: "24.16.0", nodeRange: ">=22.13.0" })).toMatchObject({ ok: true, name: "Node.js" });
    const old = checkNodeVersion({ nodeVersion: "20.11.0", nodeRange: undefined });
    expect(old).toMatchObject({ ok: false, severity: "blocker" });
    expect(old.message).toContain(">=22.13.0");
    expect(old.fix).toContain("nodejs.org");
    expect(checkNodeVersion({ nodeVersion: "weird", nodeRange: "odd" }).ok).toBe(false);
    expect(checkNodeVersion({ nodeVersion: "24.16.0", nodeRange: "odd" }).ok).toBe(true);
  });

  it("blocks on missing pnpm and says how to enable it", () => {
    expect(checkPnpmAvailable({ pnpmVersion: "11.20.0\n" })).toMatchObject({ ok: true, message: "11.20.0" });
    const missing = checkPnpmAvailable({ pnpmVersion: null });
    expect(missing).toMatchObject({ ok: false, severity: "blocker" });
    expect(missing.fix).toContain("corepack enable");
  });

  it("checks port 3000, including in-use and permission errors", () => {
    expect(checkPort3000({ portFree: true })).toMatchObject({ ok: true, message: "3000 is free" });
    const busy = checkPort3000({ portFree: "EADDRINUSE" });
    expect(busy).toMatchObject({ ok: false, severity: "blocker" });
    expect(busy.message).toContain("3000");
    expect(checkPort3000({ portFree: "EACCES" }).message).toContain("Not allowed");
    expect(checkPort3000({ portFree: "EINVAL" }).message).toContain("EINVAL");
  });

  it("reports what setup will do with .env.local without printing the secret", () => {
    expect(checkEnvLocal({ envLocalExists: false, settings: {} })).toMatchObject({ ok: true });
    expect(checkEnvLocal({ envLocalExists: false, settings: {} }).message).toContain("setup will create it");
    const secret = "s".repeat(32);
    expect(checkEnvLocal({ envLocalExists: true, settings: { APP_SECRET: secret } }).message).toContain("leave it alone");
    const weak = checkEnvLocal({ envLocalExists: true, settings: { APP_SECRET: "short" } });
    expect(weak).toMatchObject({ ok: false, severity: "blocker" });
    expect(weak.fix).toContain("setup never overwrites it");
    expect(JSON.stringify(weak)).not.toContain("short");
    expect(checkEnvLocal({ envLocalExists: true, settings: {} }).message).toContain("not set");
  });

  it("flags LOCAL_MODE mixed with Hack Club keys, and accepts either alone", () => {
    const both = checkSignInChoice({
      settings: { LOCAL_MODE: "1", HACKCLUB_CLIENT_ID: "id", HACKCLUB_CLIENT_SECRET: "secret" },
    });
    expect(both).toMatchObject({ ok: false, severity: "blocker" });
    expect(both.message).toContain("LOCAL_MODE");
    expect(both.fix).toContain("HACKCLUB_CLIENT_ID");
    expect(checkSignInChoice({ settings: { LOCAL_MODE: "true" } }).ok).toBe(true);
    expect(checkSignInChoice({ settings: { HACKCLUB_CLIENT_ID: "id", HACKCLUB_CLIENT_SECRET: "secret" } }).ok).toBe(true);
    expect(checkSignInChoice({ settings: {} }).message).toContain("setup will write LOCAL_MODE=1");
    // One key alone is not a complete sign-in method.
    expect(checkSignInChoice({ settings: { HACKCLUB_CLIENT_ID: "id" } }).message).toContain("no sign-in set yet");
  });
});

describe("injected checks and probes", () => {
  it("runs checks in order and passes all facts to each one", async () => {
    const seen = [];
    const checks = {
      first: (facts) => {
        seen.push(facts);
        return { ...OK, name: "first" };
      },
      second: (facts) => {
        seen.push(facts);
        return { ...BLOCKER, name: "second" };
      },
    };
    const { results } = await run({ checks });
    expect(results.map((r) => r.name)).toEqual(["first", "second"]);
    expect(seen).toHaveLength(2);
    expect(seen[0]).toMatchObject({ nodeVersion: "24.16.0", pnpmVersion: "11.20.0", portFree: true, envLocalExists: false });
    expect(defaultChecks.node).toBeTypeOf("function");
  });

  it("probes the fixed setup port and merges .env.local with the real environment", async () => {
    const calls = [];
    const facts = await collectFacts({
      webDir: "/w",
      env: { HACKCLUB_CLIENT_ID: "" },
      nodeVersion: "24.16.0",
      probes: fakeProbes({
        port3000: (port, host) => {
          calls.push([port, host]);
          return "EADDRINUSE";
        },
        readEnvLocal: () => ({
          exists: true,
          values: { HACKCLUB_CLIENT_ID: "id", HACKCLUB_CLIENT_SECRET: "secret", APP_SECRET: "s".repeat(32) },
        }),
      }),
    });
    expect(calls).toEqual([[SETUP_PORT, SETUP_HOST]]);
    expect(facts.envLocalExists).toBe(true);
    expect(facts.settings.HACKCLUB_CLIENT_ID).toBe("");
    expect(facts.settings.HACKCLUB_CLIENT_SECRET).toBe("secret");
    expect(checkSignInChoice(facts).ok).toBe(true);
  });

  it("produces every default result from fake machine facts", async () => {
    const { results } = await run({
      nodeVersion: "20.11.0",
      probes: fakeProbes({
        pnpmVersion: () => null,
        port3000: () => "EADDRINUSE",
        readEnvLocal: () => ({ exists: false, values: {} }),
      }),
    });
    expect(results.map((r) => r.name)).toEqual(["Node.js", "pnpm", "Port 3000", "Settings file", "Sign-in"]);
    expect(results.slice(0, 3).every((r) => !r.ok)).toBe(true);
    expect(results[3].message).toContain("setup will create it");
    expect(results[4].ok).toBe(true);
  });
});

describe("the short report", () => {
  it("prints one line per check and the exact commands for a fresh install", () => {
    const report = formatSetupReport({
      results: [OK, { ...OK, name: "Settings file", message: "no .env.local yet; setup will create it" }],
      facts: { envLocalExists: false },
    });
    expect(report).toContain("✓ A: fine");
    expect(report).toMatch(/Next:\n  1\. pnpm install\n  2\. pnpm run setup\n  3\. pnpm egg start\n/);
    expect(report).toContain("Ready for setup.");
  });

  it("prints fixes and a re-check command when a check blocks", () => {
    const report = formatSetupReport({ results: [BLOCKER, OK], facts: { envLocalExists: false } });
    expect(report).toContain("✗ B: broken\n    Fix: do this");
    expect(report).toContain("1 problem to fix before setup.");
    expect(report).toMatch(/Next:\n  1\. Fix the lines marked ✗, then run `node scripts\/setup-doctor\.mjs`\n  2\. pnpm install\n  3\. pnpm run setup\n  4\. pnpm egg start\n/);
  });

  it("uses doctor instead of setup when .env.local already exists, and enables pnpm first when missing", () => {
    const report = formatSetupReport({
      results: [OK, { ...BLOCKER, name: "pnpm" }],
      facts: { envLocalExists: true },
    });
    expect(report).toMatch(/Next:\n  1\. Fix the lines marked ✗, then run `node scripts\/setup-doctor\.mjs`\n  2\. corepack enable\n  3\. pnpm install\n  4\. pnpm run doctor\n  5\. pnpm egg start\n/);
    expect(report).not.toContain("pnpm run setup");
  });
});

describe("command exit code", () => {
  it("writes the report and exits 0 without blockers", async () => {
    let printed = "";
    const code = await setupDoctorCommand({
      out: (text) => {
        printed += text;
      },
      checks: { only: () => OK },
      probes: fakeProbes(),
    });
    expect(code).toBe(0);
    expect(printed).toContain("✓ A: fine");
    expect(printed).toContain("pnpm run setup");
  });

  it("exits 1 when a blocker fails", async () => {
    let printed = "";
    const code = await setupDoctorCommand({
      out: (text) => {
        printed += text;
      },
      checks: { only: () => BLOCKER },
      probes: fakeProbes(),
    });
    expect(code).toBe(1);
    expect(printed).toContain("Fix: do this");
  });
});
