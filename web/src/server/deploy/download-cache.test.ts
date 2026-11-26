import { expect, it } from "vitest";
import { npmCachePlan, npmCacheScript } from "./download-cache";
import { spawnSync } from "node:child_process";
import { linuxTestHostAvailable, startMockSsh } from "@/server/test/mock-ssh";
import { NestSession } from "@/server/ssh/connection";
import { generateServerKey } from "@/server/ssh/keys";
const base = { enabled: true, env: "production" as const, lockHash: "a".repeat(64), buildInstall: "npm ci", remoteInstall: "npm ci --omit=dev" };
it("only enables an opted-in lockfile-backed default npm install", () => {
  expect(npmCachePlan(base)).not.toBeNull();
  expect(npmCachePlan({ ...base, enabled: false })).toBeNull();
  expect(npmCachePlan({ ...base, lockHash: null })).toBeNull();
  expect(npmCachePlan({ ...base, buildInstall: "npm install" })).toBeNull();
  expect(npmCachePlan({ ...base, env: "preview" })?.context).toBe("preview");
});
it("rejects unsafe lock keys", () => {
  expect(npmCachePlan({ ...base, lockHash: "../../outside" })).toBeNull();
});

it.skipIf(!linuxTestHostAvailable())("reuses scoped npm content and repairs corruption on Linux", async () => {
  const key = generateServerKey("cache-test");
  const mock = await startMockSsh({ authorizedKeys: [key.publicKey] });
  const session = await NestSession.connect({ host: "127.0.0.1", port: mock.port, username: "test", privateKey: key.privateKey });
  try {
    const project = `${mock.home}/project`, release = `${project}/releases/current`, root = `${project}/cache/npm/production`;
    mock.addShim("npm", `#!/bin/bash
case "$1" in
  --version) echo 10.1.0 ;;
  cache) if [ -f "${mock.home}/corrupt" ]; then rm "${mock.home}/corrupt"; exit 1; fi ;;
  ci) while [ "$#" -gt 0 ]; do if [ "$1" = --cache ]; then shift; cache="$1"; fi; shift; done; echo content > "$cache/_cacache/package" ;;
esac`);
    const script = `set -e
mkdir -p '${release}'
touch '${project}/.egg-managed'
${npmCacheScript(root, "a".repeat(64), release)}
egg_npm ci
[ "$(find '${root}' -name package | wc -l)" -eq 1 ]
mkdir '${root}/${"b".repeat(64)}' '${root}/unmanaged'
touch '${root}/${"b".repeat(64)}/.egg-cache-entry-managed'
touch '${mock.home}/corrupt'
egg_npm ci
[ "$(find '${root}' -name package | wc -l)" -eq 1 ]
[ ! -e '${root}/${"b".repeat(64)}' ]
[ -d '${root}/unmanaged' ]
store=$(find '${root}' -mindepth 1 -maxdepth 1 -type d ! -name unmanaged)
touch -d '15 days ago' "$store"
egg_npm ci
[ "$(find '${root}' -name package | wc -l)" -eq 1 ]
[ ! -e '${release}/.egg-npm-cache' ]`;
    const result = await session.script(script, { timeoutMs: 30000 });
    expect(result.stderr).toBe("");
    expect(result.code).toBe(0);
  } finally { session.close(); await mock.stop(); }
}, 60000);

it("generates syntactically valid cache shell", () => {
  const bash = process.platform === "win32" ? "C:/Program Files/Git/bin/bash.exe" : "bash";
  const script = npmCacheScript("/home/nest/.egg/demo/cache/npm/preview", "a".repeat(64), "/home/nest/.egg/demo/releases/id");
  const result = spawnSync(bash, ["-n", "-c", script], { encoding: "utf8" });
  expect(result.stderr).toBe("");
  expect(result.status).toBe(0);
});

it("checks the cache disk limit and prunes only managed cache keys", async () => {
  const { cappedBuildScript } = await import("./container-build");
  const script = cappedBuildScript({ home: "/home/nest", slug: "demo", releaseId: "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d", memoryMb: 1024, cpuPercent: 100, steps: [{ label: "Installing", command: "npm ci" }], archiveRoot: ".", hasEnvFile: false, cache: { context: "preview" }, npmLockHash: "a".repeat(64) });
  expect(script).toContain("limit=256MB");
  expect(script).toContain(".egg-cache-managed");
  expect(script).toContain("egg_npm ci");
  const bash = process.platform === "win32" ? "C:/Program Files/Git/bin/bash.exe" : "bash";
  const result = spawnSync(bash, ["-n", "-c", script], { encoding: "utf8" });
  expect(result.stderr).toBe("");
  expect(result.status).toBe(0);
});

it.skipIf(!linuxTestHostAvailable())("falls back to a clean npm install when the cache is over budget", async () => {
  const key = generateServerKey("cache-budget-test");
  const mock = await startMockSsh({ authorizedKeys: [key.publicKey] });
  const session = await NestSession.connect({ host: "127.0.0.1", port: mock.port, username: "test", privateKey: key.privateKey });
  try {
    const project = `${mock.home}/project`, release = `${project}/releases/current`, root = `${project}/cache/npm/preview`;
    mock.addShim("du", "#!/bin/bash\necho -e '257\\tcache'");
    mock.addShim("npm", `#!/bin/bash
if [ "$1" = --version ]; then echo 10.1.0; exit; fi
printf '%s\\n' "$@" > '${mock.home}/npm-args'`);
    const result = await session.script(`set -e
mkdir -p '${release}'
touch '${project}/.egg-managed'
${npmCacheScript(root, "a".repeat(64), release)}
egg_npm ci
! grep -q -- '^--cache$' '${mock.home}/npm-args'
[ ! -e '${release}/.egg-npm-cache' ]`, { timeoutMs: 30000 });
    expect(result.stderr).toBe("");
    expect(result.code).toBe(0);
  } finally { session.close(); await mock.stop(); }
}, 60000);

it.skipIf(!linuxTestHostAvailable())("stops an over-budget cache build and removes only owned keys", async () => {
  const { cappedBuildScript } = await import("./container-build");
  const key = generateServerKey("cache-watch-test");
  const mock = await startMockSsh({ authorizedKeys: [key.publicKey] });
  const session = await NestSession.connect({ host: "127.0.0.1", port: mock.port, username: "test", privateKey: key.privateKey });
  try {
    const root = `${mock.home}/.egg/demo/cache/npm/preview`;
    mock.addShim("df", "#!/bin/bash\nprintf 'header\\na b c 9999\\n'");
    mock.addShim("du", `#!/bin/bash\ncase "$2" in *cache/npm/preview/*) echo '257 x';; *) echo '1 x';; esac`);
    mock.addShim("systemctl", "#!/bin/bash\nexit 0");
    mock.addShim("systemd-run", "#!/bin/bash\nsleep 3\nexit 1");
    const dir = `${mock.home}/.egg/demo/releases/0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d`;
    const setup = await session.script(`mkdir -p '${dir}' '${root}/${"b".repeat(64)}' '${root}/unmanaged'; touch '${mock.home}/.egg/demo/.egg-managed' '${mock.home}/.egg/demo/cache/.egg-cache-managed' '${root}/${"b".repeat(64)}/.egg-cache-entry-managed'`);
    expect(setup.code).toBe(0);
    const build = cappedBuildScript({ home: mock.home, slug: "demo", releaseId: "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d", memoryMb: 1024, cpuPercent: 100, steps: [{ label: "Installing", command: "npm ci" }], archiveRoot: ".", hasEnvFile: false, cache: { context: "preview" }, npmLockHash: "a".repeat(64) });
    const result = await session.script(build, { timeoutMs: 30000 });
    expect(result.code).toBe(44);
    const check = await session.script(`[ ! -e '${root}/${"b".repeat(64)}' ] && [ -d '${root}/unmanaged' ]`);
    expect(check.code).toBe(0);
  } finally { session.close(); await mock.stop(); }
}, 60000);
