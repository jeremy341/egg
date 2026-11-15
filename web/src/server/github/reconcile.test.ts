import { afterAll, beforeAll, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { upsertUser } from "@/server/auth/session";
import { createServer } from "@/server/servers";
import { createProject } from "@/server/projects";
import { useFreshDb } from "@/server/test/db";
import { inspectRepositoryDrift, reconcileRepository } from "@/server/github/reconcile";

let ctx: Awaited<ReturnType<typeof useFreshDb>>;
let userId: string;
let projectId: string;
const sha = "a".repeat(40);
const fetcher = async () => Response.json({ sha });
beforeAll(async () => {
  ctx = await useFreshDb();
  userId = (await upsertUser({ id: "reconcile-owner", name: "Owner", email: null, slackId: null })).id;
  const server = await createServer(userId, "reconcile-server");
  projectId = (await createProject(userId, { serverId: server.id, name: "App", repoUrl: "https://github.com/sam/app.git", repoFullName: "sam/app", runtime: "node", port: 3000 })).id;
});
afterAll(async () => ctx.cleanup());
it("detects a missed commit and queues it once with an immutable SHA", async () => {
  expect(await inspectRepositoryDrift(userId, projectId, fetcher)).toMatchObject({ headSha: sha, deployedSha: null, needsDeployment: true });
  const first = await reconcileRepository(userId, projectId, sha, fetcher);
  const again = await reconcileRepository(userId, projectId, sha, fetcher);
  expect(first.deploymentId).toBe(again.deploymentId);
  const { schema } = await import("@/server/db");
  const row = await ctx.db.select().from(schema.deployments).where(eq(schema.deployments.id, first.deploymentId!)).get();
  expect(row?.commitSha).toBe(sha);
});
it("refuses a changed branch head and foreign ownership before fetching", async () => {
  await expect(reconcileRepository(userId, projectId, "b".repeat(40), fetcher)).rejects.toMatchObject({ status: 409 });
  await expect(inspectRepositoryDrift("stranger", projectId, async () => { throw new Error("must not fetch"); })).rejects.toMatchObject({ status: 404 });
});
