import { execFileSync, spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { BAD_BUILD_CREDENTIAL } from "@/server/builds/authorization";
import { parseUploadHeaders } from "@/server/builds/uploads";
import {
  PRODUCTION_ENVIRONMENT,
  WORKFLOW_PATH,
  WORKFLOW_SECRET_LIST,
  WORKFLOW_SECRETS,
  WorkflowError,
  buildWorkflow,
  envStepScript,
  uploadScript,
  type WorkflowInput,
} from "@/server/builds/workflow";
import { MAX_ARCHIVE_BYTES } from "@/server/deploy/build";

const base: WorkflowInput = {
  eggUrl: "https://egg.example.com/",
  productionBranch: "main",
  runtime: "node",
  installCommand: null,
  buildCommand: null,
  outputDir: null,
  rootDir: ".",
};

const make = (over: Partial<WorkflowInput> = {}) => buildWorkflow({ ...base, ...over });

const RUNTIMES = ["node", "static", "python", "command", "go", "rust", "ruby", "php", "java"] as const;

/** The text of one job: from its key under `jobs:` to the next job or the end of the file. */
function jobText(yml: string, job: "build-production" | "build-preview"): string {
  const start = yml.indexOf(`\n  ${job}:\n`);
  expect(start, `${job} is in the file`).toBeGreaterThan(0);
  const rest = yml.slice(start + 1);
  const next = rest.slice(1).search(/\n  [a-z][a-z-]*:\n/);
  return next === -1 ? rest : rest.slice(0, next + 1);
}

describe("the workflow generator", () => {
  it("puts the file where the dashboard says, names the four secrets, and holds no secret value", () => {
    const yml = make();
    expect(WORKFLOW_PATH).toBe(".github/workflows/egg.yml");
    expect(yml).toContain(".github/workflows/egg.yml");
    for (const name of Object.values(WORKFLOW_SECRETS)) expect(yml).toContain("${{ secrets." + name + " }}");
    expect([...new Set([...yml.matchAll(/secrets\.([A-Z_]+)/g)].map((m) => m[1]))].sort()).toEqual([
      "EGG_ENV_PREVIEW_TOKEN",
      "EGG_ENV_PRODUCTION_TOKEN",
      "EGG_UPLOAD_PREVIEW_TOKEN",
      "EGG_UPLOAD_PRODUCTION_TOKEN",
    ]);
    expect(yml).not.toMatch(/egg_build_/);
    expect(yml).not.toMatch(/[–—]/);
  });

  it("keeps the production credentials in the egg-production environment and out of the preview job, for every runtime", () => {
    expect(PRODUCTION_ENVIRONMENT).toBe("egg-production");
    for (const runtime of RUNTIMES) {
      const yml = make({ runtime, outputDir: runtime === "static" ? "dist" : null });
      const production = jobText(yml, "build-production");
      const preview = jobText(yml, "build-preview");
      // The production job names the environment, runs only on the production branch, and reads both production secrets.
      expect(production).toContain("    environment: egg-production\n");
      expect(production).toContain("    if: github.ref_name == 'main'\n");
      expect(production).toContain("EGG_ENV_TOKEN: ${{ secrets.EGG_ENV_PRODUCTION_TOKEN }}");
      expect(production).toContain("EGG_UPLOAD_TOKEN: ${{ secrets.EGG_UPLOAD_PRODUCTION_TOKEN }}");
      expect(production).not.toMatch(/PREVIEW/);
      // The preview job has no environment, runs on every other branch, and never mentions a production secret.
      expect(preview).not.toContain("environment:");
      expect(preview).toContain("    if: github.ref_name != 'main'\n");
      expect(preview).toContain("EGG_ENV_TOKEN: ${{ secrets.EGG_ENV_PREVIEW_TOKEN }}");
      expect(preview).toContain("EGG_UPLOAD_TOKEN: ${{ secrets.EGG_UPLOAD_PREVIEW_TOKEN }}");
      expect(preview).not.toMatch(/PRODUCTION|egg-production/);
      // The workflow-level part and the comments hold no secret reference.
      expect(yml.replace(production, "").replace(preview, "")).not.toContain("${{ secrets.");
      // The preview job asks Egg for the preview variables, the production job for the production ones.
      expect(preview).toContain("/api/builds/env?env=preview");
      expect(production).not.toContain("env=preview");
    }
  });

  it("makes a file shaped like YAML for every runtime: no tabs, the expected top-level keys, two jobs", () => {
    for (const runtime of RUNTIMES) {
      const yml = make({ runtime, outputDir: runtime === "static" ? "dist" : null, rootDir: "apps/web" });
      expect(yml).not.toContain("\t");
      expect(yml.endsWith("\n")).toBe(true);
      const lines = yml.split("\n");
      expect(lines.filter((l) => /^[a-z-]+:/.test(l)).map((l) => l.split(":")[0])).toEqual([
        "name",
        "on",
        "permissions",
        "concurrency",
        "env",
        "jobs",
      ]);
      const afterJobs = lines.slice(lines.indexOf("jobs:") + 1);
      expect(afterJobs.filter((l) => /^ {2}[a-z][a-z-]*:\s*$/.test(l))).toEqual(["  build-production:", "  build-preview:"]);
      for (const job of ["build-production", "build-preview"] as const) {
        const text = jobText(yml, job);
        expect(text).toContain("\n    runs-on: ubuntu-latest\n");
        expect(text).toContain("\n    steps:\n      - name: Check out the code\n");
        expect(text).toContain('        working-directory: "apps/web"');
      }
    }
  });

  it("says where each secret is saved: the production ones in the environment, the preview ones in the repository", () => {
    expect(WORKFLOW_SECRET_LIST.map((s) => [s.name, s.store])).toEqual([
      ["EGG_UPLOAD_PRODUCTION_TOKEN", "environment"],
      ["EGG_ENV_PRODUCTION_TOKEN", "environment"],
      ["EGG_UPLOAD_PREVIEW_TOKEN", "repository"],
      ["EGG_ENV_PREVIEW_TOKEN", "repository"],
    ]);
    expect(make()).toContain("Do not save the two production values as repository secrets");
    expect(make()).toContain("After upgrading from the earlier three-token workflow, make new build credentials and copy this workflow again.");
    expect(make()).toContain("delete the old EGG_UPLOAD_TOKEN repository secret");
    expect(make()).toContain("remove any repository-level EGG_ENV_PRODUCTION_TOKEN");
  });

  it("follows the server contract: the upload route, its four headers, the env route and the Authorization header", () => {
    const yml = make();
    expect(yml).toContain('EGG_URL: "https://egg.example.com"');
    expect(yml).toContain("$EGG_URL/api/builds/upload");
    expect(yml).toContain("/api/builds/env");
    expect(yml).toContain('?env=preview');
    for (const h of ["X-Egg-Commit", "X-Egg-Sha256", "X-Egg-Branch", "X-Egg-Run"]) expect(yml).toContain(`-H "${h}:`);
    expect(yml).toContain('-H "Authorization: Bearer $EGG_UPLOAD_TOKEN"');
    // Credentials are never put in a URL.
    expect(yml).not.toMatch(/\?[a-z_]*token=/i);
    expect(yml).toContain(`${MAX_ARCHIVE_BYTES}`);
    // Event data is passed through env, not pasted into a script.
    expect(yml).toContain("EGG_BRANCH: ${{ github.ref_name }}");
    expect(yml).toContain("EGG_COMMIT: ${{ github.sha }}");
    expect(yml).not.toMatch(/run:[^\n]*\$\{\{/);
    expect(yml).toContain("contents: read");
  });

  it("runs on a push to any branch (not tags), as Egg makes a deployment for each, and by hand", () => {
    const yml = make();
    expect(yml).toMatch(/\non:\n(  #[^\n]*\n)*  push:\n    branches: \["\*\*"\]\n/);
    expect(yml).toContain("  workflow_dispatch:");
    expect(yml).toContain('EGG_PRODUCTION_BRANCH: "main"');
    // A tag push makes no deployment in Egg, so tags must not start the workflow.
    expect(yml).not.toContain("tags");
    expect(make({ productionBranch: "release/1.x" })).toContain('EGG_PRODUCTION_BRANCH: "release/1.x"');
  });

  it("uses the project's own install and build commands when it has them", () => {
    const yml = make({ installCommand: "npm install --legacy-peer-deps", buildCommand: "npm run compile" });
    expect(yml).toContain("          npm install --legacy-peer-deps");
    expect(yml).toContain("          npm run compile");
    expect(yml).not.toContain("pnpm-lock.yaml");
  });

  it("chooses the package manager from the lockfile in the same order as the container build when no command is set", () => {
    const yml = make();
    const pnpm = yml.indexOf("pnpm install --frozen-lockfile");
    const yarn = yml.indexOf("yarn install --frozen-lockfile");
    const npm = yml.indexOf("npm ci");
    expect(pnpm).toBeGreaterThan(0);
    expect(yarn).toBeGreaterThan(pnpm);
    expect(npm).toBeGreaterThan(yarn);
    expect(yml).toContain("scripts?.build");
  });

  it("packs a Node release without node_modules and sets Node up", () => {
    const yml = make();
    expect(yml).toContain("actions/setup-node@v4");
    expect(yml).toContain('tar --exclude=node_modules --exclude=.git --exclude=.github -czf "$RUNNER_TEMP/release.tar.gz" -C "." .');
  });

  it("runs the steps in the root directory of a monorepo", () => {
    const yml = make({ rootDir: "apps/web" });
    expect(yml).toContain('    defaults:\n      run:\n        working-directory: "apps/web"');
    expect(make({ rootDir: "." })).not.toContain("working-directory");
    expect(make({ rootDir: "./" })).not.toContain("working-directory");
  });

  it("sends only the output directory of a static site", () => {
    const yml = make({ runtime: "static", outputDir: "dist" });
    expect(yml).toContain('-C "dist" .');
    expect(make({ runtime: "static", outputDir: null })).toContain('-C "." .');
  });

  it("sets Python up for a Python project and installs only a command that was set", () => {
    const yml = make({ runtime: "python" });
    expect(yml).toContain("actions/setup-python@v5");
    expect(yml).not.toContain("actions/setup-node");
    expect(yml).not.toContain("- name: Install");
    expect(yml).not.toContain("- name: Build");
    expect(make({ runtime: "python", buildCommand: "python build.py" })).toContain("python build.py");
  });

  it("sets nothing up for a custom command", () => {
    const yml = make({ runtime: "command", buildCommand: "make release" });
    expect(yml).not.toContain("actions/setup-");
    expect(yml).toContain("make release");
  });

  it("refuses settings that cannot be put in a file safely", () => {
    expect(() => make({ productionBranch: 'main"\nrun: x' })).toThrow(WorkflowError);
    expect(() => make({ rootDir: "../outside" })).toThrow(WorkflowError);
    expect(() => make({ rootDir: "/etc" })).toThrow(WorkflowError);
    expect(() => make({ runtime: "static", outputDir: "../x" })).toThrow(WorkflowError);
    expect(() => make({ eggUrl: "not a url" })).toThrow(WorkflowError);
    expect(() => make({ eggUrl: "javascript:alert(1)" })).toThrow(WorkflowError);
  });
});

// ---- the two scripts, run for real -----------------------------------------------------------------

const dirs: string[] = [];
const temp = () => {
  const d = mkdtempSync(path.join(tmpdir(), "egg-wf-"));
  dirs.push(d);
  return d;
};
afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

type Seen = { method: string; url: string; headers: http.IncomingHttpHeaders; body: Buffer };

async function serve(answer: (req: Seen, n: number) => { status: number; body?: unknown }) {
  const seen: Seen[] = [];
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const entry = { method: req.method ?? "", url: req.url ?? "", headers: req.headers, body: Buffer.concat(chunks) };
      seen.push(entry);
      const a = answer(entry, seen.length);
      res.writeHead(a.status, { "content-type": "application/json" });
      res.end(JSON.stringify(a.body ?? {}));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as { port: number }).port;
  return { url: `http://127.0.0.1:${port}`, seen, close: () => new Promise<void>((r) => server.close(() => r())) };
}

function runNode(script: string, env: Record<string, string>) {
  return new Promise<{ code: number | null; out: string; err: string }>((resolve) => {
    const script_ = path.join(temp(), "step.cjs");
    writeFileSync(script_, script);
    const child = spawn(process.execPath, [script_], { env: { PATH: process.env.PATH ?? "", ...env } as unknown as NodeJS.ProcessEnv });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("close", (code) => resolve({ code, out, err }));
  });
}

describe("the step that loads build variables", () => {
  // Each job gives the script the one credential of its environment as EGG_ENV_TOKEN.
  const envFor = (url: string, target: "production" | "preview", file: string) => ({
    EGG_URL: url,
    EGG_ENV_TOKEN: target === "production" ? "egg_build_env_production_PRODTOKEN" : "egg_build_env_preview_PREVIEWTOKEN",
    GITHUB_ENV: file,
  });

  it("asks for production variables with the production script, masks every value, and exports them", async () => {
    const s = await serve(() => ({ status: 200, body: { API_URL: "https://api.test", SECRET: "line1\nline2", EMPTY: "", "bad-key": "x" } }));
    const file = path.join(temp(), "github_env");
    writeFileSync(file, "");
    const r = await runNode(envStepScript("production"), envFor(s.url, "production", file));
    await s.close();
    expect(r.code, r.err).toBe(0);
    expect(s.seen[0].url).toBe("/api/builds/env");
    expect(s.seen[0].headers.authorization).toBe("Bearer egg_build_env_production_PRODTOKEN");
    const lines = r.out.split("\n");
    expect(lines.indexOf("::add-mask::https://api.test")).toBeGreaterThanOrEqual(0);
    expect(lines).toContain("::add-mask::line1");
    expect(lines).toContain("::add-mask::line2");
    expect(r.out).toContain("Loaded 2 build variables from Egg.");
    // Every mask comes before the variables are written; the export uses a random delimiter.
    const exported = readFileSync(file, "utf8");
    expect(exported).toMatch(/^API_URL<<EGG_[0-9a-f]{32}\nhttps:\/\/api\.test\nEGG_[0-9a-f]{32}\n/);
    expect(exported).toContain("SECRET<<");
    expect(exported).toContain("line1\nline2\n");
    expect(exported).not.toContain("EMPTY");
    expect(exported).not.toContain("bad-key");
    expect(r.out + r.err).not.toContain("PRODTOKEN");
  });

  it("asks for preview variables with the preview script", async () => {
    const s = await serve(() => ({ status: 200, body: {} }));
    const file = path.join(temp(), "github_env");
    writeFileSync(file, "");
    const r = await runNode(envStepScript("preview"), envFor(s.url, "preview", file));
    await s.close();
    expect(r.code, r.err).toBe(0);
    expect(s.seen[0].url).toBe("/api/builds/env?env=preview");
    expect(s.seen[0].headers.authorization).toBe("Bearer egg_build_env_preview_PREVIEWTOKEN");
    expect(r.out).toContain("Loaded 0 build variables from Egg.");
  });

  it("fails with a sentence that names the secret, and never prints the credential, when Egg refuses it", async () => {
    const s = await serve(() => ({ status: 401, body: { error: { code: "unauthorized", message: BAD_BUILD_CREDENTIAL } } }));
    const file = path.join(temp(), "github_env");
    writeFileSync(file, "");
    const r = await runNode(envStepScript("production"), envFor(s.url, "production", file));
    await s.close();
    expect(r.code).toBe(1);
    expect(r.err).toContain("Egg answered 401");
    expect(r.err).toContain("EGG_ENV_PRODUCTION_TOKEN");
    expect(r.out + r.err).not.toContain("PRODTOKEN");
    expect(readFileSync(file, "utf8")).toBe("");
  });

  it("fails before any request when the secret is empty", async () => {
    const s = await serve(() => ({ status: 200, body: {} }));
    const file = path.join(temp(), "github_env");
    const r = await runNode(envStepScript("production"), { ...envFor(s.url, "production", file), EGG_ENV_TOKEN: "" });
    await s.close();
    expect(r.code).toBe(1);
    expect(r.err).toContain("EGG_ENV_PRODUCTION_TOKEN secret is empty");
    expect(r.err).toContain("egg-production environment");
    expect(s.seen).toHaveLength(0);
  });
});

/** On Windows `bash` can be the WSL launcher, which hangs, so only Git's own bash is used there. */
const GIT_BASH = "C:/Program Files/Git/usr/bin/bash.exe";
const BASH = process.platform === "win32" ? (existsSync(GIT_BASH) ? GIT_BASH : null) : "bash";
const bashWorks = (() => {
  if (!BASH) return false;
  const r = spawnSync(BASH, ["-c", "command -v curl >/dev/null && command -v sha256sum >/dev/null && stat -c %s /dev/null"], { encoding: "utf8", timeout: 10_000 });
  return r.status === 0;
})();

describe.skipIf(!bashWorks)("the upload step", () => {
  it("is valid shell", () => {
    expect(() => execFileSync(BASH as string, ["-n"], { input: uploadScript() })).not.toThrow();
  });

  function run(url: string, release: Buffer, extra: Record<string, string> = {}) {
    const dir = temp();
    const posix = (p: string) => p.replace(/\\/g, "/");
    const shims = path.join(dir, "bin");
    writeFileSync(path.join(dir, "release.tar.gz"), release);
    // Waits are skipped so the retry path is quick.
    execFileSync(BASH as string, ["-c", `mkdir -p "${posix(shims)}" && printf '#!/bin/sh\\nexit 0\\n' > "${posix(shims)}/sleep" && chmod +x "${posix(shims)}/sleep"`]);
    // Asynchronous: the test server lives in this process and has to answer while the script runs.
    return new Promise<{ status: number | null; stdout: string; stderr: string }>((resolve) => {
      const child = spawn(BASH as string, ["-c", uploadScript()], {
        env: {
          PATH: `${posix(shims)}:${process.env.PATH ?? ""}`,
          RUNNER_TEMP: posix(dir),
          EGG_URL: url,
          EGG_UPLOAD_TOKEN: "egg_build_upload_UPLOADTOKEN",
          EGG_BRANCH: "main",
          EGG_COMMIT: "a".repeat(40),
          GITHUB_RUN_ID: "123456",
          ...extra,
        } as unknown as NodeJS.ProcessEnv,
      });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (d) => (stdout += d));
      child.stderr.on("data", (d) => (stderr += d));
      child.on("close", (status) => resolve({ status, stdout, stderr }));
    });
  }

  const release = Buffer.concat([Buffer.from([0x1f, 0x8b]), Buffer.from("not really a release but the server here does not unpack it")]);

  it("sends exactly what the upload route reads, then stops on 202", async () => {
    const s = await serve(() => ({ status: 202, body: { deployment: { id: "d1" } } }));
    const r = await run(s.url, release);
    await s.close();
    expect(r.status, r.stderr).toBe(0);
    expect(s.seen).toHaveLength(1);
    const got = s.seen[0];
    expect(got.method).toBe("POST");
    expect(got.url).toBe("/api/builds/upload");
    expect(got.headers.authorization).toBe("Bearer egg_build_upload_UPLOADTOKEN");
    // The route's own header parser accepts them, and the checksum is of the bytes that arrived.
    const parsed = parseUploadHeaders(new Headers(got.headers as Record<string, string>));
    expect(parsed).toEqual({
      commit: "a".repeat(40),
      sha256: createHash("sha256").update(release).digest("hex"),
      branch: "main",
      run: "123456",
    });
    expect(got.body.equals(release)).toBe(true);
    expect(r.stdout + r.stderr).not.toContain("UPLOADTOKEN");
  });

  it("tries again while no deployment is waiting yet, and while Egg is busy", async () => {
    const s = await serve((_req, n) =>
      n === 1
        ? { status: 409, body: { error: { code: "no_deployment_waiting", message: "No deployment is waiting for this commit." } } }
        : n === 2
          ? { status: 503, body: { error: { code: "busy", message: "busy" } } }
          : { status: 202 }
    );
    const r = await run(s.url, release);
    await s.close();
    expect(r.status, r.stderr).toBe(0);
    expect(s.seen).toHaveLength(3);
    expect(r.stdout).toContain("Trying again");
  });

  it("does not retry an answer that will not change, and prints Egg's reason", async () => {
    const s = await serve(() => ({ status: 409, body: { error: { code: "already_received", message: "This deployment already has its build." } } }));
    const r = await run(s.url, release);
    await s.close();
    expect(r.status).toBe(1);
    expect(s.seen).toHaveLength(1);
    expect(r.stderr).toContain("already has its build");
    expect(r.stdout + r.stderr).not.toContain("UPLOADTOKEN");
  });

  it("gives up after six tries", async () => {
    const s = await serve(() => ({ status: 429, body: { error: { code: "rate_limited", message: "slow down" } } }));
    const r = await run(s.url, release);
    await s.close();
    expect(r.status).toBe(1);
    expect(s.seen).toHaveLength(6);
  });
});
