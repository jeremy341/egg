import { mkdtempSync, mkdirSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { BuildRequest } from "@/server/deploy/build";
import {
  BuildError,
  assertRequestedCommit,
  cloneSource,
  directorySize,
  packArchive,
  ensureRequestedCommit,
  watchCloneSize,
} from "@/server/deploy/build";

const SHA = "a".repeat(40);
const OTHER_SHA = "b".repeat(40);
let root: string;
beforeAll(() => { root = mkdtempSync(path.join(tmpdir(), "egg-build-source-")); });
afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("exact commit redeploys", () => {
  it("accepts only the exact requested commit SHA", () => {
    expect(assertRequestedCommit(SHA, SHA.toUpperCase())).toBe(SHA);
    expect(() => assertRequestedCommit(SHA, OTHER_SHA)).toThrow(/requested commit/i);
  });

  it("fails when the requested SHA cannot be fetched", async () => {
    const checkout = vi.fn(async () => 0);
    await expect(ensureRequestedCommit(SHA, {
      readHead: async () => OTHER_SHA,
      fetch: async () => 1,
      checkout,
    })).rejects.toBeInstanceOf(BuildError);
    expect(checkout).not.toHaveBeenCalled();
  });

  it("fails when checkout fails or HEAD is not the requested SHA", async () => {
    await expect(ensureRequestedCommit(SHA, {
      readHead: async () => OTHER_SHA,
      fetch: async () => 0,
      checkout: async () => 1,
    })).rejects.toThrow(/checkout/i);
    let reads = 0;
    await expect(ensureRequestedCommit(SHA, {
      readHead: async () => (++reads === 1 ? OTHER_SHA : "c".repeat(40)),
      fetch: async () => 0,
      checkout: async () => 0,
    })).rejects.toThrow(/requested commit/i);
  });
});

describe("source archive resource bounds", () => {
  it("rejects oversized unpacked sources and removes the partial archive", async () => {
    const dir = path.join(root, "large-tree");
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "large.bin"), Buffer.alloc(4096));
    const output = path.join(root, "too-large.tar.gz");
    await expect(packArchive(dir, output, false, "source", () => {}, { maxUnpackedBytes: 1024 })).rejects.toThrow(/unpacked/i);
    expect(existsSync(output)).toBe(false);
  });

  it("caps source entry count", async () => {
    const dir = path.join(root, "many-files");
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "one.txt"), "1");
    writeFileSync(path.join(dir, "two.txt"), "2");
    const output = path.join(root, "too-many.tar.gz");
    await expect(packArchive(dir, output, false, "source", () => {}, { maxEntries: 2 })).rejects.toThrow(/source entries/i);
    expect(existsSync(output)).toBe(false);
  });

  it("bounds compressed output and removes a partial archive on overflow", async () => {
    const dir = path.join(root, "compressed-tree");
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "random.bin"), randomBytes(4096));
    const output = path.join(root, "compressed-too-large.tar.gz");
    await expect(packArchive(dir, output, false, "source", () => {}, { maxArchiveBytes: 128 })).rejects.toThrow(/compressed source/i);
    expect(existsSync(output)).toBe(false);
  });
});

describe("clone size limits", () => {
  it("counts files in nested folders", () => {
    const dir = mkdtempSync(path.join(root, "nested-"));
    mkdirSync(path.join(dir, "a", "b"), { recursive: true });
    writeFileSync(path.join(dir, "a", "b", "c.txt"), Buffer.alloc(10));
    writeFileSync(path.join(dir, "a", "d.txt"), Buffer.alloc(20));
    expect(directorySize(dir, Number.MAX_SAFE_INTEGER)).toBe(30);
  });

  it("stops counting early once the total passes stopAt", () => {
    const dir = mkdtempSync(path.join(root, "early-"));
    for (const name of ["one", "two", "three"]) writeFileSync(path.join(dir, `${name}.bin`), Buffer.alloc(100));
    const counted = directorySize(dir, 150);
    expect(counted).toBeGreaterThan(150);
    expect(counted).toBeLessThan(300);
  });

  it("does not follow a symbolic link", (ctx) => {
    const dir = mkdtempSync(path.join(root, "link-"));
    const outside = mkdtempSync(path.join(root, "outside-"));
    writeFileSync(path.join(outside, "secret.bin"), Buffer.alloc(4096));
    writeFileSync(path.join(dir, "own.txt"), Buffer.alloc(5));
    try {
      symlinkSync(outside, path.join(dir, "link"), process.platform === "win32" ? "junction" : "dir");
    } catch {
      ctx.skip();
      return;
    }
    expect(directorySize(dir, Number.MAX_SAFE_INTEGER)).toBe(5);
  });
});

describe("clone size watcher", () => {
  const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  it("fires once when the folder grows past maxBytes", async () => {
    const dir = mkdtempSync(path.join(root, "grow-"));
    const onExceed = vi.fn();
    const watcher = watchCloneSize(dir, { maxBytes: 1024, minFreeBytes: 0, intervalMs: 20 }, onExceed);
    writeFileSync(path.join(dir, "big.bin"), Buffer.alloc(4096));
    await vi.waitFor(() => expect(onExceed).toHaveBeenCalled());
    await wait(80);
    watcher.stop();
    expect(onExceed).toHaveBeenCalledTimes(1);
    const error = onExceed.mock.calls[0][0];
    expect(error).toBeInstanceOf(BuildError);
    expect(error.message).toMatch(/larger than/);
  });

  it("does not fire for a small folder", async () => {
    const dir = mkdtempSync(path.join(root, "small-"));
    writeFileSync(path.join(dir, "small.txt"), "hello");
    const onExceed = vi.fn();
    const watcher = watchCloneSize(dir, { maxBytes: 1024, minFreeBytes: 0, intervalMs: 20 }, onExceed);
    await wait(100);
    watcher.stop();
    expect(onExceed).not.toHaveBeenCalled();
  });

  it("does not fire after stop()", async () => {
    const dir = mkdtempSync(path.join(root, "stopped-"));
    const onExceed = vi.fn();
    const watcher = watchCloneSize(dir, { maxBytes: 1024, minFreeBytes: 0, intervalMs: 20 }, onExceed);
    watcher.stop();
    writeFileSync(path.join(dir, "big.bin"), Buffer.alloc(4096));
    await wait(100);
    expect(onExceed).not.toHaveBeenCalled();
  });

  it("fires the nearly full message when minFreeBytes cannot be met", async () => {
    const dir = mkdtempSync(path.join(root, "full-"));
    const onExceed = vi.fn();
    const watcher = watchCloneSize(dir, { maxBytes: Number.MAX_SAFE_INTEGER, minFreeBytes: Number.MAX_SAFE_INTEGER, intervalMs: 20 }, onExceed);
    await vi.waitFor(() => expect(onExceed).toHaveBeenCalled());
    watcher.stop();
    expect(onExceed).toHaveBeenCalledTimes(1);
    expect(onExceed.mock.calls[0][0].message).toMatch(/nearly full/);
  });
});

describe("clone refuses a nearly full disk before git runs", () => {
  it("throws before starting git and leaves the work folder empty", async () => {
    const work = mkdtempSync(path.join(root, "clone-full-"));
    const srcDir = path.join(work, "src");
    const req = {
      deploymentId: "dep",
      runtime: {},
      rootDir: ".",
      source: { cloneUrl: "https://github.com/acme/app.git", branch: "main" },
      env: {},
      log: () => {},
    } as unknown as BuildRequest;
    await expect(cloneSource(req, srcDir, () => {}, () => {}, { minFreeBytes: Number.MAX_SAFE_INTEGER }))
      .rejects.toThrow(/nearly full/);
    expect(readdirSync(work)).toEqual([]);
  });
});
