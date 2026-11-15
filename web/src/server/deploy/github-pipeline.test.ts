import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { upsertUser } from "@/server/auth/session";
import { resetConfigForTests } from "@/server/config";
import { schema } from "@/server/db";
import { UPLOAD_POLL_MS, UPLOAD_WAIT_MS, WAIT_TIMEOUT_MESSAGE, acceptUpload, uploadsDir } from "@/server/builds/uploads";
import { runDeployJob, type PipelineDeps } from "@/server/deploy/pipeline";
import {
  cancelDeployment,
  createProject,
  deploymentLogs,
  enqueueDeployment,
  type ProjectRow,
} from "@/server/projects";
import { connectToServer, createServer, getServerForUser, type ServerRow } from "@/server/servers";
import { NestSession } from "@/server/ssh/connection";
import {
  containerReadyFacts,
  freePort,
  installFakeContainerBuild,
  installFakeSystemd,
  nodeApp,
} from "@/server/test/fake-nest";
import { useFreshDb } from "@/server/test/db";
import { startMockSsh, type MockSsh } from "@/server/test/mock-ssh";
import { rawTarGz, sha256Of, type RawEntry } from "@/server/test/raw-tar";

/**
 * A deploy of a project that builds in GitHub Actions, against the fake Nest. The workflow's upload is made
 * with the same function the upload route calls. What these tests show is the order of events and that no
 * clone, install or build step runs for the user's code on Egg's machine or in the container's capped build.
 */
let ctx: Awaited<ReturnType<typeof useFreshDb>>;
let mock: MockSsh;
let userId: string;
let server: ServerRow;
let deps: PipelineDeps;
let home = "";
let work = "";
let sourceBuilds = 0;

const COMMIT = "c".repeat(40);

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
    // If the container ran this, the file would exist in the release folder.
    buildCommand: "echo BUILT-ON-CONTAINER > built.txt",
    installCommand: "echo INSTALLED-ON-CONTAINER > installed.txt",
    port: await freePort(),
    healthPath: "/",
    buildLocation: "github",
    ...extra,
  });
}

const queue = (p: ProjectRow, commit: string | null = COMMIT) =>
  enqueueDeployment(p, { env: "production", source: commit ? "webhook" : "manual", branch: "main", commitSha: commit, triggeredBy: userId });

/** The release a workflow would send: the built app, and a package.json with a lockfile for the production install. */
function release(version: string, extra: RawEntry[] = []) {
  return rawTarGz([
    { name: "./", type: "5" },
    { name: "./server.js", content: nodeApp(version)["server.js"] },
    { name: "./package.json", content: JSON.stringify({ name: "demo", version: "1.0.0" }) },
    { name: "./package-lock.json", content: JSON.stringify({ name: "demo", version: "1.0.0", lockfileVersion: 3, packages: {} }) },
    ...extra,
  ]);
}

const send = (p: ProjectRow, bytes: Buffer, commit = COMMIT) =>
  acceptUpload({
    projectId: p.id,
    environment: "production",
    headers: { commit, sha256: sha256Of(bytes), branch: "main", run: "77" },
    body: new Response(new Uint8Array(bytes)).body,
    contentLength: bytes.length,
  });

async function until<T>(fn: () => Promise<T | null | false | undefined>, ms = 15_000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error("timed out waiting in the test");
    await new Promise((r) => setTimeout(r, 25));
  }
}

const waitingLogged = (id: string) => until(async () => /Waiting for GitHub/.test(await logText(id)));

beforeAll(async () => {
  work = mkdtempSync(path.join(tmpdir(), "egg-gh-work-"));
  process.env.DEPLOY_WORK_DIR = work;
  ctx = await useFreshDb();
  resetConfigForTests();
  userId = (await upsertUser({ id: "u1", name: "Sam", email: null, slackId: null })).id;

  server = await createServer(userId, "sam-r", { host: "127.0.0.1", port: 1 });
  mock = await startMockSsh({ authorizedKeys: [server.publicKey] });
  installFakeSystemd(mock);
  installFakeContainerBuild(mock);
  // The container's npm: it records what it was asked to do and does nothing else.
  mock.addShim("npm", 'echo "npm $*" >> "$HOME/.npm-calls.log"; exit 0');
  await ctx.db.update(schema.servers).set({ port: mock.port, hostKeyFingerprint: mock.hostKeyFingerprint }).where(eq(schema.servers.id, server.id));
  server = await getServerForUser(userId, server.id);
  home = mock.home.replace(/\\/g, "/");

  deps = {
    sourceBuild: async () => {
      sourceBuilds++;
      throw new Error("A GitHub project must never be cloned or built by Egg.");
    },
    preflight: () => async () => containerReadyFacts,
    connect: connectToServer,
    unitDir: `${home}/units`,
    healthTimeoutSeconds: 8,
    lockPollMs: 50,
    githubWait: { timeoutMs: 400, pollMs: 25 },
  };
});

afterAll(async () => {
  for (const unit of await sh("ls $HOME/units 2>/dev/null || true").then((t) => t.split(/\s+/).filter(Boolean))) {
    await sh(`systemctl stop ${unit}`).catch(() => {});
  }
  await mock.stop();
  await ctx.cleanup();
  delete process.env.DEPLOY_WORK_DIR;
  resetConfigForTests();
  rmSync(work, { recursive: true, force: true });
});

const LOOP_TIMEOUT = 120_000;

describe("the wait", () => {
  it("is 60 minutes, looked at every 10 seconds, and ends with the agreed message", () => {
    expect(UPLOAD_WAIT_MS).toBe(60 * 60_000);
    expect(UPLOAD_POLL_MS).toBe(10_000);
    expect(WAIT_TIMEOUT_MESSAGE).toBe("GitHub did not send the build in time. Check the workflow run, then deploy again.");
  });
});

describe("a project that builds on GitHub", () => {
  let app: ProjectRow;

  it("deploys a release that was uploaded before the worker looked, with no clone and no build", async () => {
    app = await makeProject("Gh App");
    expect(app.buildLocation).toBe("github");
    const d = await queue(app);
    await send(app, release("g1"));
    await sh("rm -f $HOME/.systemd-run.log $HOME/.npm-calls.log");
    const commandsBefore = mock.commands.length;

    await runDeployJob(d.id, deps);

    const done = await dep(d.id);
    expect(done.state, done.error ?? "").toBe("ready");
    expect(done.isCurrent).toBe(true);
    expect(done.commitSha).toBe(COMMIT);
    expect(done.archiveBytes).toBeGreaterThan(0);
    expect(await answer(app.port)).toBe("g1:none");

    // No clone or pack on Egg's machine, and none of the user's build or install commands on the container.
    expect(sourceBuilds).toBe(0);
    const ran = mock.commands.slice(commandsBefore).join("\n");
    expect(ran).not.toContain("BUILT-ON-CONTAINER");
    expect(ran).not.toContain("INSTALLED-ON-CONTAINER");
    expect(await sh(`ls ${home}/.egg/gh-app/releases/${done.releaseId}`)).not.toMatch(/built\.txt|installed\.txt/);

    // The production install still ran, under the cap, with the lockfile's command.
    expect(await sh("cat $HOME/.npm-calls.log")).toBe("npm ci --omit=dev");
    const capped = await sh("cat $HOME/.systemd-run.log");
    expect(capped).toMatch(/MemoryMax=\d+M/);
    expect(capped).toContain("--property=MemorySwapMax=0");

    const text = await logText(d.id);
    expect(text).toContain("passed the path checks");
    expect(text).toContain("Installing production dependencies: npm ci --omit=dev");
    expect(text).not.toContain("Building:");
    expect(text).toContain("Live on port");
    // The upload is gone once the deploy is over.
    expect(readdirSync(uploadsDir())).toEqual([]);
    expect(await sh(`ls ${home}/.egg/gh-app/incoming`)).toBe("");
  }, LOOP_TIMEOUT);

  it("waits for a release that arrives while it is running, then deploys it", async () => {
    const d = await queue(app, "d".repeat(40));
    const job = runDeployJob(d.id, { ...deps, githubWait: { timeoutMs: 30_000, pollMs: 25 } });
    await waitingLogged(d.id);
    expect((await dep(d.id)).state).toBe("building");

    await send(app, release("g2"), "d".repeat(40));
    await job;

    const done = await dep(d.id);
    expect(done.state, done.error ?? "").toBe("ready");
    expect(await answer(app.port)).toBe("g2:none");
    const text = await logText(d.id);
    expect(text.indexOf("Waiting for GitHub")).toBeLessThan(text.indexOf("attached to this deployment"));
    expect(text.indexOf("attached to this deployment")).toBeLessThan(text.indexOf("Live on port"));
    expect(sourceBuilds).toBe(0);
  }, LOOP_TIMEOUT);

  it("fails after the wait when nothing arrives, with the agreed message, and touches nothing on the container", async () => {
    const d = await queue(app, "e".repeat(40));
    const before = mock.commands.length;
    const started = Date.now();
    await runDeployJob(d.id, deps);
    const done = await dep(d.id);
    expect(done.state).toBe("error");
    expect(done.error).toBe("GitHub did not send the build in time. Check the workflow run, then deploy again.");
    expect(Date.now() - started).toBeGreaterThanOrEqual(350);
    // Not one command was sent: the release folder was never created and the running app was not touched.
    expect(mock.commands.length).toBe(before);
    expect(await sh(`ls ${home}/.egg/gh-app/releases`)).not.toContain(done.releaseId);
    expect(await sh(`ls ${home}/.egg/gh-app/releases | wc -l`)).toBe("2");
    expect(await answer(app.port)).toBe("g2:none");
    const text = await logText(d.id);
    expect(text).toContain("Timed out waiting for the build from GitHub");
  }, LOOP_TIMEOUT);

  it("stops waiting when the deployment is canceled", async () => {
    const d = await queue(app, "f".repeat(40));
    const abort = new AbortController();
    const before = mock.commands.length;
    const job = runDeployJob(d.id, { ...deps, githubWait: { timeoutMs: 60 * 60_000, pollMs: 25 } }, abort.signal);
    await waitingLogged(d.id);
    const started = Date.now();
    await cancelDeployment(userId, d.id);
    abort.abort();
    await job;
    expect(Date.now() - started).toBeLessThan(5_000);
    const done = await dep(d.id);
    expect(done.state).toBe("canceled");
    expect(mock.commands.length).toBe(before);
    expect(readdirSync(uploadsDir())).toEqual([]);
  }, LOOP_TIMEOUT);

  it("also stops when only the deployment's state says canceled", async () => {
    const d = await queue(app, "1".repeat(40));
    const job = runDeployJob(d.id, { ...deps, githubWait: { timeoutMs: 60 * 60_000, pollMs: 25 } });
    await waitingLogged(d.id);
    await cancelDeployment(userId, d.id);
    await job;
    expect((await dep(d.id)).state).toBe("canceled");
  }, LOOP_TIMEOUT);

  it("refuses a release with a path that escapes, before anything reaches the container", async () => {
    const d = await queue(app, "2".repeat(40));
    await send(app, release("bad", [{ name: "../../../../tmp/egg-escape", content: "x" }]), "2".repeat(40));
    const before = mock.commands.length;
    await runDeployJob(d.id, deps);
    const done = await dep(d.id);
    expect(done.state).toBe("error");
    expect(done.error).toMatch(/The build from GitHub was refused\..*climbs out of the release/);
    expect(mock.commands.length).toBe(before);
    expect(readdirSync(uploadsDir())).toEqual([]);
    expect(await answer(app.port)).toBe("g2:none");
  }, LOOP_TIMEOUT);

  it("checks the checksum again before it unpacks, so a file changed on disk is not deployed", async () => {
    const d = await queue(app, "3".repeat(40));
    await send(app, release("tampered"), "3".repeat(40));
    writeFileSync(path.join(uploadsDir(), `${d.id}.tar.gz`), release("evil"));
    const before = mock.commands.length;
    await runDeployJob(d.id, deps);
    const done = await dep(d.id);
    expect(done.state).toBe("error");
    expect(done.error).toMatch(/did not match its checksum when it was read again/);
    expect(mock.commands.length).toBe(before);
    expect(readdirSync(uploadsDir())).toEqual([]);
  }, LOOP_TIMEOUT);

  it("reverts to the running release when the new one is not healthy, as the container path does", async () => {
    const d = await queue(app, "4".repeat(40));
    await send(app, rawTarGz([{ name: "server.js", content: "process.exit(1);\n" }]), "4".repeat(40));
    await runDeployJob(d.id, deps);
    const done = await dep(d.id);
    expect(done.state).toBe("error");
    expect(done.error).toMatch(/did not become healthy/);
    expect(await answer(app.port)).toBe("g2:none");
    expect(existsSync(uploadsDir()) ? readdirSync(uploadsDir()) : []).toEqual([]);
  }, LOOP_TIMEOUT);

  it("does not look at a project that builds on the container: its deployments never wait", async () => {
    const boxed = await makeProject("Boxed App", { buildLocation: "container" });
    expect(boxed.buildLocation).toBe("container");
    const d = await queue(boxed, "5".repeat(40));
    await runDeployJob(d.id, deps);
    // The container path went to the source builder, which here refuses; it did not wait for GitHub.
    expect(sourceBuilds).toBe(1);
    expect(await logText(d.id)).not.toContain("Waiting for GitHub");
  }, LOOP_TIMEOUT);
});
