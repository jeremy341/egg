import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { upsertUser } from "@/server/auth/session";
import { apiGetChanges } from "@/server/api-v1-changes-feed";
import { schema } from "@/server/db";
import { createProject, deployBranch } from "@/server/projects";
import { restartService } from "@/server/runtime-info";
import { createServer } from "@/server/servers";
import { useFreshDb } from "@/server/test/db";

vi.mock("@/server/servers", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/servers")>();
  return {
    ...actual,
    withServerSession: vi.fn(async (_server: unknown, callback: (session: unknown) => unknown) =>
      callback({ script: vi.fn(async () => ({ code: 0, stdout: "ok", stderr: "" })) })),
  };
});

let ctx: Awaited<ReturnType<typeof useFreshDb>>;
let userId: string;
let projectId: string;
let deploymentId: string;

beforeAll(async () => {
  ctx = await useFreshDb();
  userId = (await upsertUser({ id: "restart-audit-user", name: "Sam", email: null, slackId: null })).id;
  const server = await createServer(userId, "restart-audit-server");
  projectId = (await createProject(userId, {
    serverId: server.id,
    repoUrl: "https://github.com/sam/restart-audit",
    runtime: "node",
    name: "Restarted App",
    slug: "restarted-app",
    port: 3000,
  })).id;
  deploymentId = (await deployBranch(userId, projectId)).id;
  await ctx.db.update(schema.deployments)
    .set({ state: "ready", isCurrent: true })
    .where(eq(schema.deployments.id, deploymentId));
  await ctx.db.delete(schema.auditLog);
});

afterAll(async () => {
  await ctx.cleanup();
});

describe("project restart audit", () => {
  it("includes the current deployment id in the project changes feed", async () => {
    await restartService(userId, projectId);
    const page = await apiGetChanges({ userId, tokenId: "restart-test-token", scopes: ["activity:read"] }, projectId, { limit: 50 });
    expect(page.items).toMatchObject([{ kind: "projects", deploymentId }]);
  });
});
