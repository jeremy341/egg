import { describe, expect, it } from "vitest";
import {
  MIN_FREE_DISK_MB,
  evaluatePreflight,
  parsePreflight,
  preflightNeeds,
  preflightScript,
  satisfiesNodeRange,
  type PreflightFacts,
  type PreflightNeeds,
} from "@/server/deploy/container-probe";

const good: PreflightFacts = {
  ran: true,
  nodeVersion: "v22.14.0",
  hasNpm: true,
  hasCorepack: true,
  hasPython3: true,
  pythonVenv: true,
  hasSystemdRun: true,
  hasTimeout: true,
  cgroupMemory: true,
  scopeOk: true,
  diskFreeMb: 8000,
  memTotalMb: 2048,
};

const nodeNeeds: PreflightNeeds = { node: true, nodeEngine: null, packageManager: "npm", python: false, buildWork: true };
const fixes = (facts: Partial<PreflightFacts>, needs: Partial<PreflightNeeds> = {}) =>
  evaluatePreflight({ ...good, ...facts }, { ...nodeNeeds, ...needs });

describe("parsing the container facts", () => {
  it("reads every fact from the script's output", () => {
    const out = [
      "EGG_PREFLIGHT=1",
      "node_version=v22.14.0",
      "has_npm=1",
      "has_corepack=0",
      "has_python3=1",
      "python_venv=0",
      "has_systemd_run=1",
      "has_timeout=1",
      "cgroup_memory=1",
      "scope_ok=0",
      "disk_free_mb=1500",
      "mem_total_mb=1990",
    ].join("\n");
    expect(parsePreflight(out)).toEqual({
      ran: true,
      nodeVersion: "v22.14.0",
      hasNpm: true,
      hasCorepack: false,
      hasPython3: true,
      pythonVenv: false,
      hasSystemdRun: true,
      hasTimeout: true,
      cgroupMemory: true,
      scopeOk: false,
      diskFreeMb: 1500,
      memTotalMb: 1990,
    });
  });

  it("says it did not run when the output is empty, and leaves unknown numbers unknown", () => {
    const p = parsePreflight("");
    expect(p.ran).toBe(false);
    expect(p.diskFreeMb).toBeNull();
    expect(p.nodeVersion).toBeNull();
  });

  it("checks venv through python3 -m venv --help in a login shell, and does not change anything", () => {
    const s = preflightScript("/root/.egg/demo/releases");
    expect(s).toContain("python3 -m venv --help");
    expect(s).toContain("bash -lc");
    expect(s).toContain("systemd-run --scope");
    expect(s).toContain("df -Pm");
    expect(s).not.toMatch(/\brm\b|\bmkdir\b|\bmv\b/);
  });
});

describe("what the container must have", () => {
  it("accepts a container that has everything", () => {
    expect(fixes({})).toEqual([]);
  });

  it("stops with one line when the probe itself could not run", () => {
    const p = evaluatePreflight({ ...good, ran: false }, nodeNeeds);
    expect(p).toHaveLength(1);
    expect(p[0].fix).toMatch(/could not check your container/);
  });

  it("asks for Node.js when it is missing", () => {
    expect(fixes({ nodeVersion: null })[0]).toMatchObject({
      check: "node",
      fix: "Install Node.js 22.13 or newer on your container (nodejs.org), then deploy again.",
    });
    expect(fixes({ nodeVersion: null }, { nodeEngine: ">=20" })[0].fix).toBe(
      "Install Node.js on your container (this project needs >=20), then deploy again."
    );
  });

  it("holds Node.js to 22.13 when the project names no range", () => {
    expect(fixes({ nodeVersion: "v22.13.0" })).toEqual([]);
    expect(fixes({ nodeVersion: "v24.1.0" })).toEqual([]);
    const old = fixes({ nodeVersion: "v22.12.9" });
    expect(old).toHaveLength(1);
    expect(old[0].fix).toBe(
      "Node.js 22.12.9 on your container does not match what this project needs (>=22.13). Install a matching Node.js on your container (nodejs.org), then deploy again."
    );
    expect(fixes({ nodeVersion: "v20.11.0" })[0].check).toBe("node");
  });

  it("holds Node.js to the project's engines range instead when there is one", () => {
    expect(fixes({ nodeVersion: "v20.11.0" }, { nodeEngine: ">=18" })).toEqual([]);
    expect(fixes({ nodeVersion: "v18.0.0" }, { nodeEngine: "^20 || ^22" })[0].fix).toContain("(^20 || ^22)");
    expect(fixes({ nodeVersion: "v22.1.0" }, { nodeEngine: "^20 || ^22" })).toEqual([]);
  });

  it("falls back to the minimum when the range cannot be read", () => {
    expect(fixes({ nodeVersion: "v22.14.0" }, { nodeEngine: "latest-ish" })).toEqual([]);
    expect(fixes({ nodeVersion: "v20.0.0" }, { nodeEngine: "latest-ish" })[0].fix).toContain("(>=22.13)");
  });

  it("asks for npm when the project uses npm and it is missing", () => {
    expect(fixes({ hasNpm: false })[0].fix).toBe(
      "Install npm on your container: sudo apt install npm (installing Node.js from nodejs.org includes it)."
    );
  });

  it("asks for corepack when the lockfile needs pnpm or yarn", () => {
    expect(fixes({ hasCorepack: false }, { packageManager: "pnpm" })[0].fix).toBe(
      "This project uses pnpm, which needs corepack. On your container run: npm install -g corepack"
    );
    expect(fixes({ hasCorepack: false }, { packageManager: "yarn" })[0].fix).toContain("uses yarn");
    expect(fixes({ hasCorepack: false }, { packageManager: "npm" })).toEqual([]);
    expect(fixes({ hasNpm: false }, { packageManager: null })).toEqual([]);
  });

  it("asks for python3 and then python3-venv for a Python project", () => {
    const py = { node: false, packageManager: null, python: true } as const;
    expect(fixes({ hasPython3: false, pythonVenv: false }, py)[0].fix).toBe(
      "Install Python 3 on your container: sudo apt install python3"
    );
    expect(fixes({ pythonVenv: false }, py)[0].fix).toBe(
      "Install python3-venv on your container: sudo apt install python3-venv"
    );
    expect(fixes({}, py)).toEqual([]);
    // A Node project does not need Python.
    expect(fixes({ hasPython3: false })).toEqual([]);
  });

  it("holds the free disk to 2 GB, and does not guess when it is unknown", () => {
    expect(MIN_FREE_DISK_MB).toBe(2048);
    expect(fixes({ diskFreeMb: 2048 })).toEqual([]);
    expect(fixes({ diskFreeMb: 2047 })[0]).toEqual({
      check: "disk",
      fix: "Free up disk space on your container: 2047 MB is free and a build needs at least 2048 MB.",
    });
    expect(fixes({ diskFreeMb: null })).toEqual([]);
  });

  it("refuses to build without systemd-run, rather than build without a cap", () => {
    const p = fixes({ hasSystemdRun: false });
    expect(p).toHaveLength(1);
    expect(p[0].check).toBe("systemd-run");
    expect(p[0].fix).toMatch(/memory cap with systemd-run, which is not installed/);
    expect(p[0].fix).toMatch(/Install systemd on your container\./);
    expect(p[0].fix).not.toMatch(/central/);
  });

  it("refuses when a capped scope cannot be made, or the memory controller is missing", () => {
    expect(fixes({ scopeOk: false })[0].check).toBe("cgroup");
    expect(fixes({ cgroupMemory: false })[0].check).toBe("cgroup");
    expect(fixes({ cgroupMemory: false })[0].fix).toMatch(/cgroup v2/);
  });

  it("needs the timeout command", () => {
    expect(fixes({ hasTimeout: false })[0].fix).toContain("sudo apt install coreutils");
  });

  it("asks for nothing build-related when there is nothing to build", () => {
    const none = { node: false, packageManager: null, python: false, buildWork: false } as const;
    expect(fixes({ hasSystemdRun: false, hasTimeout: false, nodeVersion: null, hasNpm: false }, none)).toEqual([]);
    // The disk floor still applies: the source has to be unpacked.
    expect(fixes({ diskFreeMb: 10 }, none)[0].check).toBe("disk");
  });

  it("lists the first problem first, so the owner fixes one thing at a time", () => {
    const p = fixes({ diskFreeMb: 100, nodeVersion: null, hasSystemdRun: false });
    expect(p.map((x) => x.check)).toEqual(["disk", "systemd-run", "node"]);
  });
});

describe("what a project needs", () => {
  const files = { lockfile: "pnpm" as const, hasPackageJson: true, hasBuildScript: true, hasRequirements: false, nodeEngine: ">=20" };
  const spec = { buildInstall: "pnpm install", buildCommand: "pnpm build", remoteInstall: "pnpm install --prod" };

  it("reads the package manager from the lockfile and the range from engines", () => {
    expect(preflightNeeds({ runtime: "node", installCommand: null }, files, spec)).toEqual({
      node: true,
      nodeEngine: ">=20",
      packageManager: "pnpm",
      python: false,
      buildWork: true,
    });
  });

  it("does not check a package manager when the owner wrote their own install command", () => {
    expect(preflightNeeds({ runtime: "node", installCommand: "make deps" }, files, spec).packageManager).toBeNull();
  });

  it("needs Python only for a Python project with requirements", () => {
    const py = { lockfile: null, hasPackageJson: false, hasBuildScript: false, hasRequirements: true };
    const venvSpec = { buildInstall: null, buildCommand: null, remoteInstall: "python3 -m venv .venv" };
    expect(preflightNeeds({ runtime: "python", installCommand: null }, py, venvSpec)).toMatchObject({ python: true, node: false, buildWork: true });
    expect(preflightNeeds({ runtime: "python", installCommand: null }, { ...py, hasRequirements: false }, { ...venvSpec, remoteInstall: null })).toMatchObject({ python: false, buildWork: false });
  });
});

describe("node ranges", () => {
  it.each([
    ["22.14.0", ">=22.13", true],
    ["22.12.0", ">=22.13", false],
    ["22.13.0", ">= 22.13.0", true],
    ["20.11.0", "^20", true],
    ["21.0.0", "^20", false],
    ["20.5.0", "~20.6", false],
    ["20.6.3", "~20.6.1", true],
    ["18.19.0", "18", true],
    ["19.0.0", "18", false],
    ["22.1.0", "18 || 20 || 22", true],
    ["24.0.0", "18 || 20 || 22", false],
    ["20.0.0", "18.x", false],
    ["20.3.0", "20.x", true],
    ["20.3.0", "*", true],
    ["20.3.0", ">=18 <21", true],
    ["21.3.0", ">=18 <21", false],
    ["20.3.0", "18.0.0 - 20.9.9", true],
    ["20.3.0", ">20", false],
    ["21.0.0", ">20", true],
    ["20.3.0", "<=20", true],
    ["21.0.0", "<=20", false],
  ])("%s against %s is %s", (version, range, expected) => {
    expect(satisfiesNodeRange(version, range)).toBe(expected);
  });

  it("returns null for a range or a version it cannot read", () => {
    expect(satisfiesNodeRange("22.0.0", "lts/*")).toBeNull();
    expect(satisfiesNodeRange("not-a-version", ">=18")).toBeNull();
  });
});
