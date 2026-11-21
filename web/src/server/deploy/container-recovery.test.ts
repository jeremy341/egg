import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { upsertUser } from "@/server/auth/session";
import { schema } from "@/server/db";
import { LOCK_STALE_AFTER_MS, buildLockForServer, tryAcquireBuildLock } from "@/server/deploy/build-lock";
import {
  EXIT_SCOPE_RUNNING,
  buildEnvFile,
  buildSteps,
  cappedBuildScript,
  discardBuildScript,
  removeLeftoverBuildEnvScript,
  renderBuildEnv,
  runContainerBuild,
  stopAllBuildScopesScript,
} from "@/server/deploy/container-build";
import type { PreflightNeeds } from "@/server/deploy/container-probe";
import { prepareDirs, pruneReleases } from "@/server/deploy/remote";
import { createProject, deployBranch } from "@/server/projects";
import { createServer } from "@/server/servers";
import { generateServerKey } from "@/server/ssh/keys";
import { NestSession } from "@/server/ssh/connection";
import { containerReadyFacts, installFakeContainerBuild, installFakeSystemd } from "@/server/test/fake-nest";
import { useFreshDb } from "@/server/test/db";
import { linuxTestHostAvailable, startMockSsh, type MockSsh } from "@/server/test/mock-ssh";
import { rawTarGz, sha256Of } from "@/server/test/raw-tar";

/**
 * The recovery paths against the fake container, with real shell scripts: the variables file is
 * removed once loaded, interrupted builds' files are pruned and swept, a stale lock is verified on
 * the container before it is taken over. systemd is a stand-in here (see fake-nest.ts), so the
 * scripts' calls and their exit codes are proven, not real systemd behavior.
 */
let ctx: Awaited<ReturnType<typeof useFreshDb>>;
let mock: MockSsh;
let session: NestSession;
let temp: string;
let home = "";

const sh = async (command: string) => (await session.exec(command)).stdout.trim();
const run = (script: string, timeoutMs = 60_000) => session.script(script, { timeoutMs });
const exists = async (p: string) => (await sh(`[ -e '${p}' ] && echo yes || echo no`)) === "yes";

beforeAll(async () => {
  ctx = await useFreshDb();
  const key = generateServerKey("recovery-test");
  mock = await startMockSsh({ authorizedKeys: [key.publicKey] });
  installFakeSystemd(mock);
  installFakeContainerBuild(mock);
  session = await NestSession.connect({ host: "127.0.0.1", port: mock.port, username: "test", privateKey: key.privateKey });
  home = mock.home.replace(/\\/g, "/");
  temp = mkdtempSync(path.join(tmpdir(), "egg-recovery-test-"));
});
afterAll(async () => {
  // No scope started by a test is left running.
  await sh('for f in "$HOME"/.fake-systemd/egg-build-*.scope.pid; do [ -f "$f" ] && kill "$(cat "$f")" 2>/dev/null; done; true').catch(() => {});
  session.close();
  await mock.stop();
  await ctx.cleanup();
  rmSync(temp, { recursive: true, force: true });
});

const uuid = () => randomUUID();
let nextPort = 3100;

/** Start a fake build scope that keeps running, the way a build the Egg worker lost track of would. Returns its pid. */
async function startZombieScope(unit: string): Promise<number> {
  await sh(`rm -f "$HOME/.fake-systemd/${unit}.scope.pid"; (setsid nohup systemd-run --scope --unit=${unit} -- sleep 300 >/dev/null 2>&1 </dev/null &); sleep 1; true`);
  const pid = Number(await sh(`cat "$HOME/.fake-systemd/${unit}.scope.pid"`));
  expect(pid).toBeGreaterThan(0);
  expect(await sh(`kill -0 ${pid} 2>/dev/null && echo alive || echo dead`)).toBe("alive");
  return pid;
}
const alive = async (pid: number) => (await sh(`kill -0 ${pid} 2>/dev/null && echo alive || echo dead`)) === "alive";

/** Stand in for systemctl that cannot stop anything, so a scope stays up however it is asked to stop. */
const STOP_DOES_NOTHING = 'systemctl() { case "$1" in stop|reset-failed) return 0;; *) command systemctl "$@";; esac; }\n';

describe.skipIf(!linuxTestHostAvailable())("the build variables file", () => {
  async function prepare(slug: string, releaseId: string, envText: string) {
    await run(prepareDirs(home, slug));
    await sh(`mkdir -p '${home}/.egg/${slug}/releases/${releaseId}'`);
    await session.writeFile(buildEnvFile(home, slug, releaseId), envText, "600");
    expect(await exists(buildEnvFile(home, slug, releaseId))).toBe(true);
  }
  const build = (slug: string, releaseId: string, command: string) =>
    cappedBuildScript({
      home,
      slug,
      releaseId,
      memoryMb: 512,
      cpuPercent: 100,
      steps: buildSteps({ buildInstall: null, buildCommand: command, remoteInstall: null }),
      archiveRoot: ".",
      hasEnvFile: true,
    });

  it("is removed as soon as the build has loaded it, while the build still sees the variables", async () => {
    const releaseId = uuid();
    await prepare("env-a", releaseId, renderBuildEnv({ GREETING: "hello there", QUOTE: "it's" }));
    const file = buildEnvFile(home, "env-a", releaseId);
    // The first build step looks for the file, and prints the variables it was given.
    const res = await run(build("env-a", releaseId, `if [ -e '${file}' ]; then echo present; else echo gone; fi > "$HOME/env-a.txt"; echo "$GREETING|$QUOTE" >> "$HOME/env-a.txt"`));
    expect(res.code, res.stderr).toBe(0);
    expect(await sh('cat "$HOME/env-a.txt"')).toBe("gone\nhello there|it's");
    expect(await exists(file)).toBe(false);
  }, 60_000);

  it("is removed when the build fails, and when the file itself cannot be loaded", async () => {
    const failing = uuid();
    await prepare("env-b", failing, renderBuildEnv({ A: "1" }));
    const res = await run(build("env-b", failing, "exit 3"));
    expect(res.code).toBe(3);
    expect(await exists(buildEnvFile(home, "env-b", failing))).toBe(false);

    // A file the shell cannot load: the exit trap still removes it.
    const broken = uuid();
    await prepare("env-b", broken, "export A='never closed\n");
    const res2 = await run(build("env-b", broken, "echo should-not-run > \"$HOME/env-b-ran.txt\""));
    expect(res2.code).not.toBe(0);
    expect(await exists(buildEnvFile(home, "env-b", broken))).toBe(false);
    expect(await exists(`${home}/env-b-ran.txt`)).toBe(false);
  }, 60_000);
});

describe("variables files an interrupted build left behind", () => {
  const files = async (slug: string) => (await sh(`ls '${home}/.egg/${slug}/incoming' 2>/dev/null | sort`)).split("\n").filter(Boolean);

  it("are removed by pruning, except for a build that is running", async () => {
    const slug = "prune-a";
    await run(prepareDirs(home, slug));
    const [old1, old2, running] = [uuid(), uuid(), uuid()];
    for (const id of [old1, old2, running]) await session.writeFile(buildEnvFile(home, slug, id), "export A='secret'\n", "600");
    await sh(`touch '${home}/.egg/${slug}/incoming/notes.buildenv' '${home}/.egg/${slug}/incoming/${old1}.tar.gz'`);
    const res = await run(pruneReleases(home, slug, [], [running]));
    expect(res.code, res.stderr).toBe(0);
    // The running build's file stays; a name that is not a release id is not Egg's and stays; archives go as before.
    expect(await files(slug)).toEqual([`${running}.buildenv`, "notes.buildenv"].sort());
  }, 60_000);

  it("are removed by pruning even when the project has no releases folder yet", async () => {
    const slug = "prune-b";
    await sh(`mkdir -p '${home}/.egg/${slug}/incoming'`);
    const id = uuid();
    await session.writeFile(buildEnvFile(home, slug, id), "export A='secret'\n", "600");
    expect((await run(pruneReleases(home, slug, []))).code).toBe(0);
    expect(await files(slug)).toEqual([]);
  }, 60_000);

  it("are removed at the start of the next build of the project, but not its own, and not in a folder Egg did not make", async () => {
    const slug = "sweep-a";
    await run(prepareDirs(home, slug));
    const [left1, left2, own] = [uuid(), uuid(), uuid()];
    for (const id of [left1, left2, own]) await session.writeFile(buildEnvFile(home, slug, id), "export A='secret'\n", "600");
    const res = await run(removeLeftoverBuildEnvScript({ home, slug, keepReleaseId: own }));
    expect(res.code, res.stderr).toBe(0);
    expect(res.stdout).toContain("Removed a leftover build variables file");
    expect(await files(slug)).toEqual([`${own}.buildenv`]);

    // A folder with the same layout that Egg did not make (a git checkout) is left alone.
    const foreign = "sweep-b";
    await sh(`mkdir -p '${home}/.egg/${foreign}/incoming' '${home}/.egg/${foreign}/.git'`);
    await session.writeFile(buildEnvFile(home, foreign, left1), "export A='theirs'\n", "600");
    expect((await run(removeLeftoverBuildEnvScript({ home, slug: foreign, keepReleaseId: own }))).code).toBe(0);
    expect(await files(foreign)).toEqual([`${left1}.buildenv`]);
  }, 60_000);
});

describe.skipIf(!linuxTestHostAvailable())("stopping and confirming a build scope", () => {
  it("the scope sweep stops every build scope that is running and confirms they are gone", async () => {
    const [a, b] = await Promise.all([startZombieScope("egg-build-aaaaaaa1"), startZombieScope("egg-build-bbbbbbb2")]);
    const res = await run(stopAllBuildScopesScript());
    expect(res.code, res.stderr).toBe(0);
    expect(res.stdout).toContain("Stopping egg-build-aaaaaaa1.scope");
    expect(res.stdout).toContain("Stopping egg-build-bbbbbbb2.scope");
    expect(await alive(a)).toBe(false);
    expect(await alive(b)).toBe(false);
    // Nothing running: it still passes.
    const again = await run(stopAllBuildScopesScript());
    expect(again.code).toBe(0);
    expect(again.stdout).toContain("No build scope is running.");
  }, 60_000);

  it("the scope sweep fails when a scope will not stop, and when the scopes cannot be listed", async () => {
    const pid = await startZombieScope("egg-build-ccccccc3");
    const stuck = await run(STOP_DOES_NOTHING + stopAllBuildScopesScript());
    expect(stuck.code).toBe(EXIT_SCOPE_RUNNING);
    expect(stuck.stderr).toContain("egg-build-ccccccc3.scope is still running.");
    expect(await alive(pid)).toBe(true);

    await sh('mkdir -p "$HOME/.fake-systemd" && touch "$HOME/.fake-systemd/list-units-fails"');
    try {
      const unlisted = await run(stopAllBuildScopesScript());
      expect(unlisted.code).toBe(EXIT_SCOPE_RUNNING);
      expect(unlisted.stderr).toContain("Could not list the build scopes");
    } finally {
      await sh('rm -f "$HOME/.fake-systemd/list-units-fails"');
    }
    expect((await run(stopAllBuildScopesScript())).code).toBe(0);
    expect(await alive(pid)).toBe(false);
  }, 60_000);

  it("the discard stops the scope and removes the files, and exits with the unconfirmed code when the scope stays up", async () => {
    const slug = "discard-a";
    const releaseId = uuid();
    await run(prepareDirs(home, slug));
    const unit = `egg-build-${releaseId.slice(0, 8)}`;
    const mk = async () => {
      await sh(`mkdir -p '${home}/.egg/${slug}/releases/${releaseId}'`);
      await session.writeFile(buildEnvFile(home, slug, releaseId), "export A='secret'\n", "600");
      await sh(`touch '${home}/.egg/${slug}/incoming/${releaseId}.tar.gz'`);
    };
    await mk();
    const pid = await startZombieScope(unit);
    const stuck = await run(STOP_DOES_NOTHING + discardBuildScript({ home, slug, releaseId }));
    expect(stuck.code).toBe(EXIT_SCOPE_RUNNING);
    // The files are removed anyway; only the stop was not confirmed.
    expect(await exists(buildEnvFile(home, slug, releaseId))).toBe(false);
    expect(await exists(`${home}/.egg/${slug}/releases/${releaseId}`)).toBe(false);
    expect(await alive(pid)).toBe(true);

    await mk();
    const ok = await run(discardBuildScript({ home, slug, releaseId }));
    expect(ok.code, ok.stderr).toBe(0);
    expect(await alive(pid)).toBe(false);
    expect(await exists(`${home}/.egg/${slug}/incoming/${releaseId}.tar.gz`)).toBe(false);
    // A scope that is not there at all is a confirmed stop too.
    expect((await run(discardBuildScript({ home, slug, releaseId }))).code).toBe(0);
  }, 60_000);
});

describe.skipIf(!linuxTestHostAvailable())("taking over a stale build lock on the container", () => {
  const needs: PreflightNeeds = { node: true, nodeEngine: null, packageManager: "npm", python: false, buildWork: true };
  const logLines: string[] = [];
  const log = {
    info: (m: string) => logLines.push(m),
    warn: (m: string) => logLines.push(m),
    error: (m: string) => logLines.push(m),
  };

  async function owner(name: string) {
    const user = await upsertUser({ id: `u-${uuid()}`, name, email: null, slackId: null });
    const server = await createServer(user.id, name);
    return { userId: user.id, serverId: server.id };
  }
  async function project(userId: string, serverId: string, slug: string) {
    return createProject(userId, {
      serverId,
      name: slug,
      slug,
      repoUrl: "https://github.com/example/demo",
      runtime: "node",
      startCommand: "node server.js",
      port: nextPort++,
      healthPath: "/",
    });
  }

  it("verifies on the container, stops the old build, cleans up after it, and only then builds", async () => {
    const { userId, serverId } = await owner("recovery-takeover");
    const oldProject = await project(userId, serverId, "old-app");
    const staleDeployment = await deployBranch(userId, oldProject.id, oldProject.productionBranch);
    const staleRelease = staleDeployment.releaseId;
    const oldDir = `${home}/.egg/old-app`;
    // What the lost build left: its folders, its variables file, its archive, and a scope that is still running.
    await run(prepareDirs(home, "old-app"));
    await sh(`mkdir -p '${oldDir}/releases/${staleRelease}' && echo half > '${oldDir}/releases/${staleRelease}/partial'`);
    await session.writeFile(buildEnvFile(home, "old-app", staleRelease), "export SECRET='plain'\n", "600");
    await sh(`touch '${oldDir}/incoming/${staleRelease}.tar.gz'`);
    const staleScope = await startZombieScope(`egg-build-${staleRelease.slice(0, 8)}`);
    const stranger = await startZombieScope("egg-build-ddddddd4");
    await tryAcquireBuildLock(serverId, staleDeployment.id, new Date(Date.now() - LOCK_STALE_AFTER_MS - 5000));

    // The new build: a project of its own, with a leftover variables file of another release.
    const nextProject = await project(userId, serverId, "next-app");
    const next = await deployBranch(userId, nextProject.id, "feature/x");
    const nextDir = `${home}/.egg/next-app`;
    await run(prepareDirs(home, "next-app"));
    const leftover = uuid();
    await session.writeFile(buildEnvFile(home, "next-app", leftover), "export OLD='plain'\n", "600");

    const archive = rawTarGz([{ name: "index.html", content: "hello" }]);
    const local = path.join(temp, "next.tar.gz");
    writeFileSync(local, archive);
    logLines.length = 0;
    await runContainerBuild({
      session,
      log,
      serverId,
      deploymentId: next.id,
      home,
      slug: "next-app",
      releaseId: next.releaseId,
      built: {
        archivePath: local,
        sha256: sha256Of(archive),
        sizeBytes: archive.length,
        spec: { buildInstall: null, buildCommand: 'echo "$GREETING" > built.txt', remoteInstall: null, archiveRoot: ".", excludeNodeModules: false },
      },
      env: { GREETING: "hi" },
      memoryMb: 512,
      cpuCores: 1,
      containerMemoryMb: 4096,
      appRunning: false,
      needs,
      preflight: async () => containerReadyFacts,
      lockPollMs: 20,
    });

    // The old build is stopped (and so is any other build scope), and its leftovers are gone.
    expect(await alive(staleScope)).toBe(false);
    expect(await alive(stranger)).toBe(false);
    expect(await exists(`${oldDir}/releases/${staleRelease}`)).toBe(false);
    expect(await exists(`${oldDir}/incoming/${staleRelease}.buildenv`)).toBe(false);
    expect(await exists(`${oldDir}/incoming/${staleRelease}.tar.gz`)).toBe(false);
    // The new build's own project: the leftover variables file went, and the build ran.
    expect(await exists(buildEnvFile(home, "next-app", leftover))).toBe(false);
    expect(await sh(`cat '${nextDir}/releases/${next.releaseId}/built.txt'`)).toBe("hi");
    expect(await sh(`cat '${nextDir}/releases/${next.releaseId}/index.html'`)).toBe("hello");
    expect(await exists(buildEnvFile(home, "next-app", next.releaseId))).toBe(false);
    expect(logLines.join("\n")).toContain("confirmed stopped and cleaned up");
    expect((await buildLockForServer(serverId))?.holder).toBeNull();
    const row = await ctx.db.select().from(schema.servers).where(eq(schema.servers.id, serverId)).get();
    expect(row?.buildLockAt).toBeNull();
  }, 120_000);

  it("refuses to start beside a build scope that will not stop, and leaves the stale lock alone", async () => {
    const { userId, serverId } = await owner("recovery-refuse");
    const oldProject = await project(userId, serverId, "stuck-app");
    const staleDeployment = await deployBranch(userId, oldProject.id, oldProject.productionBranch);
    await run(prepareDirs(home, "stuck-app"));
    const pid = await startZombieScope(`egg-build-${staleDeployment.releaseId.slice(0, 8)}`);
    const t0 = new Date(Date.now() - LOCK_STALE_AFTER_MS - 5000);
    await tryAcquireBuildLock(serverId, staleDeployment.id, t0);

    const nextProject = await project(userId, serverId, "refused-app");
    const next = await deployBranch(userId, nextProject.id, "feature/y");
    await run(prepareDirs(home, "refused-app"));
    const archive = rawTarGz([{ name: "index.html", content: "hello" }]);
    const local = path.join(temp, "refused.tar.gz");
    writeFileSync(local, archive);
    // A session whose systemctl can start but never stop anything.
    const stuckSession = {
      script: (body: string, opts?: Parameters<NestSession["script"]>[1]) => session.script(STOP_DOES_NOTHING + body, opts),
      uploadFile: session.uploadFile.bind(session),
      writeFile: session.writeFile.bind(session),
      exec: session.exec.bind(session),
    };
    await expect(
      runContainerBuild({
        session: stuckSession,
        log,
        serverId,
        deploymentId: next.id,
        home,
        slug: "refused-app",
        releaseId: next.releaseId,
        built: {
          archivePath: local,
          sha256: sha256Of(archive),
          sizeBytes: archive.length,
          spec: { buildInstall: null, buildCommand: "echo hi", remoteInstall: null, archiveRoot: ".", excludeNodeModules: false },
        },
        env: {},
        memoryMb: 512,
        cpuCores: 1,
        containerMemoryMb: 4096,
        appRunning: false,
        needs,
        preflight: async () => containerReadyFacts,
        lockPollMs: 20,
      })
    ).rejects.toThrow(/could not confirm that it has stopped running on your container, so this build did not start/);
    expect(await alive(pid)).toBe(true); // still running, so no second build was started beside it
    expect(await exists(`${home}/.egg/refused-app/releases/${next.releaseId}`)).toBe(false);
    const lock = await buildLockForServer(serverId);
    expect(lock?.holder).toBe(staleDeployment.id);
    expect(lock?.at?.getTime()).toBe(t0.getTime());
    await sh(`kill ${pid} 2>/dev/null; true`);
  }, 120_000);
});
