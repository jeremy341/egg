import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { deleteAccount } from "@/server/account";
import { upsertUser } from "@/server/auth/session";
import { requestAccountCleanup, requestProjectCleanup } from "@/server/cleanup";
import { schema } from "@/server/db";
import { createProject } from "@/server/projects";
import { createServer, deleteServer } from "@/server/servers";
import { terminals } from "@/server/terminal";
import { useFreshDb } from "@/server/test/db";

let ctx: Awaited<ReturnType<typeof useFreshDb>>;
beforeAll(async () => { ctx = await useFreshDb(); });
afterAll(async () => { vi.restoreAllMocks(); await ctx.cleanup(); });

describe("cleanup starting while legacy deletion closes terminals", () => {
  it("preserves account and cleanup records if cleanup starts before the destructive write", async () => {
    const user = await upsertUser({ id: "delete-race-account", name: "Race Owner", email: null, slackId: null });
    const close = vi.spyOn(terminals(), "closeAllForUser").mockImplementationOnce(async () => {
      await requestAccountCleanup(user.id, user.name, user.name);
      return 0;
    });
    try {
      await expect(deleteAccount(user.id, user.name, user.name)).rejects.toMatchObject({ status: 409 });
      expect(await ctx.db.select().from(schema.users).where(eq(schema.users.id, user.id)).get()).toBeTruthy();
      expect(await ctx.db.select().from(schema.cleanupJobs).where(eq(schema.cleanupJobs.userId, user.id))).toHaveLength(1);
    } finally { close.mockRestore(); }
  });

  for (const deleteProjects of [false, true]) {
    it(`preserves server credentials when cleanup races disconnect (deleteProjects=${deleteProjects})`, async () => {
      const user = await upsertUser({ id: `delete-race-${deleteProjects}`, name: "Race Owner", email: null, slackId: null });
      const server = await createServer(user.id, `delete-race-${deleteProjects}`);
      const project = await createProject(user.id, { serverId: server.id, name: "Race App", repoUrl: "https://github.com/a/b", runtime: "node", port: 3000 });
      const close = vi.spyOn(terminals(), "closeAllForUser").mockImplementationOnce(async () => {
        await requestProjectCleanup(user.id, project.id);
        return 0;
      });
      try {
        await expect(deleteServer(user.id, server.id, { deleteProjects })).rejects.toMatchObject({ status: 409 });
        const kept = await ctx.db.select().from(schema.servers).where(eq(schema.servers.id, server.id)).get();
        expect(kept?.privateKeyEnc).toBe(server.privateKeyEnc);
        expect(kept?.status).toBe(server.status);
        expect(await ctx.db.select().from(schema.projects).where(eq(schema.projects.id, project.id)).get()).toBeTruthy();
      } finally { close.mockRestore(); }
    });
  }
});
