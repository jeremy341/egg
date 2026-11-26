import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { upsertUser } from "@/server/auth/session";
import { schema } from "@/server/db";
import { isUniqueViolation } from "@/server/db/errors";
import { createProject, enqueueDeployment } from "@/server/projects";
import { createServer } from "@/server/servers";
import { useFreshDb } from "@/server/test/db";

let ctx: Awaited<ReturnType<typeof useFreshDb>>;
let project: Awaited<ReturnType<typeof createProject>>;

beforeAll(async () => {
  ctx = await useFreshDb();
  const user = await upsertUser({ id: "uq1", name: "Sam", email: null, slackId: null });
  const server = await createServer(user.id, "sam-uq");
  project = await createProject(user.id, {
    serverId: server.id,
    repoUrl: "https://github.com/sam/app.git",
    runtime: "node",
    name: "App",
    slug: "app",
    port: 3000,
  });
});
afterAll(async () => ctx.cleanup());

const webhook = (sha: string, branch = "main") =>
  enqueueDeployment(project, { env: "production", source: "webhook", branch, commitSha: sha });

describe("unique indexes that close the deploy dedupe races", () => {
  it("lets one webhook deployment per commit be active and refuses a racing second one", async () => {
    await webhook("a".repeat(40));
    const err: unknown = await webhook("a".repeat(40)).catch((e: unknown) => e);
    expect(isUniqueViolation(err)).toBe(true);
    // The refused insert left neither a deployment nor a job behind.
    const rows = await ctx.db.select().from(schema.deployments).where(eq(schema.deployments.commitSha, "a".repeat(40)));
    expect(rows).toHaveLength(1);
  });

  it("allows the same commit again once the earlier deployment has finished", async () => {
    const first = await webhook("b".repeat(40));
    await ctx.db.update(schema.deployments).set({ state: "ready" }).where(eq(schema.deployments.id, first.id));
    await expect(webhook("b".repeat(40))).resolves.toBeDefined();
  });

  it("does not stop a manual deploy of a commit that a webhook is already building", async () => {
    await webhook("c".repeat(40));
    await expect(
      enqueueDeployment(project, { env: "production", source: "manual", branch: "main", commitSha: "c".repeat(40) })
    ).resolves.toBeDefined();
  });

  it("allows the same commit on another branch", async () => {
    await webhook("d".repeat(40), "main");
    await expect(webhook("d".repeat(40), "feature/x")).resolves.toBeDefined();
  });

  it("allows only one active deploy-hook deployment per project", async () => {
    await enqueueDeployment(project, { env: "production", source: "hook", branch: "main" });
    const err: unknown = await enqueueDeployment(project, { env: "production", source: "hook", branch: "main" }).catch(
      (e: unknown) => e
    );
    expect(isUniqueViolation(err)).toBe(true);
  });

  it("allows only one live job per deployment", async () => {
    const dep = await webhook("e".repeat(40));
    const err: unknown = await ctx.db
      .insert(schema.jobs)
      .values({ id: "dup-job", type: "deploy", deploymentId: dep.id, state: "queued", createdAt: new Date() })
      .then(() => null, (e: unknown) => e);
    expect(isUniqueViolation(err)).toBe(true);
  });
});

describe("user_preferences", () => {
  it("fills the documented defaults for a new row", async () => {
    const user = await upsertUser({ id: "uq2", name: "Kim", email: null, slackId: null });
    await ctx.db.insert(schema.userPreferences).values({ userId: user.id, updatedAt: new Date() });
    const row = await ctx.db.select().from(schema.userPreferences).where(eq(schema.userPreferences.userId, user.id)).get();
    expect(row).toMatchObject({
      theme: "system",
      accent: "default",
      density: "comfortable",
      reducedMotion: "system",
      defaultBranch: null,
      displayName: null,
      avatar: "pixel-01",
    });
  });

  it("is removed with its user", async () => {
    const user = await upsertUser({ id: "uq3", name: "Lee", email: null, slackId: null });
    await ctx.db.insert(schema.userPreferences).values({ userId: user.id, updatedAt: new Date() });
    await ctx.db.delete(schema.users).where(eq(schema.users.id, user.id));
    const rows = await ctx.db.select().from(schema.userPreferences).where(eq(schema.userPreferences.userId, user.id));
    expect(rows).toHaveLength(0);
  });
});
