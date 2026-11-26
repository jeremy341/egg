import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { upsertUser } from "@/server/auth/session";
import { resetConfigForTests } from "@/server/config";
import { open } from "@/server/crypto";
import { getDb, schema } from "@/server/db";
import { unitName } from "@/server/deploy/layout";
import { runDeployJob, type PipelineDeps } from "@/server/deploy/pipeline";
import { deleteProject } from "@/server/project-delete";
import { claimNextJob } from "@/server/jobs";
import { createProject, deployBranch, type ProjectRow } from "@/server/projects";
import { connectToServer, createServer, getServerForUser, type ServerRow } from "@/server/servers";
import { NestSession } from "@/server/ssh/connection";
import { containerReadyFacts, fakeBuilder, freePort, installFakeContainerBuild, installFakeSystemd, nodeApp } from "@/server/test/fake-nest";
import { useFreshDb } from "@/server/test/db";
import { startMockSsh, type MockSsh } from "@/server/test/mock-ssh";

describe("deleting a project with a remote step on a mock Nest", () => {
  let ctx: Awaited<ReturnType<typeof useFreshDb>>;
  let mock: MockSsh;
  let userId: string;
  let server: ServerRow;
  let deps: PipelineDeps;
  let unitDir: string;
  let home: string;

  async function sh(command: string) {
    const s = await NestSession.connect({
      host: "127.0.0.1",
      port: mock.port,
      username: "sam-r",
      privateKey: open(server.privateKeyEnc, `server:${server.id}`),
    });
    try {
      return (await s.exec(command)).stdout.trim();
    } finally {
      s.close();
    }
  }

  const unitFiles = async () => (await sh(`ls ${unitDir} | grep -v '^.keep$' || true`)).split(/\s+/).filter(Boolean);
  const exists = async (path: string) => (await sh(`test -e ${path} && echo yes || echo no`)) === "yes";

  async function newProject(name: string): Promise<ProjectRow> {
    const base = { serverId: server.id, repoUrl: "https://github.com/example/demo", runtime: "node" as const };
    return createProject(userId, { ...base, name, startCommand: "node server.js", port: await freePort() });
  }

  async function projectRow(id: string) {
    const db = await getDb();
    return db.select().from(schema.projects).where(eq(schema.projects.id, id)).get();
  }

  async function cleanupRows(projectId: string) {
    const db = await getDb();
    return db.select().from(schema.cleanupJobs).where(eq(schema.cleanupJobs.projectId, projectId));
  }

  /** Leftover queued work would be claimable by later tests, so each test drops its project. */
  async function dropProject(id: string) {
    const db = await getDb();
    await db.delete(schema.projects).where(eq(schema.projects.id, id));
  }

  beforeAll(async () => {
    ctx = await useFreshDb();
    userId = (await upsertUser({ id: "u-delete", name: "Sam", email: null, slackId: null })).id;
    server = await createServer(userId, "sam-r", { host: "127.0.0.1", port: 1 });
    mock = await startMockSsh({ authorizedKeys: [server.publicKey] });
    installFakeSystemd(mock);
    installFakeContainerBuild(mock);
    unitDir = `${mock.home.replace(/\\/g, "/")}/units`;
    process.env.UNIT_DIR = unitDir;
    resetConfigForTests();
    const db = await getDb();
    await db.update(schema.servers).set({ port: mock.port, hostKeyFingerprint: mock.hostKeyFingerprint }).where(eq(schema.servers.id, server.id));
    server = await getServerForUser(userId, server.id);
    home = await sh("echo $HOME");
    deps = {
      preflight: () => async () => containerReadyFacts,
      lockPollMs: 50,
      sourceBuild: fakeBuilder(() => nodeApp("v1")),
      connect: connectToServer,
      unitDir,
      healthTimeoutSeconds: 8,
    };
  });

  afterAll(async () => {
    delete process.env.UNIT_DIR;
    resetConfigForTests();
    for (const unit of await unitFiles()) await sh(`systemctl stop ${unit}`).catch(() => {});
    await mock.stop();
    await ctx.cleanup();
  });

  it("answers 409 for a queued deployment and never calls the remote step", async () => {
    const p = await newProject("Queued Delete");
    await runDeployJob((await deployBranch(userId, p.id)).id, deps);
    await deployBranch(userId, p.id);
    const removeRemote = vi.fn(async () => {});

    await expect(deleteProject(userId, p.id, { remote: true }, { removeRemote })).rejects.toMatchObject({ status: 409 });
    expect(removeRemote).not.toHaveBeenCalled();
    expect(await projectRow(p.id)).toBeDefined();
    expect(await unitFiles()).toContain(unitName(p.slug));
    expect(await cleanupRows(p.id)).toEqual([]);
    await dropProject(p.id);
  });

  it("answers 409 for a building deployment and never calls the remote step", async () => {
    const p = await newProject("Building Delete");
    await runDeployJob((await deployBranch(userId, p.id)).id, deps);
    const queued = await deployBranch(userId, p.id);
    const db = await getDb();
    await db.update(schema.deployments).set({ state: "building" }).where(eq(schema.deployments.id, queued.id));
    const removeRemote = vi.fn(async () => {});

    await expect(deleteProject(userId, p.id, { remote: true }, { removeRemote })).rejects.toMatchObject({ status: 409 });
    expect(removeRemote).not.toHaveBeenCalled();
    expect(await projectRow(p.id)).toBeDefined();
    expect(await unitFiles()).toContain(unitName(p.slug));
    expect(await cleanupRows(p.id)).toEqual([]);
    await dropProject(p.id);
  });

  it("holds new work while the remote step runs, then removes the project", async () => {
    const p = await newProject("Held Delete");
    let reached!: () => void;
    const atRemote = new Promise<void>((resolve) => { reached = resolve; });
    let letFinish!: () => void;
    const gate = new Promise<void>((resolve) => { letFinish = resolve; });
    const removeRemote = vi.fn(async () => {
      reached();
      await gate;
    });

    const pending = deleteProject(userId, p.id, { remote: true }, { removeRemote });
    await atRemote;

    await expect(deployBranch(userId, p.id)).rejects.toMatchObject({ status: 409, code: "cleanup_in_progress" });
    await expect(deleteProject(userId, p.id, { remote: true }, { removeRemote })).rejects.toMatchObject({ code: "cleanup_in_progress" });

    // A job row that appeared anyway (written before the reservation was visible) must not be claimed.
    const db = await getDb();
    await db.insert(schema.deployments).values({
      id: "dep-held-delete", projectId: p.id, env: "production", state: "queued", source: "manual",
      branch: "main", port: p.port, releaseId: "held-release", createdAt: new Date(),
    });
    await db.insert(schema.jobs).values({ id: "job-held-delete", type: "deploy", deploymentId: "dep-held-delete", state: "queued", createdAt: new Date() });
    expect(await claimNextJob("test-worker")).toBeNull();

    letFinish();
    await pending;
    expect(removeRemote).toHaveBeenCalledTimes(1);
    expect(await projectRow(p.id)).toBeUndefined();
  });

  it("removes the units and releases from the container, marks the reservation done, and drops the project", async () => {
    const p = await newProject("Real Delete");
    await runDeployJob((await deployBranch(userId, p.id)).id, deps);
    expect(await unitFiles()).toContain(unitName(p.slug));
    expect(await exists(`${home}/.egg/${p.slug}/releases`)).toBe(true);

    await deleteProject(userId, p.id, { remote: true });

    expect(await unitFiles()).not.toContain(unitName(p.slug));
    expect(await exists(`${home}/.egg/${p.slug}/releases`)).toBe(false);
    expect(await projectRow(p.id)).toBeUndefined();
    const [reservation] = await cleanupRows(p.id);
    expect(reservation).toMatchObject({ scope: "project", state: "done", step: "complete", leaseOwner: null, leaseUntil: null });
    expect(reservation.finishedAt).toBeInstanceOf(Date);
  });

  it("keeps the data folder unless asked to delete it", async () => {
    const p = await newProject("Data Delete");
    await runDeployJob((await deployBranch(userId, p.id)).id, deps);
    await deleteProject(userId, p.id, { remote: true, deleteData: true });
    expect(await unitFiles()).not.toContain(unitName(p.slug));
    expect(await exists(`${home}/.egg/${p.slug}`)).toBe(false);
  });

  it("releases the reservation and keeps the project when the remote step fails", async () => {
    const p = await newProject("Failing Delete");
    await runDeployJob((await deployBranch(userId, p.id)).id, deps);
    const removeRemote = vi.fn(async () => {
      throw new Error("container unreachable");
    });

    await expect(deleteProject(userId, p.id, { remote: true }, { removeRemote })).rejects.toThrow("container unreachable");
    expect(await projectRow(p.id)).toBeDefined();
    const blocking = (await cleanupRows(p.id)).filter((row) => ["draining", "running", "failed"].includes(row.state));
    expect(blocking).toEqual([]);
    expect(await unitFiles()).toContain(unitName(p.slug));

    // The project is usable again: a new deployment is accepted.
    await expect(deployBranch(userId, p.id)).resolves.toMatchObject({ state: "queued" });
    await dropProject(p.id);
  });

  it("does not delete the records when the reservation was taken over while the remote step ran", async () => {
    const p = await newProject("Taken Over");
    const db = await getDb();
    // What the cleanup retry flow does to an interrupted row: it clears the lease and queues it again.
    const removeRemote = vi.fn(async () => {
      await db.update(schema.cleanupJobs)
        .set({ state: "draining", step: "draining", leaseOwner: null, leaseUntil: null })
        .where(eq(schema.cleanupJobs.projectId, p.id));
    });

    await expect(deleteProject(userId, p.id, { remote: true }, { removeRemote })).rejects.toMatchObject({
      status: 409,
      code: "cleanup_in_progress",
    });
    // The records stay for the cleanup flow to finish, and its row is untouched.
    expect(await projectRow(p.id)).toBeDefined();
    expect(await cleanupRows(p.id)).toMatchObject([{ state: "draining", leaseOwner: null }]);
    await db.delete(schema.cleanupJobs).where(eq(schema.cleanupJobs.projectId, p.id));
    await dropProject(p.id);
  });

  it("with remote off, deletes the records and still refuses during a deployment", async () => {
    const removeRemote = vi.fn(async () => {});
    const busy = await newProject("Records Busy");
    await deployBranch(userId, busy.id);
    await expect(deleteProject(userId, busy.id, { remote: false }, { removeRemote })).rejects.toMatchObject({ status: 409 });
    expect(await projectRow(busy.id)).toBeDefined();
    await dropProject(busy.id);

    const idle = await newProject("Records Idle");
    await deleteProject(userId, idle.id, { remote: false }, { removeRemote });
    expect(await projectRow(idle.id)).toBeUndefined();
    expect(removeRemote).not.toHaveBeenCalled();
    const db = await getDb();
    const left = await db.select().from(schema.cleanupJobs).where(and(eq(schema.cleanupJobs.projectId, idle.id)));
    expect(left).toEqual([]);
  });
});
