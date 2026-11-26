import { mkdtempSync, rmSync, writeFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ArchiveError, MAX_ENTRIES, MAX_UNPACKED_BYTES, inspectArchive } from "@/server/builds/archive-check";
import { rawTarGz, type RawEntry } from "@/server/test/raw-tar";

let dir: string;
let n = 0;

function write(bytes: Buffer): string {
  const f = path.join(dir, `a${n++}.tar.gz`);
  writeFileSync(f, bytes);
  return f;
}
const check = (entries: RawEntry[], limits = {}) => inspectArchive(write(rawTarGz(entries)), limits);
const others = () => readdirSync(dir).filter((f) => !/^a\d+\.tar\.gz$/.test(f));

/** The archive is refused with this reason, and nothing but the archives is in the folder: nothing was unpacked. */
const refused = async (entries: RawEntry[], pattern: RegExp, limits = {}) => {
  const err = await check(entries, limits).then(
    () => null,
    (e) => e
  );
  expect(err).toBeInstanceOf(ArchiveError);
  expect((err as Error).message).toMatch(pattern);
  expect(others()).toEqual([]);
};

beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), "egg-archive-"));
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("inspectArchive", () => {
  it("accepts a normal release and reads what the install needs from it", async () => {
    const info = await check([
      { name: "./", type: "5" },
      { name: "./package.json", content: JSON.stringify({ engines: { node: ">=22" }, scripts: { build: "x" } }) },
      { name: "./package-lock.json", content: "{}" },
      { name: "./server.js", content: "x" },
      { name: "./node_modules/", type: "5" },
      { name: "./node_modules/foo/", type: "5" },
      { name: "./node_modules/foo/bin.js", content: "x" },
      { name: "./node_modules/.bin/", type: "5" },
      // A link that goes up and back down, as package managers write them.
      { name: "./node_modules/.bin/foo", type: "2", linkname: "../foo/bin.js" },
    ]);
    expect(info.files).toMatchObject({ hasPackageJson: true, lockfile: "npm", nodeEngine: ">=22", hasBuildScript: true });
    expect(info.entries).toBe(9);
  });

  it("has the documented limits", () => {
    expect(MAX_ENTRIES).toBe(200_000);
    expect(MAX_UNPACKED_BYTES).toBe(2 * 1024 * 1024 * 1024);
  });

  it("refuses an absolute path", async () => {
    await refused([{ name: "/etc/cron.d/egg", content: "x" }], /absolute path/);
  });

  it("refuses a path that climbs out with ..", async () => {
    await refused([{ name: "app/../../evil.sh", content: "x" }], /"\.\."/);
    await refused([{ name: "../evil.sh", content: "x" }], /"\.\."/);
  });

  it("refuses a backslash in a name", async () => {
    // On Windows the tar reader turns the backslash into a slash first, so either reason applies.
    await refused([{ name: "..\\evil.sh", content: "x" }], /not allowed|climbs out/);
  });

  it("refuses a symbolic link that points outside the release", async () => {
    await refused([{ name: "out", type: "2", linkname: "/etc" }], /absolute path/);
    await refused([{ name: "out", type: "2", linkname: "../../etc" }], /points outside the release/);
    await refused([{ name: "a/", type: "5" }, { name: "a/out", type: "2", linkname: "../.." }], /points outside the release/);
  });

  it("follows the archive's own links, so a link that only escapes through another link is caught", async () => {
    await refused(
      [
        { name: "d/", type: "5" },
        { name: "d/x", type: "2", linkname: ".." }, // the release root: fine on its own
        { name: "esc", type: "2", linkname: "d/x/../.." }, // through d/x it lands above the root
      ],
      /points outside the release/
    );
    await refused(
      [
        { name: "a", type: "2", linkname: "b" },
        { name: "b", type: "2", linkname: "a" },
      ],
      /points outside the release/
    );
  });

  it("refuses a hard link that points outside the release", async () => {
    await refused([{ name: "h", type: "1", linkname: "/etc/passwd" }], /absolute path/);
    await refused([{ name: "h", type: "1", linkname: "../secret" }], /"\.\."/);
  });

  it("refuses hard links to symlinks whose relative target changes when relocated", async () => {
    await refused(
      [
        { name: "d/", type: "5" },
        { name: "d/deep/", type: "5" },
        { name: "d/deep/safe", content: "inside" },
        { name: "d/deep/x", type: "2", linkname: "../../safe" },
        { name: "y", type: "1", linkname: "d/deep/x" },
      ],
      /hard link.*symbolic link/i
    );
  });

  it("refuses hard links through a chain of symlinks", async () => {
    await refused(
      [
        { name: "d/", type: "5" },
        { name: "d/deep/", type: "5" },
        { name: "d/deep/safe", content: "inside" },
        { name: "d/deep/first", type: "2", linkname: "../../safe" },
        { name: "alias", type: "2", linkname: "d/deep/first" },
        { name: "hard", type: "1", linkname: "alias" },
      ],
      /hard link.*symbolic link/i
    );
  });

  it("continues accepting an in-release hard link to a regular file", async () => {
    await expect(check([
      { name: "data", content: "safe" },
      { name: "copy", type: "1", linkname: "data" },
    ])).resolves.toMatchObject({ entries: 2, unpackedBytes: 4 });
  });

  it("refuses a device file or a pipe", async () => {
    await refused([{ name: "dev/null", type: "3" }], /special file/);
    await refused([{ name: "dev/disk", type: "4" }], /special file/);
    await refused([{ name: "pipe", type: "6" }], /special file/);
  });

  it("refuses a link whose name another entry reuses", async () => {
    await refused(
      [
        { name: "a", type: "2", linkname: "b" },
        { name: "a", content: "x" },
      ],
      /same path twice/
    );
  });

  it("refuses more entries than the limit, and accepts exactly the limit", async () => {
    const entries: RawEntry[] = Array.from({ length: 51 }, (_, i) => ({ name: `f${i}`, content: "x" }));
    await refused(entries, /more than 50 files/, { maxEntries: 50 });
    await expect(check(entries.slice(0, 50), { maxEntries: 50 })).resolves.toMatchObject({ entries: 50 });
  });

  it("refuses a release that would take too much disk when unpacked", async () => {
    await refused([{ name: "big", content: "x".repeat(2000) }], /larger than/, { maxUnpackedBytes: 1000 });
  });

  it("refuses an upload that is not gzip, or is damaged", async () => {
    await expect(inspectArchive(write(Buffer.from("not an archive at all")))).rejects.toThrow(/not a gzipped tar/);
    const good = rawTarGz([{ name: "a", content: "hello" }]);
    await expect(inspectArchive(write(good.subarray(0, 12)))).rejects.toBeInstanceOf(ArchiveError);
  });
});
