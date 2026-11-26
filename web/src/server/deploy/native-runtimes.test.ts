import { describe, expect, it } from "vitest";
import { detectRepo } from "@/server/repo-detect";
import { createProjectInput } from "@/server/projects";
import { resolveRuntime, resolveStartCommand } from "@/server/deploy/runtime";
import { evaluatePreflight, parsePreflight, preflightNeeds } from "@/server/deploy/container-probe";
import { detectFiles } from "@/server/deploy/build";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const files = { lockfile: null, hasPackageJson: false, hasBuildScript: false, hasRequirements: false } as const;
const input = (runtime: "go" | "rust" | "ruby" | "php" | "java") => ({ runtime, installCommand: null, buildCommand: null, startCommand: null, outputDir: null });

describe("native runtime profiles", () => {
  it.each([["go.mod", "go"], ["Cargo.toml", "rust"], ["Gemfile", "ruby"], ["composer.json", "php"], ["pom.xml", "java"]] as const)("detects %s and accepts the profile", (file, runtime) => {
    expect(detectRepo({ [file]: "" }).runtime).toBe(runtime);
    expect(createProjectInput.safeParse({ serverId: "s", name: "App", repoUrl: "https://github.com/a/b", runtime, port: 3000 }).success).toBe(true);
  });

  it("builds a Go executable and preserves a custom start command", () => {
    expect(resolveRuntime(input("go"), files).buildCommand).toBe("go build -o .egg-app .");
    expect(resolveStartCommand({ runtime: "go", startCommand: null }, null, 3000)).toBe("./.egg-app");
    expect(resolveStartCommand({ runtime: "go", startCommand: "./server" }, null, 3000)).toBe("./server");
  });

  it("requires a start command where an entry point cannot be inferred safely", () => {
    for (const runtime of ["rust", "ruby", "php", "java"] as const) {
      expect(() => resolveStartCommand({ runtime, startCommand: null }, null, 3000)).toThrow(/start command/i);
    }
  });

  it("installs Python pyproject dependencies inside the release virtual environment", () => {
    expect(resolveRuntime({ ...input("go"), runtime: "python" }, { ...files, hasPyproject: true }).remoteInstall).toContain(".venv/bin/pip install --disable-pip-version-check .");
  });

  it("uses Bun for Bun lockfiles", () => {
    const spec = resolveRuntime({ ...input("go"), runtime: "node" }, { ...files, hasPackageJson: true, hasBuildScript: true, lockfile: "bun" });
    expect(spec.buildInstall).toBe("bun install --frozen-lockfile");
    expect(spec.remoteInstall).toBe("bun install --production --frozen-lockfile");
  });

  it("honours packageManager when multiple lockfiles exist", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "egg-runtime-"));
    try {
      writeFileSync(path.join(dir, "package.json"), JSON.stringify({ packageManager: "pnpm@9.1.0" }));
      writeFileSync(path.join(dir, "bun.lock"), "");
      writeFileSync(path.join(dir, "pnpm-lock.yaml"), "");
      expect(detectFiles(dir).lockfile).toBe("pnpm");
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("rejects a missing Go toolchain before a target build", () => {
    const go = input("go");
    const needs = preflightNeeds(go, files, resolveRuntime(go, files));
    const facts = parsePreflight("EGG_PREFLIGHT=1\nhas_systemd_run=1\nhas_timeout=1\ncgroup_memory=1\nscope_ok=1\ndisk_free_mb=4096\n");
    expect(evaluatePreflight(facts, needs).some((problem) => /go/i.test(problem.fix))).toBe(true);
  });
});
