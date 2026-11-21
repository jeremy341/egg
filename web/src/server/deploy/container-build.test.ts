import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { BUILD_STEP_FLOOR_MB, DEFAULT_CONTAINER_BUILD_MEMORY_MB } from "@/lib/build-memory";
import { upsertUser } from "@/server/auth/session";
import { schema } from "@/server/db";
import {
  BuildLockError,
  LOCK_STALE_AFTER_MS,
  buildLockForServer,
  releaseBuildLock,
  renewBuildLock,
  takeOverBuildLock,
  tryAcquireBuildLock,
  withBuildLock,
} from "@/server/deploy/build-lock";
import {
  BUILD_DISK_BUDGET_MB,
  BUILD_DISK_FLOOR_MB,
  BUILD_TIMEOUT_SECONDS,
  EXIT_DISK_BUDGET,
  EXIT_DISK_FLOOR,
  EXIT_SCOPE_RUNNING,
  ContainerBuildError,
  buildScopeName,
  buildSteps,
  cappedBuildScript,
  checkContainerReady,
  containerMemoryCapMb,
  cpuQuotaPercent,
  describeBuildFailure,
  discardBuildScript,
  removeLeftoverBuildEnvScript,
  renderBuildEnv,
  runContainerBuild,
  stopAllBuildScopesScript,
  systemdRunArgs,
  unpackSourceScript,
  type ContainerBuildInput,
} from "@/server/deploy/container-build";
import type { PreflightFacts, PreflightNeeds } from "@/server/deploy/container-probe";
import { pruneReleases, unitFile } from "@/server/deploy/remote";
import { createProject, deployBranch } from "@/server/projects";
import { createServer } from "@/server/servers";
import { SshError, shellQuote } from "@/server/ssh/connection";
import { useFreshDb } from "@/server/test/db";

let ctx: Awaited<ReturnType<typeof useFreshDb>>;

beforeAll(async () => {
  ctx = await useFreshDb();
});
afterAll(async () => {
  await ctx.cleanup();
});

/** A server row of its own. Each gets its own user, because one user may connect only five servers. */
async function newServerWithUser(name: string) {
  const user = await upsertUser({ id: `u-${randomUUID()}`, name, email: null, slackId: null });
  return { userId: user.id, serverId: (await createServer(user.id, name)).id };
}
async function newServer(name: string) {
  return (await newServerWithUser(name)).serverId;
}

/** A deployment record on a server, the way a build lock holder has one: its id is the holder, its release id names the folder to clean. */
async function newHolder(name: string, slug: string) {
  const { userId, serverId } = await newServerWithUser(name);
  const project = await createProject(userId, {
    serverId,
    name: slug,
    slug,
    repoUrl: "https://github.com/example/demo",
    runtime: "node",
    startCommand: "node server.js",
    port: 3000,
    healthPath: "/",
  });
  const d = await deployBranch(userId, project.id, project.productionBranch);
  return { serverId, deploymentId: d.id, releaseId: d.releaseId, slug };
}

/** Single quotes inside the quoted inner script of a build are written the way the shell needs them. */
const inInner = (s: string) => s.replace(/'/g, "'\\''");

describe("the memory cap", () => {
  it("starts new servers at 512 MB and gives a build step at least 1024 MB", () => {
    expect(DEFAULT_CONTAINER_BUILD_MEMORY_MB).toBe(512);
    expect(BUILD_STEP_FLOOR_MB).toBe(1024);
  });

  it("is the server's setting when the container has room", () => {
    expect(containerMemoryCapMb(1024, 4096)).toBe(1024);
    expect(containerMemoryCapMb(1024, null)).toBe(1024);
    expect(containerMemoryCapMb(2048, 4096, true)).toBe(2048);
  });

  it("caps an install or a plain app at the setting, 512 MB by default", () => {
    expect(containerMemoryCapMb(512, 4096)).toBe(512);
    expect(containerMemoryCapMb(512, 4096, false)).toBe(512);
    expect(containerMemoryCapMb(512, null)).toBe(512);
  });

  it("gives a build step at least 1024 MB when the container reports 1536 MB or more", () => {
    expect(containerMemoryCapMb(512, 1536, true)).toBe(1024);
    expect(containerMemoryCapMb(512, 2048, true)).toBe(1024);
    expect(containerMemoryCapMb(768, 8192, true)).toBe(1024);
  });

  it("keeps the setting for a build step when the container has no room for the floor", () => {
    expect(containerMemoryCapMb(512, 1024, true)).toBe(512);
    expect(containerMemoryCapMb(512, 1535, true)).toBe(512);
    expect(containerMemoryCapMb(512, 1400, true)).toBe(512);
    // No reported memory: nothing proves there is room, so the setting stands.
    expect(containerMemoryCapMb(512, null, true)).toBe(512);
    expect(containerMemoryCapMb(512, undefined, true)).toBe(512);
  });

  it("is never more than the container's memory minus 512 MB", () => {
    expect(containerMemoryCapMb(2048, 2048)).toBe(1536);
    expect(containerMemoryCapMb(1024, 1200)).toBe(688);
    expect(containerMemoryCapMb(8192, 2000)).toBe(1488);
    for (const total of [768, 1000, 1024, 1535, 1536, 2048, 3000, 16384]) {
      for (const setting of [512, 1024, 4096, 20000]) {
        for (const hasBuildStep of [false, true]) {
          const cap = total - 512 >= 256 ? containerMemoryCapMb(setting, total, hasBuildStep) : null;
          if (cap !== null) expect(cap, `${setting} on ${total} (build step ${hasBuildStep})`).toBeLessThanOrEqual(total - 512);
        }
      }
    }
  });

  it("refuses when the container is too small to leave a useful cap", () => {
    expect(() => containerMemoryCapMb(1024, 767)).toThrow(ContainerBuildError);
    expect(() => containerMemoryCapMb(1024, 700)).toThrow(/too little to build in/);
    expect(() => containerMemoryCapMb(512, 700, true)).toThrow(/too little to build in/);
    expect(containerMemoryCapMb(1024, 768)).toBe(256);
    expect(containerMemoryCapMb(512, 768, true)).toBe(256);
  });

  it("turns cores into a CPU quota", () => {
    expect(cpuQuotaPercent(2)).toBe(200);
    expect(cpuQuotaPercent(0.5)).toBe(50);
    expect(cpuQuotaPercent(0.25)).toBe(25);
  });
});

describe("the systemd-run command", () => {
  const releaseId = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";

  it("builds exactly these arguments", () => {
    expect(systemdRunArgs({ scope: buildScopeName(releaseId), memoryMb: 1024, cpuPercent: 200 })).toEqual([
      "systemd-run",
      "--scope",
      "--quiet",
      "--collect",
      "--unit=egg-build-0a1b2c3d",
      "--property=MemoryMax=1024M",
      "--property=MemorySwapMax=0",
      "--property=CPUQuota=200%",
      "--property=CPUWeight=20",
      "--property=TasksMax=4096",
      "--",
    ]);
  });

  it("refuses a bad scope name, memory or CPU value", () => {
    expect(() => systemdRunArgs({ scope: "x; rm -rf /", memoryMb: 1024, cpuPercent: 100 })).toThrow(ContainerBuildError);
    expect(() => systemdRunArgs({ scope: "egg-build-0a1b2c3d", memoryMb: 100, cpuPercent: 100 })).toThrow(/memory cap/);
    expect(() => systemdRunArgs({ scope: "egg-build-0a1b2c3d", memoryMb: 1024.5, cpuPercent: 100 })).toThrow();
    expect(() => systemdRunArgs({ scope: "egg-build-0a1b2c3d", memoryMb: 1024, cpuPercent: 0 })).toThrow(/CPU cap/);
    expect(() => buildScopeName("../../etc")).toThrow(/release id/);
  });

  it("puts the capped scope, the lower priority and the timeout around the build, and never runs it bare", () => {
    const script = cappedBuildScript({
      home: "/root",
      slug: "demo",
      releaseId,
      memoryMb: 1024,
      cpuPercent: 200,
      steps: buildSteps({ buildInstall: "npm ci", buildCommand: "npm run build", remoteInstall: "npm ci --omit=dev" }),
      archiveRoot: ".",
      hasEnvFile: true,
    });
    expect(script).toContain(
      `'systemd-run' '--scope' '--quiet' '--collect' '--unit=egg-build-0a1b2c3d' '--property=MemoryMax=1024M' '--property=MemorySwapMax=0' '--property=CPUQuota=200%' '--property=CPUWeight=20' '--property=TasksMax=4096' '--' nice -n 10 timeout -s TERM ${BUILD_TIMEOUT_SECONDS} bash -lc "$inner"`
    );
    // The build is raised in the kernel's out-of-memory ranking, in the release folder, with the variables file.
    expect(script).toContain("echo 500 > /proc/self/oom_score_adj");
    expect(script).toContain(inInner(`cd '/root/.egg/demo/releases/${releaseId}'`));
    expect(script).toContain(inInner(`. '/root/.egg/demo/incoming/${releaseId}.buildenv'`));
    // Order: install, build, production install.
    const at = (s: string) => script.indexOf(s);
    expect(at("Installing: npm ci")).toBeLessThan(at("Building: npm run build"));
    expect(at("Building: npm run build")).toBeLessThan(at("Installing production dependencies: npm ci --omit=dev"));
    // The scope is stopped and the variables file removed whatever happened.
    expect(script).toContain("systemctl stop 'egg-build-0a1b2c3d.scope'");
    expect(script).toContain('rm -f "$envfile"');
    // The variables file is removed as soon as the build shell has loaded it, and on its exit; the script also removes it on exit.
    const loaded = script.indexOf(inInner(". '/root/.egg/demo/incoming/" + releaseId + ".buildenv'"));
    const removed = script.indexOf(inInner("rm -f -- '/root/.egg/demo/incoming/" + releaseId + ".buildenv'"));
    expect(loaded).toBeGreaterThan(-1);
    expect(removed).toBeGreaterThan(loaded);
    expect(removed).toBeLessThan(script.indexOf("export CI=true"));
    const envPath = `/root/.egg/demo/incoming/${releaseId}.buildenv`;
    expect(script).toContain(inInner(`trap ${shellQuote(`rm -f -- ${shellQuote(envPath)}`)} EXIT`));
    expect(script).toContain(`trap 'kill "$egg_wd_pid" 2>/dev/null; rm -f "$envfile"' EXIT`);
    expect(script).toContain('exit "$code"');
    // The only place the commands appear is inside the quoted inner script, which only runs under systemd-run.
    expect(script.indexOf("npm run build")).toBeGreaterThan(script.indexOf("inner="));
    expect(script.split("npm run build").length - 1).toBe(2); // echo line and the command, both in `inner`
  });

  it("watches the disk beside the build: exact commands, both limits, the marker, the stop and the cleanup", () => {
    const script = cappedBuildScript({
      home: "/root",
      slug: "demo",
      releaseId,
      memoryMb: 1024,
      cpuPercent: 200,
      steps: buildSteps({ buildInstall: "npm ci", buildCommand: "npm run build", remoteInstall: null }),
      archiveRoot: ".",
      hasEnvFile: false,
    });
    // Free space every 2 seconds with df, the folder size every fifth tick (10 seconds) with du.
    expect(script).toContain(`df -Pm "$egg_wd_area"`);
    expect(script).toContain(`du -sm "$dir"`);
    expect(script).toContain("sleep 2 &");
    expect(script).toContain("$((tick % 5))");
    expect(script).toContain(`egg_wd_area="\${dir%/*}"`); // the release area is the folder holding the releases
    // The two limits, and the exit codes they map to.
    expect(script).toContain(`if [ "$free" -lt 1024 ]; then egg_wd_trip floor "free=\${free}MB limit=1024MB"; exit 43; fi`);
    expect(script).toContain(`if [ "$used" -gt 2048 ]; then egg_wd_trip budget "used=\${used}MB limit=2048MB"; exit 44; fi`);
    // The marker is in the release folder, private, and says which limit and the numbers.
    expect(script).toContain(`egg_wd_marker="$dir/.egg-disk-stop"`);
    expect(script).toContain(`( umask 077; printf '%s\\n' "$1 $2" > "$egg_wd_marker" )`);
    expect(script).toContain(`chmod 600 "$egg_wd_marker"`);
    // It stops only the build scope: systemctl stop on it, then TERM to the processes of its own cgroup.
    expect(script).toContain("systemctl stop 'egg-build-0a1b2c3d.scope' >/dev/null 2>&1; then return 0");
    expect(script).toContain("systemctl show -p ControlGroup --value 'egg-build-0a1b2c3d.scope'");
    expect(script).toContain(`kill -TERM "$p"`);
    expect(script).toContain("/cgroup.procs");
    // It never names the app's unit or folder, and never signals a process group.
    expect(script).not.toMatch(/kill -\w+ -|kill -- -|pkill|killall|current/);
    // A df or du that is missing or unreadable is a warning, not a stop.
    expect(script).toContain("command -v df");
    expect(script).toContain("command -v du");
    expect(script).toContain("could not read the free disk space with df");
    expect(script).toContain("could not read the size of the build folder with du");
    // Started before the build, ended right after it, and ended on exit too.
    const at = (s: string) => script.indexOf(s);
    expect(at("egg_wd_loop </dev/null &")).toBeGreaterThan(-1);
    expect(at("egg_wd_loop </dev/null &")).toBeLessThan(at("'systemd-run'"));
    expect(at(`trap 'kill "$egg_wd_pid" 2>/dev/null' EXIT`)).toBeLessThan(at("'systemd-run'"));
    expect(at("code=$?")).toBeLessThan(at(`kill "$egg_wd_pid" 2>/dev/null
wait`));
    expect(at(`kill "$egg_wd_pid" 2>/dev/null\nwait`)).toBeLessThan(script.lastIndexOf("rm -f \"$envfile\""));
    // The marker, or the watchdog's own exit status, turns the exit code into the disk floor or build budget code.
    expect(script).toContain("floor) code=43;;");
    expect(script).toContain("budget) code=44;;");
    expect(script).toContain("43) disk=floor; code=43;;");
    // The out-of-memory guess is skipped for a disk stop.
    expect(script).toContain(`if [ -z "$disk" ] && [ "$code" -ne 0 ]`);
  });

  it("moves a static site's output folder up to be the release, only inside the release", () => {
    const script = cappedBuildScript({
      home: "/root",
      slug: "site",
      releaseId,
      memoryMb: 512,
      cpuPercent: 100,
      steps: buildSteps({ buildInstall: "npm ci", buildCommand: "npm run build", remoteInstall: null }),
      archiveRoot: "dist",
      hasEnvFile: false,
    });
    expect(script).toContain(`out="$dir"/'dist'`);
    expect(script).toContain("code=41");
    expect(script).not.toContain(inInner(". '/root/.egg/site/incoming/"));
    expect(() =>
      cappedBuildScript({ home: "/root", slug: "site", releaseId, memoryMb: 512, cpuPercent: 100, steps: [], archiveRoot: "../etc", hasEnvFile: false })
    ).toThrow(/inside the project/);
    expect(() =>
      cappedBuildScript({ home: "/root", slug: "site", releaseId, memoryMb: 512, cpuPercent: 100, steps: [], archiveRoot: "/etc", hasEnvFile: false })
    ).toThrow(/inside the project/);
  });

  it("exports the build variables safely quoted", () => {
    expect(renderBuildEnv({ A: "x", B: "it's", C: "", D: "a\nb" })).toBe("export A='x'\nexport B='it'\\''s'\nexport D='a\nb'\n");
    expect(() => renderBuildEnv({ "bad name": "x" })).toThrow(ContainerBuildError);
  });

  it("discards only inside a project folder Egg made, and never the live release", () => {
    const s = discardBuildScript({ home: "/root", slug: "demo", releaseId });
    expect(s).toContain("egg_dir_managed '/root/.egg/demo'");
    expect(s).toContain(`readlink '/root/.egg/demo/current'`);
    expect(s).toContain(`rm -rf '/root/.egg/demo/releases/${releaseId}' '/root/.egg/demo/releases/${releaseId}.out'`);
    expect(s).toContain("systemctl stop 'egg-build-0a1b2c3d.scope'");
    // It confirms the stop: when the scope is still running afterwards, it exits ${EXIT_SCOPE_RUNNING} instead of 0.
    expect(s).toContain("systemctl is-active 'egg-build-0a1b2c3d.scope'");
    expect(s).toContain(`exit ${EXIT_SCOPE_RUNNING};;`);
    expect(EXIT_SCOPE_RUNNING).toBe(46);
    expect(() => discardBuildScript({ home: "/root", slug: "demo", releaseId: "../x" })).toThrow(/release id/);
    expect(() => unpackSourceScript({ home: "/root", slug: "demo", releaseId: "../x", sha256: "a" })).toThrow(/release id/);
  });
});

describe("leftover build variables files", () => {
  const keep = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";

  it("the start-of-build sweep works only inside a project folder Egg made, on release-id names, and spares this build's own", () => {
    const s = removeLeftoverBuildEnvScript({ home: "/root", slug: "demo", keepReleaseId: keep });
    expect(s).toContain("egg_dir_managed '/root/.egg/demo'");
    expect(s).toContain("'/root/.egg/demo/incoming'/*.buildenv");
    expect(s).toContain(`[ "$id" = '${keep}' ] && continue`);
    expect(s).toContain("=~ ^[0-9a-f]{8}-");
    expect(s).not.toMatch(/rm -rf|systemctl|readlink/);
    expect(() => removeLeftoverBuildEnvScript({ home: "/root", slug: "demo", keepReleaseId: "../x" })).toThrow(/release id/);
  });

  it("pruning removes every variables file except those of builds named as running", () => {
    const s = pruneReleases("/root", "demo", [keep], ["11111111-1111-4111-8111-111111111111", "bad id"]);
    expect(s).toContain("'/root/.egg/demo/incoming'/*.buildenv");
    expect(s).toContain('building=" 11111111-1111-4111-8111-111111111111 "');
    expect(s).toContain('[[ "$building" != *" $id "* ]]');
    expect(s).toContain('rm -f -- "$f"');
    // They go before the folder loop, which can exit early when there is no releases folder.
    expect(s.indexOf("*.buildenv")).toBeLessThan(s.indexOf("|| exit 0"));
    expect(s).toContain("*.tar.gz"); // archives still go, as before
  });

  it("the scope sweep for a stale lock names only egg-build scopes, and fails when the scopes cannot be listed or one stays up", () => {
    const s = stopAllBuildScopesScript();
    expect(s).toContain("systemctl list-units --type=scope");
    expect(s).toContain("'egg-build-*.scope'");
    expect(s).toContain(String.raw`grep -E '^egg-build-[0-9a-f]{8}\.scope$'`);
    expect(s).toContain(`exit ${EXIT_SCOPE_RUNNING}`);
    expect(s).not.toMatch(/pkill|killall|kill -/);
  });
});

describe("the app's service file", () => {
  it("lowers the app's out-of-memory score so a build is killed before the app", () => {
    const u = unitFile({
      slug: "demo",
      description: "Egg: demo",
      workDir: "/root/.egg/demo/current",
      envFile: "/root/.egg/demo/current.env",
      port: 3000,
      startCommand: "npm start",
    });
    expect(u).toContain("OOMScoreAdjust=-500\n");
    expect(u.indexOf("OOMScoreAdjust=-500")).toBeGreaterThan(u.indexOf("[Service]"));
    expect(u.indexOf("OOMScoreAdjust=-500")).toBeLessThan(u.indexOf("[Install]"));
  });
});

describe("failure messages", () => {
  const base = { memoryCapMb: 1024, appRunning: true };

  it("says exactly what happened when a build runs out of memory", () => {
    expect(describeBuildFailure(137, base)).toBe(
      "The build needed more memory than the cap of 1024 MB. Your app is still running."
    );
  });

  it("explains a timeout, a missing output folder, a corrupt upload and any other failure", () => {
    expect(describeBuildFailure(124, base)).toBe("The build took longer than 15 minutes and was stopped. Your app is still running.");
    expect(describeBuildFailure(41, { ...base, archiveRoot: "dist" })).toBe(
      'The output folder "dist" was not created by the build. Your app is still running.'
    );
    expect(describeBuildFailure(20, base)).toMatch(/corrupted/);
    expect(describeBuildFailure(2, base)).toBe("The build failed (exit 2). Your app is still running.");
  });

  it("says which disk limit stopped the build, with the number, and that the app is untouched", () => {
    expect(BUILD_DISK_FLOOR_MB).toBe(1024);
    expect(BUILD_DISK_BUDGET_MB).toBe(2048);
    expect(describeBuildFailure(EXIT_DISK_FLOOR, base)).toBe(
      "The build stopped because the container's free disk space fell below 1024 MB. Your app is still running. Free up disk space on your container, then deploy again."
    );
    expect(describeBuildFailure(EXIT_DISK_BUDGET, base)).toBe(
      "The build used more than 2048 MB of disk space and was stopped. Your app is still running."
    );
    // The two codes are not the ones used for anything else.
    expect([EXIT_DISK_FLOOR, EXIT_DISK_BUDGET]).toEqual([43, 44]);
  });

  it("does not claim an app is running when none is", () => {
    expect(describeBuildFailure(EXIT_DISK_FLOOR, { memoryCapMb: 640, appRunning: false })).toBe(
      "The build stopped because the container's free disk space fell below 1024 MB. Free up disk space on your container, then deploy again."
    );
    expect(describeBuildFailure(EXIT_DISK_BUDGET, { memoryCapMb: 640, appRunning: false })).toBe(
      "The build used more than 2048 MB of disk space and was stopped."
    );
    expect(describeBuildFailure(137, { memoryCapMb: 640, appRunning: false })).toBe(
      "The build needed more memory than the cap of 640 MB."
    );
    expect(describeBuildFailure(2, { memoryCapMb: 640, appRunning: false })).toBe("The build failed (exit 2).");
  });
});

// ------------------------------------------------------------------ the lock

describe("the per-server build lock", () => {
  it("is held by one build at a time and free again once released", async () => {
    const id = await newServer("sam-lock-1");
    expect(await tryAcquireBuildLock(id, "dep-a")).toBe(true);
    expect(await tryAcquireBuildLock(id, "dep-b")).toBe(false);
    expect(await tryAcquireBuildLock(id, "dep-a")).toBe(true); // the holder may ask again
    await releaseBuildLock(id, "dep-b"); // not the holder: nothing happens
    expect(await tryAcquireBuildLock(id, "dep-b")).toBe(false);
    await releaseBuildLock(id, "dep-a");
    expect(await tryAcquireBuildLock(id, "dep-b")).toBe(true);
    await releaseBuildLock(id, "dep-b");
  });

  it("does not stop builds on different servers", async () => {
    const a = await newServer("sam-lock-a");
    const b = await newServer("sam-lock-b");
    expect(await tryAcquireBuildLock(a, "dep-a")).toBe(true);
    expect(await tryAcquireBuildLock(b, "dep-b")).toBe(true);
    await releaseBuildLock(a, "dep-a");
    await releaseBuildLock(b, "dep-b");
  });

  it("never takes an expired lock by plain acquiring; only a verified takeover does, and only for the holder and time that were seen", async () => {
    // (Before the takeover existed, an expired lock was never taken at all. Plain acquiring still does not take it.)
    const id = await newServer("sam-lock-stale");
    const t0 = new Date(Date.now() - 10 * LOCK_STALE_AFTER_MS);
    expect(await tryAcquireBuildLock(id, "dead", t0)).toBe(true);
    expect(await tryAcquireBuildLock(id, "next", new Date(t0.getTime() + LOCK_STALE_AFTER_MS - 1000))).toBe(false);
    expect(await renewBuildLock(id, "dead", new Date(t0.getTime() + LOCK_STALE_AFTER_MS - 1000))).toBe(true);
    expect(await tryAcquireBuildLock(id, "next", new Date(t0.getTime() + LOCK_STALE_AFTER_MS + 1000))).toBe(false);
    expect(await tryAcquireBuildLock(id, "next", new Date(t0.getTime() + 2 * LOCK_STALE_AFTER_MS))).toBe(false);

    const seen = await buildLockForServer(id);
    // The takeover is a compare-and-swap: a different holder or a renewed timestamp changes nothing.
    expect(await takeOverBuildLock(id, { holder: "someone-else", at: seen!.at }, "next")).toBe(false);
    expect(await takeOverBuildLock(id, { holder: "dead", at: new Date(seen!.at!.getTime() - 1) }, "next")).toBe(false);
    expect(await takeOverBuildLock(id, { holder: "dead", at: null }, "next")).toBe(false);
    expect((await buildLockForServer(id))?.holder).toBe("dead");
    // The holder renews after the stale lock was seen: the takeover of what was seen is refused.
    expect(await renewBuildLock(id, "dead", new Date(seen!.at!.getTime() + 5000))).toBe(true);
    expect(await takeOverBuildLock(id, { holder: "dead", at: seen!.at }, "next")).toBe(false);
    const again = await buildLockForServer(id);
    expect(await takeOverBuildLock(id, { holder: "dead", at: again!.at }, "next")).toBe(true);
    expect((await buildLockForServer(id))?.holder).toBe("next");
    // The old holder cannot renew any more, and releasing does not free the new holder's lock.
    expect(await renewBuildLock(id, "dead")).toBe(false);
    await releaseBuildLock(id, "dead");
    expect((await buildLockForServer(id))?.holder).toBe("next");
    await releaseBuildLock(id, "next");
    expect(await tryAcquireBuildLock(id, "third")).toBe(true);
    await releaseBuildLock(id, "third");
  });

  it("fails closed promptly on a stale lock when nothing is there to verify it", async () => {
    const id = await newServer("sam-lock-stale-fast");
    const t0 = new Date(Date.now() - LOCK_STALE_AFTER_MS - 1);
    await tryAcquireBuildLock(id, "possibly-live-worker", t0);
    await expect(withBuildLock(
      id,
      "new-worker",
      { pollMs: 5, maxWaitMs: 30 * 60_000 },
      async () => "should not run"
    )).rejects.toThrow(/expired without confirming that its remote process stopped, and nothing here could check/);
    const row = await ctx.db.select().from(schema.servers).where(eq(schema.servers.id, id)).get();
    expect(row?.buildLockHolder).toBe("possibly-live-worker");
  });

  it("takes a stale lock over only after the verification passes, and tells the build it had to wait", async () => {
    const id = await newServer("sam-lock-takeover");
    const t0 = new Date(Date.now() - LOCK_STALE_AFTER_MS - 1000);
    await tryAcquireBuildLock(id, "dead", t0);
    const events: string[] = [];
    const result = await withBuildLock(
      id,
      "next",
      {
        pollMs: 5,
        verifyStale: async (stale) => {
          events.push(`verify ${stale.holder} at ${stale.at?.getTime() === t0.getTime()}`);
          // While the check runs, the stale holder still holds the lock.
          expect((await buildLockForServer(id))?.holder).toBe("dead");
        },
      },
      async (waited) => {
        events.push(`run waited=${waited}`);
        expect((await buildLockForServer(id))?.holder).toBe("next");
        return "built";
      }
    );
    expect(result).toBe("built");
    expect(events).toEqual(["verify dead at true", "run waited=true"]);
    expect((await buildLockForServer(id))?.holder).toBeNull();
  });

  it("refuses a stale lock, and leaves it exactly as it was, when the verification fails", async () => {
    const id = await newServer("sam-lock-verify-fails");
    const t0 = new Date(Date.now() - LOCK_STALE_AFTER_MS - 1000);
    await tryAcquireBuildLock(id, "dead", t0);
    let ran = false;
    await expect(
      withBuildLock(
        id,
        "next",
        { pollMs: 5, verifyStale: async () => { throw new BuildLockError("could not confirm"); } },
        async () => { ran = true; }
      )
    ).rejects.toThrow("could not confirm");
    expect(ran).toBe(false);
    const row = await buildLockForServer(id);
    expect(row?.holder).toBe("dead");
    expect(row?.at?.getTime()).toBe(t0.getTime());
  });

  it("does not verify, and keeps waiting, while the lock is fresh", async () => {
    const id = await newServer("sam-lock-fresh");
    await tryAcquireBuildLock(id, "busy");
    let verifies = 0;
    await expect(
      withBuildLock(
        id,
        "next",
        { pollMs: 5, maxWaitMs: 60, verifyStale: async () => { verifies++; } },
        async () => "ran"
      )
    ).rejects.toThrow(/more than 30 minutes/);
    expect(verifies).toBe(0);
    await releaseBuildLock(id, "busy");
  });

  it("of two builds that find the same stale lock, only one takes it; the other waits for it and runs after", async () => {
    const id = await newServer("sam-lock-two-waiters");
    await tryAcquireBuildLock(id, "dead", new Date(Date.now() - LOCK_STALE_AFTER_MS - 1000));
    let arrived = 0;
    let verifies = 0;
    let open!: () => void;
    const both = new Promise<void>((r) => (open = r));
    // Both verifications finish before either build tries to take the lock.
    const verifyStale = async () => {
      verifies++;
      if (++arrived === 2) open();
      await both;
    };
    const events: string[] = [];
    const run = (who: string) =>
      withBuildLock(id, who, { pollMs: 5, verifyStale }, async (waited) => {
        events.push(`${who} start waited=${waited}`);
        await new Promise((r) => setTimeout(r, 60));
        events.push(`${who} end`);
      });
    await Promise.all([run("w1"), run("w2")]);
    expect(verifies).toBe(2);
    expect(events).toHaveLength(4);
    // One whole build, then the other: never together.
    expect(events[0].split(" ")[0]).toBe(events[1].split(" ")[0]);
    expect(events[1]).toMatch(/end$/);
    expect(events[2].split(" ")[0]).toBe(events[3].split(" ")[0]);
    expect(events[0].split(" ")[0]).not.toBe(events[2].split(" ")[0]);
    expect((await buildLockForServer(id))?.holder).toBeNull();
  });

  it("a holder that lost its lock is told to stop, and its release does not free the new holder's lock", async () => {
    const id = await newServer("sam-lock-lost");
    let sawLost = false;
    const first = withBuildLock(id, "first", { renewMs: 100, pollMs: 5 }, async (_waited, lock) => {
      await new Promise<void>((resolve) => lock.lost.addEventListener("abort", () => { sawLost = true; resolve(); }, { once: true }));
      return "stopped";
    });
    await new Promise((r) => setTimeout(r, 30));
    // Someone verified the first build stale and took the lock (retry: the first may renew between the read and the swap).
    let taken = false;
    for (let i = 0; i < 50 && !taken; i++) {
      const row = await buildLockForServer(id);
      taken = await takeOverBuildLock(id, { holder: "first", at: row!.at }, "second");
    }
    expect(taken).toBe(true);
    expect(await first).toBe("stopped");
    expect(sawLost).toBe(true);
    expect((await buildLockForServer(id))?.holder).toBe("second");
    await releaseBuildLock(id, "second");
  });

  it("a holder whose renewals keep failing for the stale time stops before anyone else may take the lock", async () => {
    const id = await newServer("sam-lock-renew-fails");
    // The database cannot be reached for renewals: the holder cannot know, so it stops itself in time.
    const real = await import("@/server/db");
    const getDb = real.getDb;
    let lostAt = 0;
    const t0 = Date.now();
    const holding = withBuildLock(id, "flaky", { renewMs: 10, staleAfterMs: 80 }, async (_w, lock) => {
      const db = await getDb();
      const original = db.update;
      db.update = (() => { throw new Error("database unavailable"); }) as typeof db.update;
      try {
        await new Promise<void>((resolve) => lock.lost.addEventListener("abort", () => { lostAt = Date.now() - t0; resolve(); }, { once: true }));
      } finally {
        db.update = original;
      }
    });
    await holding;
    expect(lostAt).toBeGreaterThanOrEqual(80);
    await releaseBuildLock(id, "flaky");
  });

  it("keeps the lock, to go stale, when the build says its remote stop is unconfirmed and then fails", async () => {
    const id = await newServer("sam-lock-keep");
    await expect(
      withBuildLock(id, "a", { renewMs: 5 }, async (_w, lock) => {
        lock.keep();
        throw new Error("connection lost");
      })
    ).rejects.toThrow("connection lost");
    const kept = await buildLockForServer(id);
    expect(kept?.holder).toBe("a");
    // Nobody renews it any more.
    await new Promise((r) => setTimeout(r, 40));
    expect((await buildLockForServer(id))?.at?.getTime()).toBe(kept!.at!.getTime());
    // It goes stale, and the next build verifies the holder before it takes the lock over.
    const verified: string[] = [];
    await withBuildLock(id, "b", { pollMs: 5, staleAfterMs: 30, verifyStale: async (s) => { verified.push(s.holder); } }, async () => "ok");
    expect(verified).toEqual(["a"]);
    expect((await buildLockForServer(id))?.holder).toBeNull();
    // Asking to keep the lock changes nothing when the build did not fail.
    await withBuildLock(id, "c", {}, async (_w, lock) => { lock.keep(); });
    expect((await buildLockForServer(id))?.holder).toBeNull();
  });

  it("a cancel while the stale holder is being verified stops the wait without taking the lock", async () => {
    const id = await newServer("sam-lock-cancel-verify");
    const t0 = new Date(Date.now() - LOCK_STALE_AFTER_MS - 1000);
    await tryAcquireBuildLock(id, "dead", t0);
    const abort = new AbortController();
    await expect(
      withBuildLock(id, "next", { signal: abort.signal, verifyStale: async () => { abort.abort(); } }, async () => "ran")
    ).rejects.toThrow("The deployment was canceled.");
    const row = await buildLockForServer(id);
    expect(row?.holder).toBe("dead");
    expect(row?.at?.getTime()).toBe(t0.getTime());
  });


  it("keeps the second build waiting until the first is done, then runs it", async () => {
    const id = await newServer("sam-lock-wait");
    const order: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let waitedMessages = 0;

    const first = withBuildLock(id, "first", { pollMs: 10 }, async () => {
      order.push("first start");
      await gate;
      order.push("first end");
    });
    await new Promise((r) => setTimeout(r, 30));
    const second = withBuildLock(id, "second", { pollMs: 10, onWait: () => waitedMessages++ }, async (waited) => {
      order.push(`second start (waited ${waited})`);
    });
    await new Promise((r) => setTimeout(r, 80));
    expect(order).toEqual(["first start"]);
    release();
    await Promise.all([first, second]);
    expect(order).toEqual(["first start", "first end", "second start (waited true)"]);
    expect(waitedMessages).toBe(1);
    const row = await ctx.db.select().from(schema.servers).where(eq(schema.servers.id, id)).get();
    expect(row?.buildLockHolder).toBeNull();
  });

  it("releases the lock when the build throws", async () => {
    const id = await newServer("sam-lock-throw");
    await expect(withBuildLock(id, "a", {}, async () => { throw new Error("boom"); })).rejects.toThrow("boom");
    expect(await tryAcquireBuildLock(id, "b")).toBe(true);
    await releaseBuildLock(id, "b");
  });

  it("stops waiting when the deployment is canceled, and gives up after the longest wait", async () => {
    const id = await newServer("sam-lock-cancel");
    await tryAcquireBuildLock(id, "holder");
    const abort = new AbortController();
    const waiting = withBuildLock(id, "waiter", { pollMs: 10, signal: abort.signal }, async () => "ran");
    setTimeout(() => abort.abort(), 40);
    await expect(waiting).rejects.toThrow("The deployment was canceled.");
    await expect(withBuildLock(id, "late", { pollMs: 5, maxWaitMs: 30 }, async () => "ran")).rejects.toThrow(/more than 30 minutes/);
    const row = await ctx.db.select().from(schema.servers).where(eq(schema.servers.id, id)).get();
    expect(row?.buildLockHolder).toBe("holder"); // the waiters never took it, and never released it
    await releaseBuildLock(id, "holder");
  });
});

// ------------------------------------------------------------------ the release folder lifecycle

type Kind = "unpack" | "build" | "discard" | "stop" | "sweep" | "verify";
type Reply = { code: number; stdout?: string; stderr?: string };
type Handler = (kind: Kind, body: string, opts: { signal?: AbortSignal; onLine?: (l: string, s: "stdout" | "stderr") => void }) => Reply | Promise<Reply>;

function fakeSession(handler: Handler) {
  const calls: { kind: Kind; body: string }[] = [];
  const uploads: string[] = [];
  const writes: { path: string; content: string; mode?: string }[] = [];
  const kindOf = (body: string): Kind =>
    body.includes("inner=")
      ? "build"
      : body.includes("tar -xf -")
        ? "unpack"
        : body.includes("list-units")
          ? "verify"
          : body.includes("egg_dir_managed")
            ? body.includes("rm -rf")
              ? "discard"
              : "sweep"
            : "stop";
  return {
    calls,
    uploads,
    writes,
    count: (k: Kind) => calls.filter((c) => c.kind === k).length,
    session: {
      async script(body: string, opts: Parameters<Handler>[2] = {}) {
        const kind = kindOf(body);
        calls.push({ kind, body });
        const r = await handler(kind, body, opts);
        for (const l of (r.stdout ?? "").split("\n").filter(Boolean)) opts.onLine?.(l, "stdout");
        return { code: r.code, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
      },
      async uploadFile(local: string, remote: string) {
        uploads.push(`${local} -> ${remote}`);
      },
      async writeFile(path: string, content: string, mode?: string) {
        writes.push({ path, content, mode });
      },
      async exec() {
        return { code: 0, stdout: "", stderr: "" };
      },
    },
  };
}

function logs() {
  const lines: string[] = [];
  return {
    lines,
    info: (m: string) => lines.push(`info: ${m}`),
    warn: (m: string) => lines.push(`warn: ${m}`),
    error: (m: string) => lines.push(`error: ${m}`),
  };
}

const goodFacts: PreflightFacts = {
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
  diskFreeMb: 9000,
  memTotalMb: 2048,
};
const needs: PreflightNeeds = { node: true, nodeEngine: null, packageManager: "npm", python: false, buildWork: true };
const spec = { buildInstall: "npm ci", buildCommand: "npm run build", remoteInstall: "npm ci --omit=dev", archiveRoot: ".", excludeNodeModules: true };

async function input(over: Partial<ContainerBuildInput> & { fake: ReturnType<typeof fakeSession> }): Promise<ContainerBuildInput> {
  const { fake, ...rest } = over;
  return {
    session: fake.session,
    log: logs(),
    serverId: await newServer(`sam-${randomUUID().slice(0, 8)}`),
    deploymentId: randomUUID(),
    home: "/root",
    slug: "demo",
    releaseId: randomUUID(),
    built: { archivePath: "/tmp/source.tar.gz", sha256: "abc", sizeBytes: 2_000_000, spec },
    env: { GREETING: "hello" },
    memoryMb: 1024,
    cpuCores: 2,
    containerMemoryMb: 2048,
    appRunning: true,
    needs,
    preflight: async () => goodFacts,
    lockPollMs: 10,
    ...rest,
  };
}

async function lockHolder(serverId: string) {
  return (await ctx.db.select().from(schema.servers).where(eq(schema.servers.id, serverId)).get())?.buildLockHolder;
}

describe("a container build's release folder", () => {
  it("success: uploads, unpacks, builds under the cap, keeps the folder, and frees the lock", async () => {
    const fake = fakeSession(() => ({ code: 0, stdout: "built it" }));
    let checked = 0;
    const a = await input({ fake, preflight: async () => (checked++, goodFacts) });
    const res = await runContainerBuild(a);
    expect(checked).toBe(0); // nothing was waited for, so the container is not looked at again
    expect(res.memoryCapMb).toBe(1024);
    expect(fake.calls.map((c) => c.kind)).toEqual(["sweep", "unpack", "build"]);
    expect(fake.uploads).toEqual([`/tmp/source.tar.gz -> /root/.egg/demo/incoming/${a.releaseId}.tar.gz`]);
    expect(fake.writes).toHaveLength(1);
    expect(fake.writes[0]).toMatchObject({ path: `/root/.egg/demo/incoming/${a.releaseId}.buildenv`, mode: "600" });
    expect(fake.writes[0].content).toBe("export GREETING='hello'\n");
    expect(fake.count("discard")).toBe(0);
    expect((a.log as ReturnType<typeof logs>).lines.join("\n")).toMatch(/capped at 1024 MB of memory and 200%/);
    expect(await lockHolder(a.serverId)).toBeNull();
    // The build ran in the release folder named for the deployment's release.
    expect(fake.calls[2].body).toContain(inInner(`cd '/root/.egg/demo/releases/${a.releaseId}'`));
  });

  it("a project with a build step is capped at 1024 MB on a server set to 512, with room", async () => {
    const fake = fakeSession(() => ({ code: 0 }));
    const a = await input({ fake, memoryMb: 512, containerMemoryMb: 2048 });
    const res = await runContainerBuild(a);
    expect(res.memoryCapMb).toBe(1024);
    expect(fake.calls[2].body).toContain("MemoryMax=1024M");
  });

  it("an install with no build command stays at the setting, 512 MB", async () => {
    const fake = fakeSession(() => ({ code: 0 }));
    const installOnly = { ...spec, buildCommand: null };
    const a = await input({
      fake,
      memoryMb: 512,
      containerMemoryMb: 4096,
      built: { archivePath: "/tmp/source.tar.gz", sha256: "abc", sizeBytes: 2_000_000, spec: installOnly },
    });
    const res = await runContainerBuild(a);
    expect(res.memoryCapMb).toBe(512);
    expect(fake.calls[2].body).toContain("MemoryMax=512M");
  });

  it("a project with a build step on a 1 GB container keeps the setting", async () => {
    const fake = fakeSession(() => ({ code: 0 }));
    const a = await input({ fake, memoryMb: 512, containerMemoryMb: 1024 });
    const res = await runContainerBuild(a);
    expect(res.memoryCapMb).toBe(512);
  });

  it("build failure: removes its own folder, says what failed, and frees the lock", async () => {
    const fake = fakeSession((kind) => (kind === "build" ? { code: 2 } : { code: 0 }));
    const a = await input({ fake });
    await expect(runContainerBuild(a)).rejects.toThrow("The build failed (exit 2). Your app is still running.");
    expect(fake.calls.map((c) => c.kind)).toEqual(["sweep", "unpack", "build", "discard"]);
    const discard = fake.calls[3].body;
    expect(discard).toContain(`rm -rf '/root/.egg/demo/releases/${a.releaseId}'`);
    // It reads the current link to protect the live release, and never changes it or restarts the app.
    expect(discard).not.toMatch(/ln -s|mv -T|systemctl restart/);
    expect(await lockHolder(a.serverId)).toBeNull();
  });

  it("out of memory: reports the cap, removes the folder", async () => {
    const fake = fakeSession((kind) => (kind === "build" ? { code: 137 } : { code: 0 }));
    const a = await input({ fake, memoryMb: 4096, containerMemoryMb: 2048 });
    await expect(runContainerBuild(a)).rejects.toThrow(
      "The build needed more memory than the cap of 1536 MB. Your app is still running."
    );
    expect(fake.count("discard")).toBe(1);
  });

  it("out of memory on a first deploy does not claim an app is running", async () => {
    const fake = fakeSession((kind) => (kind === "build" ? { code: 137 } : { code: 0 }));
    const a = await input({ fake, appRunning: false });
    await expect(runContainerBuild(a)).rejects.toThrow(/^The build needed more memory than the cap of 1024 MB\.$/);
  });

  it("timeout: the script's own 15 minute limit and the connection's backstop both clean up", async () => {
    const fake = fakeSession((kind) => (kind === "build" ? { code: 124 } : { code: 0 }));
    const a = await input({ fake });
    await expect(runContainerBuild(a)).rejects.toThrow("The build took longer than 15 minutes and was stopped. Your app is still running.");
    expect(fake.count("discard")).toBe(1);

    const stuck = fakeSession((kind) => {
      if (kind === "build") throw new SshError("Command timed out after 1020s", "timeout");
      return { code: 0 };
    });
    const b = await input({ fake: stuck });
    await expect(runContainerBuild(b)).rejects.toThrow(/took longer than 15 minutes/);
    expect(stuck.count("discard")).toBe(1);
    expect(stuck.count("stop")).toBeGreaterThanOrEqual(1); // the scope is stopped, not left running
    expect(await lockHolder(b.serverId)).toBeNull();
  });

  it("cancel: stops the scope at once, removes the folder, and frees the lock", async () => {
    const abort = new AbortController();
    const fake = fakeSession((kind, _body, opts) => {
      if (kind !== "build") return { code: 0 };
      return new Promise<Reply>((_, reject) => {
        setTimeout(() => abort.abort(), 20);
        opts.signal?.addEventListener("abort", () => reject(new SshError("Command canceled", "exec")), { once: true });
      });
    });
    const a = await input({ fake, signal: abort.signal });
    await expect(runContainerBuild(a)).rejects.toThrow("Command canceled");
    expect(fake.count("stop")).toBeGreaterThanOrEqual(1);
    expect(fake.count("discard")).toBe(1);
    expect(await lockHolder(a.serverId)).toBeNull();
  });

  it("disk floor: says so, removes the release folder, archive and variables file, and frees the lock", async () => {
    const fake = fakeSession((kind) => (kind === "build" ? { code: EXIT_DISK_FLOOR } : { code: 0 }));
    const a = await input({ fake });
    await expect(runContainerBuild(a)).rejects.toThrow(
      "The build stopped because the container's free disk space fell below 1024 MB. Your app is still running. Free up disk space on your container, then deploy again."
    );
    expect(fake.calls.map((c) => c.kind)).toEqual(["sweep", "unpack", "build", "discard"]);
    const discard = fake.calls[3].body;
    expect(discard).toContain(`rm -rf '/root/.egg/demo/releases/${a.releaseId}'`);
    expect(discard).toContain(`rm -f '/root/.egg/demo/incoming/${a.releaseId}.buildenv' '/root/.egg/demo/incoming/${a.releaseId}.tar.gz'`);
    expect(await lockHolder(a.serverId)).toBeNull();
  });

  it("build budget: says so, and removes the folder", async () => {
    const fake = fakeSession((kind) => (kind === "build" ? { code: EXIT_DISK_BUDGET } : { code: 0 }));
    const a = await input({ fake });
    await expect(runContainerBuild(a)).rejects.toThrow(
      "The build used more than 2048 MB of disk space and was stopped. Your app is still running."
    );
    expect(fake.count("discard")).toBe(1);
    expect((a.log as ReturnType<typeof logs>).lines.join("\n")).toContain("Watching disk use");
  });

  it("a corrupt upload removes the folder too", async () => {
    const fake = fakeSession((kind) => (kind === "unpack" ? { code: 20 } : { code: 0 }));
    const a = await input({ fake });
    await expect(runContainerBuild(a)).rejects.toThrow(/corrupted/);
    expect(fake.count("build")).toBe(0);
    expect(fake.count("discard")).toBe(1);
  });

  it("refuses a container that is too small before uploading anything", async () => {
    const fake = fakeSession(() => ({ code: 0 }));
    const a = await input({ fake, containerMemoryMb: 700 });
    await expect(runContainerBuild(a)).rejects.toThrow(/too little to build in/);
    expect(fake.uploads).toEqual([]);
    expect(fake.count("build")).toBe(0);
  });

  it("a project with nothing to build is still unpacked under the lock, without a scope", async () => {
    const fake = fakeSession(() => ({ code: 0 }));
    const noBuild = { buildInstall: null, buildCommand: null, remoteInstall: null, archiveRoot: ".", excludeNodeModules: false };
    let heldDuringUnpack: string | null | undefined = "not checked";
    const a = await input({ fake, built: { archivePath: "/tmp/s.tar.gz", sha256: "abc", sizeBytes: 10, spec: noBuild }, needs: { ...needs, buildWork: false } });
    const watching = fakeSession(async (kind) => {
      if (kind === "unpack") heldDuringUnpack = await lockHolder(a.serverId);
      return { code: 0 };
    });
    const res = await runContainerBuild({ ...a, session: watching.session });
    expect(res.memoryCapMb).toBe(0);
    expect(watching.calls.map((c) => c.kind)).toEqual(["unpack"]);
    expect(watching.writes).toEqual([]);
    expect(heldDuringUnpack).toBe(a.deploymentId); // the lock was ours while the source was extracted
    expect(await lockHolder(a.serverId)).toBeNull();
    expect(fake.calls).toEqual([]);
  });

  it("two deploys with nothing to build never unpack together, and the one that waited looks at the disk again", async () => {
    const serverId = await newServer("sam-two-unpacks");
    const noBuild = { buildInstall: null, buildCommand: null, remoteInstall: null, archiveRoot: ".", excludeNodeModules: false };
    const built = { archivePath: "/tmp/s.tar.gz", sha256: "abc", sizeBytes: 10, spec: noBuild };
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const events: string[] = [];
    let running = 0;
    let most = 0;
    const handler = (who: string, hold?: Promise<void>): Handler => async (kind) => {
      if (kind === "unpack") {
        running++;
        most = Math.max(most, running);
        events.push(`${who} unpack start`);
        if (hold) await hold;
        events.push(`${who} unpack end`);
        running--;
      }
      return { code: 0 };
    };
    let looked = 0;
    const first = runContainerBuild(await input({ fake: fakeSession(handler("first", gate)), serverId, built, needs: { ...needs, buildWork: false } }));
    await new Promise((r) => setTimeout(r, 60));
    const secondInput = await input({
      fake: fakeSession(handler("second")),
      serverId,
      built,
      needs: { ...needs, buildWork: false },
      preflight: async () => (looked++, goodFacts),
    });
    const second = runContainerBuild(secondInput);
    await new Promise((r) => setTimeout(r, 100));
    expect(events).toEqual(["first unpack start"]); // the second one is waiting, not extracting
    expect((secondInput.log as ReturnType<typeof logs>).lines.join("\n")).toContain("Another build is running on this container");
    release();
    await Promise.all([first, second]);
    expect(events).toEqual(["first unpack start", "first unpack end", "second unpack start", "second unpack end"]);
    expect(most).toBe(1);
    expect(looked).toBe(1); // after waiting, the container's disk was checked again
    expect(await lockHolder(serverId)).toBeNull();
  });

  it("a deploy with nothing to build that waited stops when the disk is now too full, and frees the lock", async () => {
    const serverId = await newServer("sam-nobuild-disk");
    await tryAcquireBuildLock(serverId, "someone-else");
    setTimeout(() => void releaseBuildLock(serverId, "someone-else"), 60);
    const noBuild = { buildInstall: null, buildCommand: null, remoteInstall: null, archiveRoot: ".", excludeNodeModules: false };
    const fake = fakeSession(() => ({ code: 0 }));
    const a = await input({
      fake,
      serverId,
      built: { archivePath: "/tmp/s.tar.gz", sha256: "abc", sizeBytes: 10, spec: noBuild },
      needs: { ...needs, buildWork: false },
      preflight: async () => ({ ...goodFacts, diskFreeMb: 500 }),
    });
    await expect(runContainerBuild(a)).rejects.toThrow(/Free up disk space on your container: 500 MB is free/);
    expect(fake.count("unpack")).toBe(0);
    expect(fake.count("discard")).toBe(1);
    expect(await lockHolder(serverId)).toBeNull();
  });

  it("removes leftover variables files of other releases before it unpacks, under the lock, and never writes before that", async () => {
    const fake = fakeSession(() => ({ code: 0 }));
    const a = await input({ fake });
    await runContainerBuild(a);
    const kinds = fake.calls.map((c) => c.kind);
    expect(kinds.indexOf("sweep")).toBe(0);
    expect(kinds.indexOf("sweep")).toBeLessThan(kinds.indexOf("unpack"));
    const sweep = fake.calls[0].body;
    expect(sweep).toContain("egg_dir_managed '/root/.egg/demo'");
    expect(sweep).toContain(`[ "$id" = '${a.releaseId}' ] && continue`);
  });

  it("a sweep that cannot run only warns; the build goes on", async () => {
    const fake = fakeSession((kind) => {
      if (kind === "sweep") throw new SshError("channel closed", "exec");
      return { code: 0 };
    });
    const a = await input({ fake });
    await runContainerBuild(a);
    expect((a.log as ReturnType<typeof logs>).lines.join("\n")).toContain("Could not look for leftover build variables files");
    expect(fake.count("build")).toBe(1);
  });

  it("keeps the lock when the stop cannot be confirmed: the cleanup could not run", async () => {
    const fake = fakeSession((kind) => {
      if (kind === "build") throw new SshError("connection reset", "network");
      if (kind === "discard") throw new SshError("connection reset", "network");
      return { code: 0 };
    });
    const a = await input({ fake });
    await expect(runContainerBuild(a)).rejects.toThrow("connection reset");
    expect(fake.count("discard")).toBe(1); // tried once, inside the lock, and not again outside it
    expect(await lockHolder(a.serverId)).toBe(a.deploymentId); // not released: it goes stale
    expect((a.log as ReturnType<typeof logs>).lines.join("\n")).toContain("Could not remove the unfinished release folder");
    await releaseBuildLock(a.serverId, a.deploymentId);
  });

  it("keeps the lock when the cleanup ran but the scope is still running", async () => {
    const fake = fakeSession((kind) => {
      if (kind === "build") return { code: 2 };
      if (kind === "discard") return { code: EXIT_SCOPE_RUNNING, stderr: "still running" };
      return { code: 0 };
    });
    const a = await input({ fake });
    await expect(runContainerBuild(a)).rejects.toThrow("The build failed (exit 2).");
    expect(await lockHolder(a.serverId)).toBe(a.deploymentId);
    expect((a.log as ReturnType<typeof logs>).lines.join("\n")).toContain("Could not confirm that the build stopped on your container");
    await releaseBuildLock(a.serverId, a.deploymentId);
  });

  it("releases the lock when the stop is confirmed, on every kind of failure", async () => {
    for (const failing of ["build-code", "ssh-timeout", "unpack-code"] as const) {
      const fake = fakeSession((kind) => {
        if (kind === "build" && failing === "build-code") return { code: 2 };
        if (kind === "build" && failing === "ssh-timeout") throw new SshError("Command timed out", "timeout");
        if (kind === "unpack" && failing === "unpack-code") return { code: 9 };
        return { code: 0 };
      });
      const a = await input({ fake });
      await expect(runContainerBuild(a)).rejects.toThrow();
      expect(fake.count("discard"), failing).toBe(1);
      expect(await lockHolder(a.serverId), failing).toBeNull();
    }
  });

  it("a later build verifies a stale lock on the container, cleans up after the stale holder, and only then takes it", async () => {
    const holder = await newHolder("sam-stale-ok", "stale-ok");
    const t0 = new Date(Date.now() - LOCK_STALE_AFTER_MS - 5000);
    await tryAcquireBuildLock(holder.serverId, holder.deploymentId, t0);
    let heldAtVerify: string | null | undefined;
    const fake = fakeSession(async (kind) => {
      if (kind === "verify") heldAtVerify = await lockHolder(holder.serverId);
      return { code: 0, stdout: kind === "verify" ? "No build scope is running." : "" };
    });
    const a = await input({ fake, serverId: holder.serverId, slug: "next-project" });
    await runContainerBuild(a);
    const kinds = fake.calls.map((c) => c.kind);
    // Verify the scopes, remove the stale holder's release, and only then start this build's own steps.
    expect(kinds).toEqual(["verify", "discard", "sweep", "unpack", "build"]);
    expect(heldAtVerify).toBe(holder.deploymentId); // still the stale holder's while it was being checked
    expect(fake.calls[0].body).toContain("list-units");
    expect(fake.calls[1].body).toContain(`rm -rf '/root/.egg/${holder.slug}/releases/${holder.releaseId}'`);
    expect(fake.calls[1].body).toContain(`rm -f '/root/.egg/${holder.slug}/incoming/${holder.releaseId}.buildenv'`);
    const text = (a.log as ReturnType<typeof logs>).lines.join("\n");
    expect(text).toContain("A previous build on this container stopped reporting in");
    expect(text).toContain("confirmed stopped and cleaned up");
    expect(await lockHolder(holder.serverId)).toBeNull();
  });

  it("a stale holder with no deployment record: only the scopes are checked, then the lock is taken", async () => {
    const serverId = await newServer("sam-stale-norecord");
    await tryAcquireBuildLock(serverId, "no-such-deployment", new Date(Date.now() - LOCK_STALE_AFTER_MS - 5000));
    const fake = fakeSession(() => ({ code: 0 }));
    const a = await input({ fake, serverId });
    await runContainerBuild(a);
    expect(fake.calls.map((c) => c.kind)).toEqual(["verify", "sweep", "unpack", "build"]);
    expect((a.log as ReturnType<typeof logs>).lines.join("\n")).toContain("no deployment record");
    expect(await lockHolder(serverId)).toBeNull();
  });

  it("a stale lock is refused, and left as it was, when a build scope cannot be confirmed stopped", async () => {
    const holder = await newHolder("sam-stale-running", "stale-running");
    const t0 = new Date(Date.now() - LOCK_STALE_AFTER_MS - 5000);
    await tryAcquireBuildLock(holder.serverId, holder.deploymentId, t0);
    const fake = fakeSession((kind) => (kind === "verify" ? { code: EXIT_SCOPE_RUNNING, stderr: "egg-build-0a1b2c3d.scope is still running." } : { code: 0 }));
    const a = await input({ fake, serverId: holder.serverId });
    await expect(runContainerBuild(a)).rejects.toThrow(/could not confirm that it has stopped running on your container, so this build did not start/);
    expect(fake.count("sweep") + fake.count("unpack") + fake.count("build")).toBe(0);
    const row = await buildLockForServer(holder.serverId);
    expect(row?.holder).toBe(holder.deploymentId);
    expect(row?.at?.getTime()).toBe(t0.getTime());
    // This build's own upload is removed.
    expect(fake.calls.filter((c) => c.kind === "discard").map((c) => c.body).join("\n")).toContain(a.releaseId);
  });

  it("a stale lock is refused when the container cannot be reached for the check, or the cleanup of the stale holder fails", async () => {
    for (const failing of ["verify-ssh", "discard-code", "discard-ssh"] as const) {
      const holder = await newHolder(`sam-stale-${failing}`, `stale-${failing}`);
      const t0 = new Date(Date.now() - LOCK_STALE_AFTER_MS - 5000);
      await tryAcquireBuildLock(holder.serverId, holder.deploymentId, t0);
      const fake = fakeSession((kind, body) => {
        if (kind === "verify" && failing === "verify-ssh") throw new SshError("connection reset", "network");
        if (kind === "discard" && body.includes(holder.releaseId)) {
          if (failing === "discard-code") return { code: EXIT_SCOPE_RUNNING };
          if (failing === "discard-ssh") throw new SshError("connection reset", "network");
        }
        return { code: 0 };
      });
      const a = await input({ fake, serverId: holder.serverId });
      await expect(runContainerBuild(a), failing).rejects.toThrow(/did not start/);
      expect(fake.count("build"), failing).toBe(0);
      expect((await buildLockForServer(holder.serverId))?.holder, failing).toBe(holder.deploymentId);
    }
  });

  it("a fresh lock is never verified: the build waits for it", async () => {
    const serverId = await newServer("sam-fresh-wait");
    await tryAcquireBuildLock(serverId, "busy-now");
    setTimeout(() => void releaseBuildLock(serverId, "busy-now"), 60);
    const deploymentId = randomUUID();
    const log = logs();
    // The first remote step that runs under the lock must see this build as the holder: the
    // busy lock was released and taken over, not ignored.
    let holderAtUnpack: string | null | undefined;
    const fake = fakeSession(async (kind) => {
      if (kind === "unpack") holderAtUnpack = await lockHolder(serverId);
      return { code: 0 };
    });
    await runContainerBuild(await input({ fake, serverId, deploymentId, log }));
    expect(fake.count("verify")).toBe(0);
    expect(log.lines).toContain("info: Another build is running on this container. Waiting for it to finish.");
    expect(fake.count("unpack")).toBe(1);
    expect(holderAtUnpack).toBe(deploymentId);
  });

  it("a cancel while the stale holder is being checked ends the build without taking the lock", async () => {
    const holder = await newHolder("sam-stale-cancel", "stale-cancel");
    const t0 = new Date(Date.now() - LOCK_STALE_AFTER_MS - 5000);
    await tryAcquireBuildLock(holder.serverId, holder.deploymentId, t0);
    const abort = new AbortController();
    const fake = fakeSession((kind, _body, opts) => {
      if (kind !== "verify") return { code: 0 };
      return new Promise<Reply>((_, reject) => {
        setTimeout(() => abort.abort(), 20);
        opts.signal?.addEventListener("abort", () => reject(new SshError("Command canceled", "exec")), { once: true });
      });
    });
    const a = await input({ fake, serverId: holder.serverId, signal: abort.signal });
    await expect(runContainerBuild(a)).rejects.toThrow("The deployment was canceled.");
    expect(fake.count("build")).toBe(0);
    expect((await buildLockForServer(holder.serverId))?.holder).toBe(holder.deploymentId);
  });

  it("two builds that find the same stale lock: one takes it, the other waits and then builds after it", async () => {
    const holder = await newHolder("sam-stale-two", "stale-two");
    await tryAcquireBuildLock(holder.serverId, holder.deploymentId, new Date(Date.now() - LOCK_STALE_AFTER_MS - 5000));
    let arrived = 0;
    let open!: () => void;
    const both = new Promise<void>((r) => (open = r));
    const events: string[] = [];
    const make = (who: string) =>
      fakeSession(async (kind) => {
        if (kind === "verify") {
          if (++arrived === 2) open();
          await both;
        }
        if (kind === "build") {
          events.push(`${who} build start`);
          await new Promise((r) => setTimeout(r, 60));
          events.push(`${who} build end`);
        }
        return { code: 0 };
      });
    const one = runContainerBuild(await input({ fake: make("one"), serverId: holder.serverId, lockPollMs: 5 }));
    const two = runContainerBuild(await input({ fake: make("two"), serverId: holder.serverId, lockPollMs: 5 }));
    await Promise.all([one, two]);
    expect(events).toHaveLength(4);
    expect(events[0].split(" ")[0]).toBe(events[1].split(" ")[0]);
    expect(events[2].split(" ")[0]).toBe(events[3].split(" ")[0]);
    expect(events[0].split(" ")[0]).not.toBe(events[2].split(" ")[0]);
    expect(await lockHolder(holder.serverId)).toBeNull();
  });

  it("a build whose lock was taken over stops its own build, cleans its own release, and does not free the new holder's lock", async () => {
    const serverId = await newServer("sam-lost");
    let buildStarted!: () => void;
    const started = new Promise<void>((r) => (buildStarted = r));
    const fake = fakeSession((kind, _body, opts) => {
      if (kind !== "build") return { code: 0 };
      buildStarted();
      // The build runs until it is aborted, as an SSH command does when its signal fires.
      return new Promise<Reply>((_, reject) => {
        opts.signal?.addEventListener("abort", () => reject(new SshError("Command canceled", "exec")), { once: true });
      });
    });
    const a = await input({ fake, serverId, lockRenewMs: 100 });
    const running = runContainerBuild(a);
    const settled = running.then(() => null, (e: unknown) => e);
    await started;
    // Another build verified this one stale and took the lock.
    let taken = false;
    for (let i = 0; i < 50 && !taken; i++) {
      const row = await buildLockForServer(serverId);
      taken = await takeOverBuildLock(serverId, { holder: a.deploymentId, at: row!.at }, "the-new-holder");
    }
    expect(taken).toBe(true);
    const err = await settled;
    expect(err).toBeInstanceOf(ContainerBuildError);
    expect((err as Error).message).toMatch(/another deployment took over this container's build lock and this build was stopped/);
    expect(fake.count("stop")).toBeGreaterThanOrEqual(1); // its scope was stopped
    expect(fake.count("discard")).toBe(1); // its own release folder was removed
    expect(await lockHolder(serverId)).toBe("the-new-holder");
    await releaseBuildLock(serverId, "the-new-holder");
  });

  it("the second build on a container waits for the first, and never runs beside it", async () => {
    const serverId = await newServer("sam-two-builds");
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const events: string[] = [];
    const slow = fakeSession(async (kind) => {
      if (kind === "build") {
        events.push("first build start");
        await gate;
        events.push("first build end");
      }
      return { code: 0 };
    });
    const quick = fakeSession((kind) => {
      if (kind === "build") events.push("second build start");
      return { code: 0 };
    });
    const first = runContainerBuild(await input({ fake: slow, serverId }));
    await new Promise((r) => setTimeout(r, 60));
    const secondInput = await input({ fake: quick, serverId });
    const second = runContainerBuild(secondInput);
    await new Promise((r) => setTimeout(r, 100));
    expect(events).toEqual(["first build start"]);
    expect((secondInput.log as ReturnType<typeof logs>).lines.join("\n")).toContain("Another build is running on this container");
    release();
    await Promise.all([first, second]);
    expect(events).toEqual(["first build start", "first build end", "second build start"]);
    expect(await lockHolder(serverId)).toBeNull();
  });

  it("a build canceled while it waits for the lock removes what it uploaded", async () => {
    const serverId = await newServer("sam-wait-cancel");
    await tryAcquireBuildLock(serverId, "someone-else");
    const abort = new AbortController();
    const fake = fakeSession(() => ({ code: 0 }));
    const a = await input({ fake, serverId, signal: abort.signal });
    setTimeout(() => abort.abort(), 50);
    await expect(runContainerBuild(a)).rejects.toThrow("The deployment was canceled.");
    expect(fake.count("build")).toBe(0);
    expect(fake.count("discard")).toBe(1);
    expect(await lockHolder(serverId)).toBe("someone-else");
    await releaseBuildLock(serverId, "someone-else");
  });

  it("checks the disk again after waiting, because another build may have filled it", async () => {
    const serverId = await newServer("sam-wait-disk");
    await tryAcquireBuildLock(serverId, "someone-else");
    setTimeout(() => void releaseBuildLock(serverId, "someone-else"), 60);
    const fake = fakeSession(() => ({ code: 0 }));
    const a = await input({
      fake,
      serverId,
      preflight: async () => ({ ...goodFacts, diskFreeMb: 500 }),
    });
    await expect(runContainerBuild(a)).rejects.toThrow(/Free up disk space on your container: 500 MB is free/);
    expect(fake.count("build")).toBe(0);
    expect(fake.count("discard")).toBe(1);
    expect(await lockHolder(serverId)).toBeNull();
  });
});

describe("the check before the upload", () => {
  it("throws one fix line and logs the rest", async () => {
    const log = logs();
    await expect(
      checkContainerReady({
        preflight: async () => ({ ...goodFacts, pythonVenv: false, hasSystemdRun: false }),
        needs: { ...needs, node: false, packageManager: null, python: true },
        home: "/root",
        slug: "demo",
        log,
      })
    ).rejects.toThrow(/systemd-run/);
    expect(log.lines.some((l) => l.startsWith("warn: Install python3-venv"))).toBe(true);
  });

  it("asks about the release area of this project", async () => {
    let asked = "";
    await checkContainerReady({
      preflight: async (dir) => {
        asked = dir;
        return goodFacts;
      },
      needs,
      home: "/home/sam-r",
      slug: "demo",
      log: logs(),
    });
    expect(asked).toBe("/home/sam-r/.egg/demo/releases");
  });
});
