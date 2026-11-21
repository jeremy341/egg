import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { upsertUser } from "@/server/auth/session";
import { createServer } from "@/server/servers";
import { createProject, updateProject, enqueueDeployment } from "@/server/projects";
import { eq } from "drizzle-orm";
import { schema } from "@/server/db";
import { runDeployJob } from "@/server/deploy/pipeline";
import { useFreshDb } from "@/server/test/db";
import * as connections from "./connections";

let ctx: Awaited<ReturnType<typeof useFreshDb>>; let owner: string; let server: string; let connection: string;
beforeAll(async () => {
  ctx = await useFreshDb(); owner = (await upsertUser({ id: "integration", name: "Test", email: null, slackId: null })).id;
  server = (await createServer(owner, "provider-test")).id;
  connection = (await connections.createConnection(owner, { provider: "codeberg", label: "Test", host: "https://codeberg.org", accessToken: "secret" }, { resolve: async () => ["93.184.216.34"], transport: async () => ({ status: 200, body: (async function* () { yield Buffer.from("[]"); })() }) })).id;
});
afterAll(async () => { vi.restoreAllMocks(); await ctx.cleanup(); });
describe("provider projects", () => {
  it("accepts canonical listener ports and keeps the old alias consistent", async () => {
    const web = await createProject(owner, { serverId: server, name: "listener-app", repoUrl: "https://github.com/a/b", runtime: "node", listenPort: 3100 });
    expect(web).toMatchObject({ port: 3100, listenPort: 3100 });
    const changed = await updateProject(owner, web.id, { listenPort: 3101 });
    expect(changed).toMatchObject({ port: 3101, listenPort: 3101 });
    await expect(updateProject(owner, web.id, { port: 3102, listenPort: 3103 })).rejects.toThrow();
    const worker = await createProject(owner, { serverId: server, name: "worker-app", repoUrl: "https://github.com/a/b", runtime: "node", workloadKind: "worker", listenPort: null });
    expect(worker).toMatchObject({ port: 0, listenPort: null });
    // A webhook worker may open a listen port and close it again; a web project cannot.
    expect(await updateProject(owner, worker.id, { listenPort: 3104 })).toMatchObject({ port: 3104, listenPort: 3104 });
    expect(await updateProject(owner, worker.id, { listenPort: null })).toMatchObject({ port: 0, listenPort: null });
    await expect(updateProject(owner, web.id, { listenPort: null })).rejects.toThrow();
  });
  it("binds project to its source and starts with automatic deployment off", async () => {
    vi.spyOn(connections, "providerClientForUser").mockImplementation(async (userId, id, kind) => {
      expect(userId).toBe(owner); expect(id).toBe(connection); expect(kind).toBe("codeberg");
      return { getRepository: async () => ({ id: 1, fullName: "a/b", cloneUrl: "https://codeberg.org/a/b.git", defaultBranch: "main", private: true, pushedAt: null }), branchCommit: async () => "a".repeat(40), downloadArchive: async () => {}, listRepositories: async () => ({ repositories: [], nextPage: null }), readTree: async () => ({ paths: [], truncated: false }), readFile: async () => "" };
    });
    const project = await createProject(owner, { serverId: server, name: "provider-app", repoUrl: "https://codeberg.org/a/b.git", repoFullName: "a/b", sourceProvider: "codeberg", providerConnectionId: connection, runtime: "node", port: 3000, autoDeploy: true });
    expect(project).toMatchObject({ sourceProvider: "codeberg", providerConnectionId: connection, autoDeploy: false });
    expect((await connections.listConnections(owner)).find((item) => item.id === connection)).toMatchObject({ projectCount: 1 });
    await expect(connections.deleteConnection(owner, connection)).rejects.toMatchObject({ status: 409 });
    await expect(updateProject(owner, project.id, { autoDeploy: true })).rejects.toThrow(/webhook/i);
    const deployment = await enqueueDeployment(project, { env: "production", source: "webhook", branch: "main", commitSha: "b".repeat(40) });
    let connected = false;
    await runDeployJob(deployment.id, { connect: async () => { connected = true; throw new Error("unexpected connection"); }, unitDir: "/tmp", healthTimeoutSeconds: 1 });
    const row = await ctx.db.select().from(schema.deployments).where(eq(schema.deployments.id, deployment.id)).get();
    expect(row?.state).toBe("error");
    expect(row?.error).toMatch(/branch head/);
    expect(connected).toBe(false);
    await ctx.db.update(schema.projects).set({ autoDeploy: true, providerWebhookSecretEnc: "sealed" }).where(eq(schema.projects.id, project.id));
    expect(await connections.deleteConnection(owner, connection, true)).toEqual({ disconnected: true, detachedProjects: 1 });
    const detached = await ctx.db.select().from(schema.projects).where(eq(schema.projects.id, project.id)).get();
    expect(detached).toMatchObject({ providerConnectionId: null, autoDeploy: false, providerWebhookSecretEnc: null });
    expect(await ctx.db.select().from(schema.providerConnections).where(eq(schema.providerConnections.id, connection)).get()).toBeUndefined();
    const entry = await ctx.db.select().from(schema.auditLog).where(eq(schema.auditLog.action, "provider.disconnect")).get();
    expect(entry?.meta).toContain('"detachedProjects":1');
  });
});







