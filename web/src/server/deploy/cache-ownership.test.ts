import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";
import { removeProject, cleanupOwnedProject } from "./remote";
import { diskWatchdogStartScript } from "./container-build";
import { removeManagedDownloadCache } from "./download-cache";

const bash = process.platform === "win32" ? "C:/Program Files/Git/bin/bash.exe" : "bash";
const q = (s: string) => `'${s.replace(/'/g, "'\\''")}'`;
const shellPath = (s: string) => s.replaceAll("\\", "/");
const run = (script: string) => spawnSync(bash, ["-c", script], { encoding: "utf8", timeout: 10000 });

it("removes marked cache entries and preserves unmarked hash-shaped user directories", () => {
  const home = mkdtempSync(path.join(tmpdir(), "egg-cache-selective-"));
  try {
    const cache = path.join(home, "cache");
    const root = path.join(cache, "npm", "production");
    const owned = path.join(root, "a".repeat(64));
    const foreign = path.join(root, "b".repeat(64));
    mkdirSync(owned, { recursive: true }); mkdirSync(foreign);
    writeFileSync(path.join(cache, ".egg-cache-managed"), "");
    writeFileSync(path.join(owned, ".egg-cache-entry-managed"), "");
    writeFileSync(path.join(foreign, "keep"), "precious");
    const result = run(removeManagedDownloadCache(shellPath(home)));
    expect(result.status).toBe(0);
    expect(existsSync(owned)).toBe(false);
    expect(existsSync(path.join(foreign, "keep"))).toBe(true);
  } finally { rmSync(home, { recursive: true, force: true }); }
});

for (const mode of ["remove", "cleanup"] as const) {
  it(`${mode} preserves an unmanaged cache directory`, () => {
    const home = mkdtempSync(path.join(tmpdir(), "egg-cache-owned-"));
    try {
      const project = path.join(home, ".egg", "demo");
      mkdirSync(path.join(project, "cache", "npm", "preview"), { recursive: true });
      writeFileSync(path.join(project, ".egg-managed"), "");
      const keep = path.join(project, "cache", "npm", "preview", "user-data");
      writeFileSync(keep, "keep");
      const common = { home: shellPath(home), slug: "demo", unitDir: shellPath(home) };
      const script = mode === "remove" ? removeProject({ ...common, unit: "missing.service", deleteData: false }) : cleanupOwnedProject({ ...common, units: [] });
      const result = run(`systemctl() { return 0; }\n${script}`);
      expect(result.stderr).toBe("");
      expect(result.status).toBe(0);
      expect(existsSync(keep)).toBe(true);
    } finally { rmSync(home, { recursive: true, force: true }); }
  });
}

it("does not stop a build for a large unmanaged cache", () => {
  const home = mkdtempSync(path.join(tmpdir(), "egg-cache-watch-"));
  try {
    const dir = path.join(home, "releases", "id"), root = path.join(home, "cache", "npm", "preview");
    mkdirSync(dir, { recursive: true }); mkdirSync(root, { recursive: true });
    const script = `dir=${q(shellPath(dir))}\ndf() { printf 'header\\na b c 9999\\n'; }\ndu() { case "$2" in *cache*) echo '257 x';; *) echo '1 x';; esac; }\nsystemctl() { return 0; }\n${diskWatchdogStartScript({ scope: "egg-build-12345678", cacheRoot: shellPath(root) })}\nsleep 1\nkill "$egg_wd_pid" 2>/dev/null || true\nwait "$egg_wd_pid" 2>/dev/null || true\n`;
    const result = run(script);
    expect(result.status).toBe(0);
    expect(result.stderr).not.toContain("cache limit was crossed");
    expect(existsSync(path.join(dir, ".egg-disk-stop"))).toBe(false);
  } finally { rmSync(home, { recursive: true, force: true }); }
});
