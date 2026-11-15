import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const roots: string[] = [];
function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), "egg-backup-test-"));
  roots.push(root);
  mkdirSync(path.join(root, "deploy"));
  mkdirSync(path.join(root, "bin"));
  for (const name of ["backup.sh", "upgrade.sh"]) copyFileSync(path.resolve("../deploy", name), path.join(root, "deploy", name));
  writeFileSync(path.join(root, "compose.yaml"), "services: {}\n");
  return root;
}
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

describe("backup safety", () => {
  it("refuses to silently choose the default file for a custom database URL", () => {
    const root = fixture();
    writeFileSync(path.join(root, ".env"), "EGG_DATA_DIR=/tmp/egg\nDATABASE_URL=file:/data/other.db\n");
    const result = spawnSync("sh", [path.join(root, "deploy/backup.sh")], { encoding: "utf8", env: { ...process.env, DATABASE_URL: "" } });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("DATABASE_URL is not the default");
  });

  it("stops an upgrade if the running app cannot be inspected", () => {
    const root = fixture();
    writeFileSync(path.join(root, ".env"), "APP_HOST=example.test\n");
    const docker = path.join(root, "bin/docker");
    writeFileSync(docker, "#!/bin/sh\nexit 0\n");
    chmodSync(docker, 0o755);
    const result = spawnSync("sh", [path.join(root, "deploy/upgrade.sh")], { encoding: "utf8", env: { ...process.env, PATH: `${path.join(root, "bin")}${path.delimiter}${process.env.PATH}` } });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("app container must be running");
  });
});
