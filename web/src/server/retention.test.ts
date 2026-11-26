import { afterAll, beforeAll, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { useFreshDb } from "@/server/test/db";
import { upsertUser } from "@/server/auth/session";
import { createServer } from "@/server/servers";
import { createProject, deployBranch } from "@/server/projects";
import { schema } from "@/server/db";
import { deploymentLogRetentionDays, pruneDeploymentLogs } from "@/server/retention";
let ctx: Awaited<ReturnType<typeof useFreshDb>>;
beforeAll(async () => { ctx = await useFreshDb(); });
afterAll(async () => ctx.cleanup());
it("expires old finished logs while preserving active work and recent output", async () => {
  const userId = (await upsertUser({ id: "logs-retention", name: "Owner", email: null, slackId: null })).id;
  const server = await createServer(userId, "logs-retention");
  const project = await createProject(userId, { serverId: server.id, name: "Logs", repoUrl: "https://github.com/sam/app.git", runtime: "node", port: 3000 });
  const finished = await deployBranch(userId, project.id);
  const active = await deployBranch(userId, project.id);
  await ctx.db.update(schema.deployments).set({ state: "ready" }).where(eq(schema.deployments.id, finished.id));
  const old = new Date(Date.now() - 91 * 86400_000);
  await ctx.db.insert(schema.deploymentLogs).values([
    { deploymentId: finished.id, at: old, level: "info", message: "expired" },
    { deploymentId: finished.id, at: new Date(), level: "info", message: "recent" },
    { deploymentId: active.id, at: old, level: "info", message: "active" },
  ]);
  expect(await pruneDeploymentLogs()).toBe(1);
  expect((await ctx.db.select().from(schema.deploymentLogs)).map((r) => r.message).sort()).toEqual(["active", "recent"]);
  expect(deploymentLogRetentionDays("0")).toBe(0);
  expect(deploymentLogRetentionDays("invalid")).toBe(90);
});
