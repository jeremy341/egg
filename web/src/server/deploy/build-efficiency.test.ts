import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { packArchiveWithHash, directorySizeAsync } from "./build";

it("returns the digest of the exact compressed archive", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "egg-hash-"));
  try {
    writeFileSync(path.join(dir, "source"), "hello");
    const output = path.join(tmpdir(), `egg-${randomUUID()}.tar.gz`);
    try {
      const result = await packArchiveWithHash(dir, output, false, "source", () => {});
      const bytes = readFileSync(output);
      expect(result).toEqual({ sizeBytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") });
    } finally { rmSync(output, { force: true }); }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

it("counts clone files asynchronously and stops at the byte limit", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "egg-size-"));
  try {
    for (let i = 0; i < 4; i++) writeFileSync(path.join(dir, String(i)), Buffer.alloc(100));
    const size = await directorySizeAsync(dir, 150);
    expect(size).toBe(200);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
