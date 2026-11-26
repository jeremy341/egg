import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import * as tar from "tar";
import { gunzipSync, gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { buildProviderSource } from "./source";

describe("provider archive source", () => {
  it("rejects archives containing links before extraction", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "provider-link-test-"));
    try {
      mkdirSync(path.join(dir, "fixture", "root"), { recursive: true });
      writeFileSync(path.join(dir, "fixture", "root", "file"), "content");
      await tar.c({ gzip: true, cwd: path.join(dir, "fixture"), file: path.join(dir, "a.tar.gz") }, ["root"]);
      const raw = gunzipSync(readFileSync(path.join(dir, "a.tar.gz")));
      const offset = raw.indexOf(Buffer.from("root/file"));
      expect(offset).toBeGreaterThanOrEqual(0);
      raw[offset + 156] = "2".charCodeAt(0);
      Buffer.from("../../escape").copy(raw, offset + 157);
      raw.fill(32, offset + 148, offset + 156);
      let sum = 0; for (const byte of raw.subarray(offset, offset + 512)) sum += byte;
      Buffer.from(sum.toString(8).padStart(6, "0") + "\0 ").copy(raw, offset + 148);
      const sha = "a".repeat(40);
      const api = { branchCommit: async () => sha, downloadArchive: async (_repo: string, _sha: string, destination: string) => { writeFileSync(destination, gzipSync(raw)); } };
      const req = { deploymentId: "d", runtime: { runtime: "node" as const, installCommand: null, buildCommand: null, startCommand: null, outputDir: null }, rootDir: ".", source: { cloneUrl: "https://example.com/a/b", branch: "main" }, env: {}, log: () => {} };
      await expect(buildProviderSource(req, api, "a/b", { sha, requireBranchMatch: true }, path.join(dir, "work"))).rejects.toThrow();
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  it("packs the authorized exact commit and rejects changed webhook branch heads", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "provider-source-test-"));
    try {
      mkdirSync(path.join(dir, "fixture", "repo-root"), { recursive: true });
      writeFileSync(path.join(dir, "fixture", "repo-root", "package.json"), '{"scripts":{"start":"node app.js"}}');
      await tar.c({ gzip: true, cwd: path.join(dir, "fixture"), file: path.join(dir, "fixture.tar.gz") }, ["repo-root"]);
      const sha = "a".repeat(40); let downloaded = false;
      const api = { branchCommit: async () => sha, downloadArchive: async (_repo: string, commit: string, destination: string) => { expect(commit).toBe(sha); downloaded = true; writeFileSync(destination, readFileSync(path.join(dir, "fixture.tar.gz"))); } };
      const request = { deploymentId: "d", runtime: { runtime: "node" as const, installCommand: null, buildCommand: null, startCommand: null, outputDir: null }, rootDir: ".", source: { cloneUrl: "https://example.com/a/b.git", branch: "main" }, env: {}, log: () => {} };
      await expect(buildProviderSource(request, api, "a/b", { sha: "b".repeat(40), requireBranchMatch: true }, path.join(dir, "work1"))).rejects.toThrow();
      expect(downloaded).toBe(false);
      const result = await buildProviderSource(request, api, "a/b", { sha, requireBranchMatch: true }, path.join(dir, "work2"));
      expect(result.commit.sha).toBe(sha); expect(result.files.hasPackageJson).toBe(true); expect(result.sizeBytes).toBeGreaterThan(0);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});


