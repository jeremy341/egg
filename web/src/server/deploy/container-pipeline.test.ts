import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { upsertUser } from "@/server/auth/session";
import { schema } from "@/server/db";
import { runDeployJob, type PipelineDeps } from "@/server/deploy/pipeline";
import { diskWatchdogEndScript, diskWatchdogStartScript } from "@/server/deploy/container-build";
import type { PreflightFacts } from "@/server/deploy/container-probe";
import {
  cancelDeployment,
  createProject,
  deployBranch,
  deploymentLogs,
  updateProject,
  type ProjectRow,
} from "@/server/projects";
import { connectToServer, createServer, getServerForUser, type ServerRow } from "@/server/servers";
import { NestSession, shellQuote } from "@/server/ssh/connection";
import {
  containerReadyFacts,
  fakeBuilder,
  freePort,
  installFakeContainerBuild,
  installFakeSystemd,
  nodeApp,
  type FixtureFiles,
} from "@/server/test/fake-nest";
import { useFreshDb } from "@/server/test/db";
import { linuxTestHostAvailable, startMockSsh, type MockSsh } from "@/server/test/mock-ssh";

/**
 * A deploy that builds on the container, against the fake Nest. systemd-run and timeout are
 * stand-ins that run the command (a test machine has no memory controller to cap), so what is
 * proven here is the order of events, the release folder lifecycle and the arguments passed.
 * The kernel enforcing the cap is not something these tests can show.
 */
let ctx: Awaited<ReturnType<typeof useFreshDb>>;
let mock: MockSsh;
let userId: string;
let server: ServerRow;
let deps: PipelineDeps;
let files: FixtureFiles = nodeApp("v1");
let home = "";
let sourceBuilds = 0;

let facts: PreflightFacts = containerReadyFacts;

async function sh(command: string) {
  const s = await NestSession.connect({
    host: "127.0.0.1",
    port: mock.port,
    username: "sam-r",
    privateKey: (await import("@/server/crypto")).open(server.privateKeyEnc, `server:${server.id}`),
  });
  try {
    return (await s.exec(command)).stdout.trim();
  } finally {
    s.close();
  }
}

const answer = (port: number) => sh(`curl -s --max-time 3 http://127.0.0.1:${port}/`);
const dep = (id: string) =>
  ctx.db.select().from(schema.deployments).where(eq(schema.deployments.id, id)).get() as Promise<typeof schema.deployments.$inferSelect>;
const logText = async (id: string) => (await deploymentLogs(userId, id)).map((l) => l.message).join("\n");

async function makeProject(name: string, extra: Record<string, unknown> = {}): Promise<ProjectRow> {
  return createProject(userId, {
    serverId: server.id,
    name,
    repoUrl: "https://github.com/example/demo",
    runtime: "node",
    startCommand: "node server.js",
    port: await freePort(),
    healthPath: "/",
    ...extra,
  });
}

async function deploy(project: ProjectRow, branch = project.productionBranch) {
  const d = await deployBranch(userId, project.id, branch);
  await runDeployJob(d.id, deps);
  return dep(d.id);
}

beforeAll(async () => {
  ctx = await useFreshDb();
  userId = (await upsertUser({ id: "u1", name: "Sam", email: null, slackId: null })).id;

  server = await createServer(userId, "sam-r", { host: "127.0.0.1", port: 1 });
  mock = await startMockSsh({ authorizedKeys: [server.publicKey] });
  installFakeSystemd(mock);
  installFakeContainerBuild(mock);
  await ctx.db.update(schema.servers).set({ port: mock.port, hostKeyFingerprint: mock.hostKeyFingerprint }).where(eq(schema.servers.id, server.id));
  server = await getServerForUser(userId, server.id);
  home = mock.home.replace(/\\/g, "/");

  deps = {
    sourceBuild: (() => {
      const pack = fakeBuilder(() => files);
      // A source build is the fixture's files as they are in the repository: it never installs or builds.
      return async (req) => {
        sourceBuilds++;
        return pack(req);
      };
    })(),
    preflight: () => async () => facts,
    connect: connectToServer,
    unitDir: `${home}/units`,
    healthTimeoutSeconds: 8,
    lockPollMs: 50,
  };
});

afterAll(async () => {
  for (const unit of await sh("ls $HOME/units 2>/dev/null || true").then((t) => t.split(/\s+/).filter(Boolean))) {
    await sh(`systemctl stop ${unit}`).catch(() => {});
  }
  await mock.stop();
  await ctx.cleanup();
});

const LOOP_TIMEOUT = 120_000;

describe.skipIf(!linuxTestHostAvailable())("a container project", () => {
  let app: ProjectRow;
  let v1: typeof schema.deployments.$inferSelect;

  it("is a container project by default, on a server that starts at 512 MB of build memory", async () => {
    app = await makeProject("Box App", { buildCommand: "echo built > build-output.txt" });
    expect(app.buildLocation).toBe("container");
    expect(server.buildMemoryMb).toBe(512);
  });

  it("builds on the container into the release folder, then switches", async () => {
    files = nodeApp("v1");
    await sh("rm -f $HOME/.systemd-run.log");
    v1 = await deploy(app);
    expect(v1.state, v1.error ?? "").toBe("ready");
    expect(v1.isCurrent).toBe(true);
    expect(sourceBuilds).toBe(1);
    expect(await answer(app.port)).toBe("v1:none");

    // The build output is inside this deployment's release folder.
    expect(await sh(`cat ${home}/.egg/box-app/releases/${v1.releaseId}/build-output.txt`)).toBe("built");
    // It ran under the cap that the server's setting and the container's memory allow.
    const run = await sh("cat $HOME/.systemd-run.log");
    const cap = Number(/MemoryMax=(\d+)M/.exec(run)?.[1]);
    expect(cap).toBeGreaterThanOrEqual(256);
    expect(cap).toBeLessThanOrEqual(1024);
    expect(run).toContain(`--unit=egg-build-${v1.releaseId.slice(0, 8)}`);
    expect(run).toContain("--property=CPUWeight=20");
    expect(run).toContain("--property=MemorySwapMax=0");

    const text = await logText(v1.id);
    expect(text).toContain("Building on your container");
    expect(text.indexOf("Building on your container")).toBeLessThan(text.indexOf("Live on port"));
    // Nothing was left behind to be uploaded or sourced.
    expect(await sh(`ls ${home}/.egg/box-app/incoming`)).toBe("");
    // The app's service carries the lower out-of-memory score.
    expect(await sh(`cat ${home}/units/egg-box-app.service`)).toContain("OOMScoreAdjust=-500");
  }, LOOP_TIMEOUT);

  it("keeps the app and the link when the build fails, and removes its own folder", async () => {
    await updateProject(userId, app.id, { buildCommand: "echo broken >&2; exit 3" });
    const linkBefore = await sh(`readlink ${home}/.egg/box-app/current`);
    files = nodeApp("v2");
    const bad = await deploy(app);
    expect(bad.state).toBe("error");
    expect(bad.isCurrent).toBe(false);
    expect(bad.error).toBe("The build failed (exit 3). Your app is still running.");
    expect(await answer(app.port)).toBe("v1:none");
    expect(await sh(`readlink ${home}/.egg/box-app/current`)).toBe(linkBefore);
    expect(await sh(`ls ${home}/.egg/box-app/releases`)).toBe(v1.releaseId);
    expect(await sh(`ls ${home}/.egg/box-app/incoming`)).toBe("");
    const text = await logText(bad.id);
    expect(text).toContain("broken");
    expect(text).toContain("Removed the unfinished release folder");
    // The state never reached "deploying", because nothing was ever switched.
    expect(await dep(bad.id).then((d) => d.activationStartedAt)).toBeNull();
  }, LOOP_TIMEOUT);

  it("reports the cap when the kernel kills the build", async () => {
    await updateProject(userId, app.id, { buildCommand: "kill -9 $$" });
    const oom = await deploy(app);
    expect(oom.state).toBe("error");
    expect(oom.error).toMatch(/^The build needed more memory than the cap of \d+ MB\. Your app is still running\.$/);
    expect(await answer(app.port)).toBe("v1:none");
    expect(await sh(`ls ${home}/.egg/box-app/releases`)).toBe(v1.releaseId);
  }, LOOP_TIMEOUT);

  it("reports a build that ran out of time, and leaves the app alone", async () => {
    await updateProject(userId, app.id, { buildCommand: "exit 124" });
    const slow = await deploy(app);
    expect(slow.error).toBe("The build took longer than 15 minutes and was stopped. Your app is still running.");
    expect(await answer(app.port)).toBe("v1:none");
    expect(await sh(`ls ${home}/.egg/box-app/releases`)).toBe(v1.releaseId);
  }, LOOP_TIMEOUT);

  it("removes the release folder when the deployment is canceled during the build", async () => {
    await updateProject(userId, app.id, { buildCommand: "sleep 4" });
    const d = await deployBranch(userId, app.id, "main");
    const abort = new AbortController();
    const running = runDeployJob(d.id, deps, abort.signal);
    // Cancel once the build is under way.
    for (let i = 0; i < 100; i++) {
      if ((await logText(d.id)).includes("Building on your container")) break;
      await new Promise((r) => setTimeout(r, 200));
    }
    await cancelDeployment(userId, d.id);
    abort.abort();
    await running;
    const after = await dep(d.id);
    expect(after.state).toBe("canceled");
    expect(await sh(`ls ${home}/.egg/box-app/releases`)).toBe(v1.releaseId);
    expect(await sh(`ls ${home}/.egg/box-app/incoming`)).toBe("");
    expect(await answer(app.port)).toBe("v1:none");
    expect(await sh(`readlink ${home}/.egg/box-app/current`)).toContain(v1.releaseId);
  }, LOOP_TIMEOUT);

  it("deploys the next good build over the old one", async () => {
    await updateProject(userId, app.id, { buildCommand: "echo built-2 > build-output.txt" });
    files = nodeApp("v3");
    const v3 = await deploy(app);
    expect(v3.state, v3.error ?? "").toBe("ready");
    expect(await answer(app.port)).toBe("v3:none");
    expect(await sh(`cat ${home}/.egg/box-app/releases/${v3.releaseId}/build-output.txt`)).toBe("built-2");
  }, LOOP_TIMEOUT);
});

describe.skipIf(!linuxTestHostAvailable())("the disk watchdog", () => {
  let app: ProjectRow;
  let live: typeof schema.deployments.$inferSelect;
  const disk = (cmd: string) => sh(`mkdir -p $HOME/.fake-disk && ${cmd}`);
  const reset = () => sh("rm -rf $HOME/.fake-disk $HOME/disk-build-finished.log");
  const release = (id: string) => `${home}/.egg/disk-app/releases/${id}`;

  /** What the running app and its folders look like now. */
  async function snapshot() {
    return {
      answer: await answer(app.port),
      link: await sh(`readlink ${home}/.egg/disk-app/current`),
      releases: await sh(`ls ${home}/.egg/disk-app/releases`),
      incoming: await sh(`ls ${home}/.egg/disk-app/incoming`),
    };
  }

  it("does not stop a build that finishes normally", async () => {
    await reset();
    app = await makeProject("Disk App", { buildCommand: "sleep 3; echo built > build-output.txt" });
    files = nodeApp("disk-v1");
    live = await deploy(app);
    expect(live.state, live.error ?? "").toBe("ready");
    const text = await logText(live.id);
    expect(text).toContain("Watching disk use: the build is stopped if free space falls below 1024 MB or the build folder grows past 2048 MB.");
    expect(text).not.toContain("Disk watchdog");
    expect(await sh(`test -e ${release(live.releaseId)}/.egg-disk-stop && echo yes || echo no`)).toBe("no");
  }, LOOP_TIMEOUT);

  it("reads the real df and du output of the container and does not stop a healthy build", async () => {
    await disk("touch $HOME/.fake-disk/real");
    try {
      await updateProject(userId, app.id, { buildCommand: "sleep 3; echo built > build-output.txt" });
      files = nodeApp("disk-v1");
      const d = await deploy(app);
      expect(d.state, d.error ?? "").toBe("ready");
      expect(await logText(d.id)).not.toContain("Disk watchdog");
      live = d;
    } finally {
      await reset();
    }
  }, LOOP_TIMEOUT);

  it("stops the build when free space falls below the floor, removes the release, and leaves the running app alone", async () => {
    // The space runs out during the build, after the source was unpacked: that is the watchdog's case.
    // Too little space before unpacking is refused earlier, by the extraction step.
    await updateProject(userId, app.id, {
      buildCommand: 'mkdir -p "$HOME/.fake-disk" && echo 300 > "$HOME/.fake-disk/free-mb"; sleep 8; echo finished >> "$HOME/disk-build-finished.log"',
    });
    files = nodeApp("disk-v2");
    const before = await snapshot();
    expect(before.answer).toBe("disk-v1:none");
    const t0 = Date.now();
    try {
      const bad = await deploy(app);
      expect(bad.state).toBe("error");
      expect(bad.isCurrent).toBe(false);
      expect(bad.error).toBe(
        "The build stopped because the container's free disk space fell below 1024 MB. Your app is still running. Free up disk space on your container, then deploy again."
      );
      // The build was stopped, not left to finish: its last command never ran.
      expect(Date.now() - t0).toBeLessThan(60_000);
      expect(await sh("test -e $HOME/disk-build-finished.log && echo yes || echo no")).toBe("no");
      const text = await logText(bad.id);
      expect(text).toContain("Disk watchdog: the floor limit was crossed (free=300MB limit=1024MB). Stopping the build.");
      expect(text).toContain("Removed the unfinished release folder");
      expect(await dep(bad.id).then((x) => x.activationStartedAt)).toBeNull();
      expect(await snapshot()).toEqual(before);
    } finally {
      await reset();
    }
  }, LOOP_TIMEOUT);

  it("stops the build when its folder grows past the budget", async () => {
    await updateProject(userId, app.id, { buildCommand: 'sleep 8; echo finished >> "$HOME/disk-build-finished.log"' });
    const before = await snapshot();
    await disk("echo 3000 > $HOME/.fake-disk/used-mb");
    try {
      const bad = await deploy(app);
      expect(bad.state).toBe("error");
      expect(bad.error).toBe("The build used more than 2048 MB of disk space and was stopped. Your app is still running.");
      expect(await sh("test -e $HOME/disk-build-finished.log && echo yes || echo no")).toBe("no");
      expect(await logText(bad.id)).toContain("Disk watchdog: the budget limit was crossed (used=3000MB limit=2048MB)");
      expect(await snapshot()).toEqual(before);
    } finally {
      await reset();
    }
  }, LOOP_TIMEOUT);

  it("gives a warning, and does not stop the build, when df cannot be read", async () => {
    try {
      // df stops working during the build; before unpacking, an unreadable df is refused instead.
      await updateProject(userId, app.id, {
        buildCommand: 'mkdir -p "$HOME/.fake-disk" && touch "$HOME/.fake-disk/df-missing"; sleep 5; echo built > build-output.txt',
      });
      files = nodeApp("disk-v3");
      const d = await deploy(app);
      expect(d.state, d.error ?? "").toBe("ready");
      const warned = (await deploymentLogs(userId, d.id)).filter((l) => l.message.includes("could not read the free disk space with df"));
      expect(warned).toHaveLength(1); // once, not at every check
      expect(await answer(app.port)).toBe("disk-v3:none");
    } finally {
      await reset();
    }
  }, LOOP_TIMEOUT);

  it("writes a private marker and maps it to the exit code, whichever limit was crossed", async () => {
    await disk("echo 300 > $HOME/.fake-disk/free-mb");
    try {
      const script =
        `dir="$HOME/wd-probe/releases/r1"; mkdir -p "$dir"; code=0\n` +
        diskWatchdogStartScript({ scope: "egg-build-0a1b2c3d" }) +
        `sleep 1\nstat -c %a "$egg_wd_marker"\ncat "$egg_wd_marker"\n` +
        diskWatchdogEndScript() +
        `echo "code=$code disk=$disk"\n`;
      const out = await sh(`bash -c ${shellQuote(script)} 2>/dev/null`);
      expect(out.split("\n")).toEqual(["600", "floor free=300MB limit=1024MB", "code=43 disk=floor"]);
      await disk("rm -f $HOME/.fake-disk/free-mb; echo 5000 > $HOME/.fake-disk/used-mb; rm -rf $HOME/wd-probe");
      const out2 = await sh(`bash -c ${shellQuote(script)} 2>/dev/null`);
      expect(out2.split("\n")).toEqual(["600", "budget used=5000MB limit=2048MB", "code=44 disk=budget"]);
    } finally {
      await sh("rm -rf $HOME/wd-probe").catch(() => {});
      await reset();
    }
  }, LOOP_TIMEOUT);
});

describe("a container project that cannot build here", () => {
  it("stops before anything is uploaded or created, with one fix line", async () => {
    const fresh = await makeProject("Nothing Yet", { buildCommand: "echo hi" });
    facts = { ...containerReadyFacts, hasSystemdRun: false };
    try {
      const d = await deploy(fresh);
      expect(d.state).toBe("error");
      expect(d.error).toMatch(/^Builds on your container run under a memory cap with systemd-run, which is not installed here/);
      // The project folder was never created: not even the empty release area.
      expect(await sh(`test -e ${home}/.egg/nothing-yet && echo yes || echo no`)).toBe("no");
      expect(await sh(`test -e ${home}/units/egg-nothing-yet.service && echo yes || echo no`)).toBe("no");
    } finally {
      facts = containerReadyFacts;
    }
  }, LOOP_TIMEOUT);

  it("says what to install for a missing Python venv", async () => {
    const py = await makeProject("Py App", { runtime: "python", startCommand: "python3 app.py" });
    files = { "app.py": "print('hi')\n", "requirements.txt": "\n" };
    facts = { ...containerReadyFacts, pythonVenv: false };
    try {
      const d = await deploy(py);
      expect(d.error).toBe("Install python3-venv on your container: sudo apt install python3-venv");
    } finally {
      facts = containerReadyFacts;
    }
  }, LOOP_TIMEOUT);
});

describe.skipIf(!linuxTestHostAvailable())("two builds on one container", () => {
  it("run one after the other, preview or production, never together", async () => {
    const a = await makeProject("Lock A", { buildCommand: 'echo "start-a" >> "$HOME/order.log"; sleep 1; echo "end-a" >> "$HOME/order.log"' });
    const b = await makeProject("Lock B", { buildCommand: 'echo "start-b" >> "$HOME/order.log"; sleep 1; echo "end-b" >> "$HOME/order.log"' });
    files = nodeApp("lock");
    await sh("rm -f $HOME/order.log");
    // B is a preview: it takes the same path and the same lock.
    const da = await deployBranch(userId, a.id, "main");
    const db = await deployBranch(userId, b.id, "feature/x");
    expect(db.env).toBe("preview");
    // Test files run side by side on one machine and preview ports start at the same number in each database.
    await ctx.db.update(schema.deployments).set({ port: await freePort() }).where(eq(schema.deployments.id, db.id));
    await Promise.all([runDeployJob(da.id, deps), runDeployJob(db.id, deps)]);

    const order = (await sh("cat $HOME/order.log")).split("\n");
    expect(order).toHaveLength(4);
    // Whichever went first finished before the other started.
    expect(order[0].replace("start-", "")).toBe(order[1].replace("end-", ""));
    expect(order[2].replace("start-", "")).toBe(order[3].replace("end-", ""));
    expect(order[0].startsWith("start-")).toBe(true);
    expect(order[2].startsWith("start-")).toBe(true);

    const [ra, rb] = await Promise.all([dep(da.id), dep(db.id)]);
    expect(ra.state, ra.error ?? "").toBe("ready");
    expect(rb.state, rb.error ?? "").toBe("ready");
    expect(await answer(rb.port)).toBe("lock:none");
    const logs = (await logText(da.id)) + (await logText(db.id));
    expect(logs).toContain("Another build is running on this container");
    const holder = await ctx.db.select().from(schema.servers).where(eq(schema.servers.id, server.id)).get();
    expect(holder?.buildLockHolder).toBeNull();
  }, LOOP_TIMEOUT);
});
