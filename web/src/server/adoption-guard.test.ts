import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { upsertUser } from "@/server/auth/session";
import { schema } from "@/server/db";
import { createProject } from "@/server/projects";
import { createServer, connectToServer, deleteServer } from "@/server/servers";
import { assertCleanupAllowsWork } from "@/server/cleanup-guards";
import { useFreshDb } from "@/server/test/db";
import { requestAccountCleanup } from "@/server/cleanup";

describe("adoption guard", () => {
  let ctx: Awaited<ReturnType<typeof useFreshDb>>;
  let user: string;
  let projectId: string;
  let server: Awaited<ReturnType<typeof createServer>>;
  beforeAll(async () => {
    ctx = await useFreshDb();
    user = (await upsertUser({ id: "adopt-guard", name: "A", email: null, slackId: null })).id;
    server = await createServer(user, "adopt-guard", { host: "127.0.0.1", port: 1 });
    const project = await createProject(user, { serverId: server.id, name: "Adopt Guard", repoUrl: "https://github.com/test/app", runtime: "node", port: 3000 });
    projectId = project.id;
    await ctx.db.update(schema.servers).set({ hostKeyFingerprint: "SHA256:" + "A".repeat(43) }).where(eq(schema.servers.id, server.id));
    server = { ...server, hostKeyFingerprint: "SHA256:" + "A".repeat(43) };
    await ctx.db.insert(schema.adoptionPlans).values({ id: "guard-plan", userId: user, projectId, payloadEnc: "sealed", state: "executing", createdAt: new Date(), expiresAt: new Date(Date.now() + 1000) });
  });
  afterAll(async () => { await ctx.cleanup(); });
  it("blocks project writes while a cutover is executing even after expiry", async () => {
    await expect(assertCleanupAllowsWork(ctx.db, user, projectId)).rejects.toMatchObject({ status: 409 });
  });
  it("blocks other SSH operations on the server before connecting", async () => {
    await expect(connectToServer(server)).rejects.toMatchObject({ status: 409 });
  });
  it("blocks account cleanup while an orphaned cutover guard remains", async () => {
    await expect(requestAccountCleanup(user, "A", "A")).rejects.toMatchObject({ status: 409 });
  });
  it("prevents server deletion from erasing an executing cutover guard", async () => {
    await expect(deleteServer(user, server.id, { deleteProjects: true })).rejects.toMatchObject({ status: 409 });
  });
});
