import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { upsertUser } from "@/server/auth/session";
import { schema } from "@/server/db";
import { createProject, listProjects, revealEnvVar, setEnvVar } from "@/server/projects";
import { createServer } from "@/server/servers";
import { useFreshDb } from "@/server/test/db";

let ctx: Awaited<ReturnType<typeof useFreshDb>>;
let userId: string;
let projectId: string;
let sharedProjectId: string;

const base = {
  repoUrl: "https://github.com/example/demo",
  runtime: "node" as const,
  startCommand: "node server.js",
};

beforeAll(async () => {
  ctx = await useFreshDb();
  userId = (await upsertUser({ id: "env-owner", name: "Env Owner", email: null, slackId: null })).id;
  const otherId = (await upsertUser({ id: "env-other", name: "Env Other", email: null, slackId: null })).id;

  const serverId = (await createServer(userId, "env-owner-server")).id;
  projectId = (await createProject(userId, {
    ...base,
    serverId,
    name: "Env Demo",
    port: 3400,
  })).id;

  // A project owned by someone else that this user can only view.
  const otherServerId = (await createServer(otherId, "env-other-server")).id;
  sharedProjectId = (await createProject(otherId, {
    ...base,
    serverId: otherServerId,
    name: "Env Shared",
    port: 3401,
  })).id;
  await ctx.db.insert(schema.projectMembers).values({
    projectId: sharedProjectId,
    userId,
    role: "viewer",
    createdAt: new Date(),
  });
});

afterAll(async () => {
  await ctx.cleanup();
});

beforeEach(async () => {
  await ctx.db.delete(schema.envVars);
  await ctx.db.delete(schema.auditLog);
});

async function seed(count: number, from = 0) {
  const rows = Array.from({ length: count }, (_, i) => ({
    id: `seed-${from + i}`,
    projectId,
    key: `K${from + i}`,
    valueEnc: "sealed",
    target: "all" as const,
    createdAt: new Date(),
  }));
  await ctx.db.insert(schema.envVars).values(rows);
}

describe("setEnvVar", () => {
  it("collapses concurrent writes of the same key to one row (last write wins)", async () => {
    await Promise.all([
      setEnvVar(userId, projectId, { key: "SHARED", value: "first", target: "all" }),
      setEnvVar(userId, projectId, { key: "SHARED", value: "second", target: "all" }),
    ]);
    const rows = await ctx.db.select().from(schema.envVars).where(eq(schema.envVars.projectId, projectId));
    expect(rows).toHaveLength(1);
    expect(rows[0].key).toBe("SHARED");
    const value = await revealEnvVar(projectId, "SHARED", "all");
    expect(["first", "second"]).toContain(value);
  });

  it("refuses a new variable at 100 but still updates an existing one", async () => {
    await seed(100);
    await expect(
      setEnvVar(userId, projectId, { key: "TOO_MANY", value: "x", target: "all" })
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      setEnvVar(userId, projectId, { key: "K0", value: "updated", target: "all" })
    ).resolves.toBeUndefined();
    expect(await revealEnvVar(projectId, "K0", "all")).toBe("updated");
    expect((await ctx.db.select().from(schema.envVars).where(eq(schema.envVars.projectId, projectId))).length).toBe(100);
  });

  it("admits only one of two concurrent new keys at the cap", async () => {
    await seed(99);
    const results = await Promise.allSettled([
      setEnvVar(userId, projectId, { key: "RACE_A", value: "a", target: "all" }),
      setEnvVar(userId, projectId, { key: "RACE_B", value: "b", target: "all" }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const failed = results.filter((r) => r.status === "rejected") as PromiseRejectedResult[];
    expect(failed).toHaveLength(1);
    expect(failed[0].reason).toMatchObject({ status: 400 });
    expect((await ctx.db.select().from(schema.envVars).where(eq(schema.envVars.projectId, projectId))).length).toBe(100);
  });

  it("keeps reserved and malformed names rejected", async () => {
    for (const key of ["PATH", "HOME", "1BAD", "WITH SPACE", "WITH-DASH"]) {
      await expect(setEnvVar(userId, projectId, { key, value: "x", target: "all" })).rejects.toThrow();
    }
    expect(await ctx.db.select().from(schema.envVars)).toHaveLength(0);
  });
});

describe("listProjects", () => {
  it("includes projects the user can read, not only ones they own", async () => {
    const ids = (await listProjects(userId)).map((p) => p.id);
    expect(ids).toContain(projectId);
    expect(ids).toContain(sharedProjectId);
  });
});
