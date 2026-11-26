import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { open } from "@/server/crypto";
import { schema } from "@/server/db";
import {
  connectToServer,
  createServer,
  deleteServer,
  disconnectBody,
  getServerForUser,
  listServers,
  publicServer,
  rotateServerKey,
  testServer,
  validateNestUsername,
} from "@/server/servers";
import { upsertUser } from "@/server/auth/session";
import { createProject, deployBranch } from "@/server/projects";
import { serverViews } from "@/server/queries";
import { terminals } from "@/server/terminal";
import { startMockSsh, type MockSsh } from "@/server/test/mock-ssh";
import { useFreshDb } from "@/server/test/db";

let ctx: Awaited<ReturnType<typeof useFreshDb>>;
let userId: string;
let otherUserId: string;

beforeAll(async () => {
  ctx = await useFreshDb();
  userId = (await upsertUser({ id: "u1", name: "Sam", email: null, slackId: null })).id;
  otherUserId = (await upsertUser({ id: "u2", name: "Kim", email: null, slackId: null })).id;
});
afterAll(async () => {
  await ctx.cleanup();
});

describe("nest username validation", () => {
  it("accepts normal usernames and rejects shell-ish input", () => {
    expect(validateNestUsername(" sam-r ")).toBe("sam-r");
    for (const bad of ["", "a b", "a;rm", "-lead", "x".repeat(40), "$(id)", "a/b"]) {
      expect(() => validateNestUsername(bad)).toThrow();
    }
  });
});

describe("server lifecycle", () => {
  it("stores the private key sealed and returns only the public half", async () => {
    const row = await createServer(userId, "sam-r");
    expect(row.privateKeyEnc).not.toContain("OPENSSH");
    expect(open(row.privateKeyEnc, `server:${row.id}`)).toContain("BEGIN OPENSSH PRIVATE KEY");

    const view = publicServer(row);
    expect(JSON.stringify(view)).not.toContain("privateKey");
    expect(JSON.stringify(view)).not.toContain("OPENSSH PRIVATE");
    expect(view.publicKey).toMatch(/^ssh-ed25519 /);
    expect(view.status).toBe("pending");
    expect(row.host).toBe("hackclub.app");
  });

  it("will not unseal under another server's id", async () => {
    const row = await getServerForUser(userId, (await createServer(userId, "sam-b")).id);
    expect(() => open(row.privateKeyEnc, "server:other")).toThrow();
  });

  it("rejects duplicates and enforces ownership", async () => {
    await expect(createServer(userId, "SAM-R")).rejects.toMatchObject({ status: 409 });
    const row = (await ctx.db.select().from(schema.servers).where(eq(schema.servers.nestUsername, "sam-r")))[0];
    await expect(getServerForUser(otherUserId, row.id)).rejects.toMatchObject({ status: 404 });
  });

  it("caps servers per user", async () => {
    const limitUser = (await upsertUser({ id: "u3", name: "Max", email: null, slackId: null })).id;
    for (let i = 0; i < 5; i++) await createServer(limitUser, `acct-${i}`);
    await expect(createServer(limitUser, "acct-6")).rejects.toMatchObject({ status: 400 });
  });

  it("rotates the key and resets status", async () => {
    const row = await createServer(otherUserId, "kim-k");
    const rotated = await rotateServerKey(otherUserId, row.id);
    expect(rotated.publicKey).not.toBe(row.publicKey);
    expect(rotated.status).toBe("pending");
  });

  it("deletes a server", async () => {
    const row = await createServer(otherUserId, "kim-del");
    await deleteServer(otherUserId, row.id);
    await expect(getServerForUser(otherUserId, row.id)).rejects.toMatchObject({ status: 404 });
  });
});

describe("disconnecting a server", () => {
  let seq = 0;
  const newUser = async () =>
    (await upsertUser({ id: `dc-${++seq}`, name: `Dc ${seq}`, email: null, slackId: null })).id;

  async function serverWithProject(owner: string, nest: string, port: number) {
    const server = await createServer(owner, nest);
    const project = await createProject(owner, {
      serverId: server.id,
      name: `App ${nest}`,
      repoUrl: `https://github.com/example/${nest}`,
      runtime: "node",
      port,
    });
    const deployment = await deployBranch(owner, project.id);
    await ctx.db
      .insert(schema.deploymentLogs)
      .values({ deploymentId: deployment.id, at: new Date(), level: "info", message: "built" });
    return { server, project, deployment };
  }

  const rowsFor = async (projectId: string, deploymentId: string) => ({
    project: await ctx.db.select().from(schema.projects).where(eq(schema.projects.id, projectId)),
    deployment: await ctx.db.select().from(schema.deployments).where(eq(schema.deployments.id, deploymentId)),
    logs: await ctx.db.select().from(schema.deploymentLogs).where(eq(schema.deploymentLogs.deploymentId, deploymentId)),
  });

  it("keeps the projects, their deployments and their logs by default", async () => {
    const owner = await newUser();
    const { server, project, deployment } = await serverWithProject(owner, "keep-me", 3301);

    await deleteServer(owner, server.id);

    const rows = await rowsFor(project.id, deployment.id);
    expect(rows.project).toHaveLength(1);
    expect(rows.deployment).toHaveLength(1);
    expect(rows.logs).toHaveLength(1);
    // Egg's key is gone and the server is not listed as connected any more.
    expect((await listServers(owner)).map((s) => s.id)).not.toContain(server.id);
    const kept = await ctx.db.select().from(schema.servers).where(eq(schema.servers.id, server.id)).get();
    expect(kept?.status).toBe("disconnected");
    expect(kept?.publicKey).toBe("");
    expect(kept?.keyFingerprint).toBe("");
    expect(kept?.hostKeyFingerprint).toBeNull();
    expect(open(kept!.privateKeyEnc, `server:${server.id}`)).not.toContain("OPENSSH");
  });

  it("never opens an SSH session for a project whose server was disconnected", async () => {
    const owner = await newUser();
    const { server } = await serverWithProject(owner, "no-connect", 3302);
    await deleteServer(owner, server.id, { deleteProjects: false });
    const row = await ctx.db.select().from(schema.servers).where(eq(schema.servers.id, server.id)).get();
    await expect(connectToServer(row!)).rejects.toMatchObject({ status: 409 });
  });

  it("refuses a connection test on a disconnected server and leaves its state alone", async () => {
    const owner = await newUser();
    const { server } = await serverWithProject(owner, "no-test", 3314);
    await deleteServer(owner, server.id, { deleteProjects: false });

    await expect(testServer(owner, server.id)).rejects.toMatchObject({ status: 409, code: "disconnected" });
    await expect(
      testServer(owner, server.id, { confirmHostKey: "SHA256:" + "C".repeat(43) })
    ).rejects.toMatchObject({ status: 409, code: "disconnected" });
    // The failing test must not overwrite the disconnect state or re-list the server.
    const kept = await ctx.db.select().from(schema.servers).where(eq(schema.servers.id, server.id)).get();
    expect(kept?.status).toBe("disconnected");
    expect(kept?.lastError).toBeNull();
    expect((await listServers(owner)).map((s) => s.id)).not.toContain(server.id);
  });

  it("does not disconnect a server while an SSH operation is open", async () => {
    const owner = await newUser();
    const { server, project } = await serverWithProject(owner, "active-ssh", 3312);
    await ctx.db.insert(schema.cleanupOperations).values({
      id: "active-ssh-operation",
      userId: owner,
      serverId: server.id,
      openedAt: new Date(),
    });

    await expect(deleteServer(owner, server.id, { deleteProjects: true })).rejects.toMatchObject({ status: 409 });
    expect(await ctx.db.select().from(schema.servers).where(eq(schema.servers.id, server.id)).get()).toBeTruthy();
    expect(await ctx.db.select().from(schema.projects).where(eq(schema.projects.id, project.id)).get()).toBeTruthy();
  });

  it("leaves the terminals open when the disconnect is refused for an SSH operation", async () => {
    const owner = await newUser();
    const { server } = await serverWithProject(owner, "refused-closer", 3316);
    await ctx.db.insert(schema.cleanupOperations).values({
      id: "refused-closer-operation",
      userId: owner,
      serverId: server.id,
      openedAt: new Date(),
    });

    const close = vi.spyOn(terminals(), "closeAllForUser");
    try {
      await expect(deleteServer(owner, server.id, { deleteProjects: true })).rejects.toMatchObject({
        status: 409,
        code: "remote_operation_active",
      });
      expect(close).not.toHaveBeenCalled();
    } finally {
      close.mockRestore();
    }
  });

  it("rechecks live server status before reserving a session from a stale snapshot", async () => {
    const owner = await newUser();
    const { server } = await serverWithProject(owner, "stale-ssh", 3313);
    const mock = await startMockSsh({ authorizedKeys: [server.publicKey] });
    try {
      await ctx.db.update(schema.servers).set({
        host: "127.0.0.1",
        port: mock.port,
        hostKeyFingerprint: mock.hostKeyFingerprint,
      }).where(eq(schema.servers.id, server.id));
      const staleSnapshot = await getServerForUser(owner, server.id);
      await deleteServer(owner, server.id, { deleteProjects: false });

      const result = await connectToServer(staleSnapshot).then(
        (session) => { session.close(); return null; },
        (error: unknown) => error
      );
      expect(result).toMatchObject({ status: 409, code: "disconnected" });
      expect(mock.commands).toEqual([]);
    } finally {
      await mock.stop();
    }
  });

  it("refuses to delete the projects while a deployment is queued or running on the server", async () => {
    const owner = await newUser();
    const { server, project, deployment } = await serverWithProject(owner, "active-delete", 3321);
    await ctx.db.update(schema.deployments).set({ state: "queued" }).where(eq(schema.deployments.id, deployment.id));

    await expect(deleteServer(owner, server.id, { deleteProjects: true })).rejects.toMatchObject({
      status: 409,
      code: "deployment_active",
    });
    expect(await ctx.db.select().from(schema.servers).where(eq(schema.servers.id, server.id)).get()).toBeTruthy();
    expect(await ctx.db.select().from(schema.projects).where(eq(schema.projects.id, project.id)).get()).toBeTruthy();
  });

  it("refuses to delete the projects while a job still runs on the server", async () => {
    const owner = await newUser();
    const { server, project, deployment } = await serverWithProject(owner, "job-delete", 3322);
    await ctx.db.update(schema.deployments).set({ state: "error" }).where(eq(schema.deployments.id, deployment.id));
    await ctx.db.update(schema.jobs)
      .set({ state: "running", lockedBy: "crashed-worker", lockedAt: new Date() })
      .where(eq(schema.jobs.deploymentId, deployment.id));

    await expect(deleteServer(owner, server.id, { deleteProjects: true })).rejects.toMatchObject({
      status: 409,
      code: "job_active",
    });
    expect(await ctx.db.select().from(schema.projects).where(eq(schema.projects.id, project.id)).get()).toBeTruthy();
  });

  it("removes the projects, their deployments and their logs when asked", async () => {
    const owner = await newUser();
    const { server, project, deployment } = await serverWithProject(owner, "drop-me", 3303);
    await ctx.db.update(schema.deployments).set({ state: "ready" }).where(eq(schema.deployments.id, deployment.id));

    await deleteServer(owner, server.id, { deleteProjects: true });

    const rows = await rowsFor(project.id, deployment.id);
    expect(rows.project).toHaveLength(0);
    expect(rows.deployment).toHaveLength(0);
    expect(rows.logs).toHaveLength(0);
    await expect(getServerForUser(owner, server.id)).rejects.toMatchObject({ status: 404 });
  });

  it("only touches the projects on the server being disconnected", async () => {
    const owner = await newUser();
    const a = await serverWithProject(owner, "iso-a", 3304);
    const b = await serverWithProject(owner, "iso-b", 3305);
    await ctx.db.update(schema.deployments).set({ state: "ready" }).where(eq(schema.deployments.id, a.deployment.id));

    await deleteServer(owner, a.server.id, { deleteProjects: true });

    expect((await rowsFor(b.project.id, b.deployment.id)).project).toHaveLength(1);
  });

  it("counts the projects on each server for the confirmation", async () => {
    const owner = await newUser();
    const { server } = await serverWithProject(owner, "count-me", 3306);
    await createProject(owner, {
      serverId: server.id,
      name: "Second",
      repoUrl: "https://github.com/example/second",
      runtime: "node",
      port: 3307,
    });
    const views = await serverViews(owner);
    expect(views.find((v) => v.id === server.id)?.projectCount).toBe(2);
  });

  it("reuses the kept server when the same Nest account is connected again, so the projects return", async () => {
    const owner = await newUser();
    const { server, project } = await serverWithProject(owner, "come-back", 3308);
    await deleteServer(owner, server.id);

    const again = await createServer(owner, "come-back");

    expect(again.id).toBe(server.id);
    expect(again.status).toBe("pending");
    expect(again.publicKey).toMatch(/^ssh-ed25519 /);
    expect(open(again.privateKeyEnc, `server:${again.id}`)).toContain("BEGIN OPENSSH PRIVATE KEY");
    const projects = await ctx.db.select().from(schema.projects).where(eq(schema.projects.id, project.id));
    expect(projects[0].serverId).toBe(again.id);
  });

  it("does not count a kept server against the limit of five", async () => {
    const owner = await newUser();
    const kept = await createServer(owner, "kept-0");
    await createProject(owner, {
      serverId: kept.id,
      name: "Kept",
      repoUrl: "https://github.com/example/kept",
      runtime: "node",
      port: 3309,
    });
    await deleteServer(owner, kept.id);
    for (let i = 1; i <= 5; i++) await createServer(owner, `kept-${i}`);
    expect(await listServers(owner)).toHaveLength(5);
  });

  it("reads the delete-projects choice from the request, defaulting to keep", () => {
    expect(disconnectBody.parse({})).toEqual({ deleteProjects: false });
    expect(disconnectBody.parse({ deleteProjects: true })).toEqual({ deleteProjects: true });
    expect(() => disconnectBody.parse({ deleteProjects: "yes" })).toThrow();
  });
});

describe("testing a connection", () => {
  let mock: MockSsh;
  afterAll(async () => {
    await mock?.stop();
  });

  it("fails helpfully until the key is added, then asks to confirm the host key before it pins and probes", async () => {
    // The mock starts with no authorized keys: the user has not pasted ours yet.
    mock = await startMockSsh({ authorizedKeys: [] });
    const row = await createServer(userId, "sam-test", { host: "127.0.0.1", port: mock.port });

    const first = await testServer(userId, row.id);
    expect(first.ok).toBe(false);
    if (!first.ok) {
      expect(first.kind).toBe("auth");
      expect(first.error).toContain("SSH Keys page");
    }
    expect((await getServerForUser(userId, row.id)).status).toBe("error");

    // The user pastes the key into the Nest dashboard: restart with it authorised.
    await mock.stop();
    mock = await startMockSsh({ authorizedKeys: [row.publicKey] });
    await ctx.db.update(schema.servers).set({ port: mock.port }).where(eq(schema.servers.id, row.id));

    // First sight of the host: its fingerprint is shown, nothing is pinned, nothing is run.
    const second = await testServer(userId, row.id);
    expect(second).toMatchObject({ ok: false, kind: "host-key-unconfirmed", hostKey: mock.hostKeyFingerprint, error: "Confirm host key" });
    expect((await getServerForUser(userId, row.id)).hostKeyFingerprint).toBeNull();
    expect(mock.commands).toEqual([]);

    // The owner confirms the fingerprint they were shown.
    const third = await testServer(userId, row.id, { confirmHostKey: mock.hostKeyFingerprint });
    expect(third.ok).toBe(true);
    const saved = await getServerForUser(userId, row.id);
    expect(saved.status).toBe("connected");
    expect(saved.lastError).toBeNull();
    expect(saved.hostKeyFingerprint).toBe(mock.hostKeyFingerprint);
    expect(saved.probe).toContain("uid");
  });

  it("refuses every other kind of connection until the host key is confirmed, then pins exactly what was confirmed", async () => {
    const row = await createServer(userId, "sam-tofu", { host: "127.0.0.1", port: 1 });
    const first = await startMockSsh({ authorizedKeys: [row.publicKey] });
    await ctx.db.update(schema.servers).set({ port: first.port }).where(eq(schema.servers.id, row.id));
    expect((await getServerForUser(userId, row.id)).hostKeyFingerprint).toBeNull();

    // A deploy, a file change or a shell is not allowed to be the first connection.
    await expect(connectToServer(await getServerForUser(userId, row.id))).rejects.toMatchObject({
      status: 409,
      code: "host_key_unconfirmed",
    });
    expect(first.commands).toEqual([]);
    expect((await getServerForUser(userId, row.id)).hostKeyFingerprint).toBeNull();

    // Confirming a fingerprint other than the one the host presents is refused, and pins nothing.
    const wrong = "SHA256:" + "C".repeat(43);
    await expect(
      connectToServer(await getServerForUser(userId, row.id), { confirmHostKey: wrong })
    ).rejects.toMatchObject({ kind: "host-key" });
    expect((await getServerForUser(userId, row.id)).hostKeyFingerprint).toBeNull();

    (await connectToServer(await getServerForUser(userId, row.id), { confirmHostKey: first.hostKeyFingerprint })).close();
    const pinned = await getServerForUser(userId, row.id);
    expect(pinned.hostKeyFingerprint).toBe(first.hostKeyFingerprint);
    await first.stop();

    // Another machine answers on the same address.
    const impostor = await startMockSsh({ authorizedKeys: [row.publicKey] });
    await ctx.db.update(schema.servers).set({ port: impostor.port }).where(eq(schema.servers.id, row.id));
    await expect(connectToServer(await getServerForUser(userId, row.id))).rejects.toMatchObject({ kind: "host-key" });
    expect(impostor.commands).toEqual([]);
    await impostor.stop();
  });

  it("refuses to talk to a host whose key changed after pinning", async () => {
    const row = await createServer(userId, "sam-pin", { host: "127.0.0.1", port: 1 });
    const impostor = await startMockSsh({ authorizedKeys: [row.publicKey] });
    await ctx.db
      .update(schema.servers)
      .set({ port: impostor.port, hostKeyFingerprint: "SHA256:" + "B".repeat(43) })
      .where(eq(schema.servers.id, row.id));

    const result = await testServer(userId, row.id);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.kind).toBe("host-key");
    expect(impostor.commands).toEqual([]); // nothing was run on the impostor
    await impostor.stop();
  });
});
