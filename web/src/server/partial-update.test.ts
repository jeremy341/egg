import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { enableAnalytics } from "@/server/analytics";
import { upsertUser } from "@/server/auth/session";
import { schema } from "@/server/db";
import { addDomain, updateDomain } from "@/server/domains";
import { createProject, updateProject, updateProjectInput } from "@/server/projects";
import { createServer, getServerForUser } from "@/server/servers";
import { setBuildCpu, setBuildMemory } from "@/server/build-memory";
import { useFreshDb } from "@/server/test/db";

/**
 * Zod 4 fills a default into a key that is left out, even under .partial(). An update must write
 * only what the caller sent, or a rename resets the settings the owner chose.
 */
describe("partial updates change only what is sent", () => {
  let ctx: Awaited<ReturnType<typeof useFreshDb>>;
  let userId: string;
  let serverId: string;

  beforeAll(async () => {
    ctx = await useFreshDb();
    userId = (await upsertUser({ id: "u1", name: "Sam", email: null, slackId: null })).id;
    serverId = (await createServer(userId, "sam-r")).id;
  });
  afterAll(async () => {
    await ctx.cleanup();
  });

  const custom = {
    productionBranch: "trunk",
    rootDir: "web",
    healthPath: "/healthz",
    autoDeploy: false,
    buildLocation: "container" as const,
  };

  async function makeProject(name: string, port: number) {
    const p = await createProject(userId, {
      serverId,
      name,
      repoUrl: "https://github.com/example/demo",
      runtime: "node",
      port,
      ...custom,
    });
    await enableAnalytics(userId, p.id);
    return ctx.db.select().from(schema.projects).where(eq(schema.projects.id, p.id)).get().then((r) => r!);
  }

  it("the update schema has no defaults", () => {
    expect(updateProjectInput.parse({})).toEqual({});
    expect(updateProjectInput.parse({ name: "Only a name" })).toEqual({ name: "Only a name" });
  });

  it("a rename leaves every other setting as it was", async () => {
    const before = await makeProject("Rename me", 3201);
    expect(before).toMatchObject(custom);
    expect(before.analyticsKey).toBeTruthy();

    const after = await updateProject(userId, before.id, { name: "Renamed" });
    expect(after.name).toBe("Renamed");
    expect(after).toMatchObject({ ...custom, port: 3201 });
    expect(after.analyticsKey).toBe(before.analyticsKey);
  });

  it("each field changes when it is sent, and nothing else moves", async () => {
    const start = await makeProject("Change each", 3202);
    const cases: [string, Record<string, unknown>][] = [
      ["autoDeploy", { autoDeploy: true }],
      ["rootDir", { rootDir: "." }],
      ["healthPath", { healthPath: "/" }],
      ["productionBranch", { productionBranch: "main" }],
    ];
    let expected: Record<string, unknown> = { ...custom };
    for (const [key, patch] of cases) {
      const row = await updateProject(userId, start.id, patch);
      expected = { ...expected, ...patch };
      expect(row[key as keyof typeof row], key).toBe(patch[key]);
      expect(row, key).toMatchObject(expected);
      expect(row.analyticsKey).toBe(start.analyticsKey);
    }
  });
});

describe("other update helpers", () => {
  let ctx: Awaited<ReturnType<typeof useFreshDb>>;
  let userId: string;
  let serverId: string;

  beforeAll(async () => {
    ctx = await useFreshDb();
    userId = (await upsertUser({ id: "u1", name: "Sam", email: null, slackId: null })).id;
    serverId = (await createServer(userId, "sam-r")).id;
  });
  afterAll(async () => {
    await ctx.cleanup();
  });

  it("a domain update with only a port keeps the project", async () => {
    const p = await createProject(userId, {
      serverId,
      name: "App",
      repoUrl: "https://github.com/example/demo",
      runtime: "node",
      port: 3300,
    });
    const { domain } = await addDomain(userId, { serverId, domain: "keep.example.com", port: 3300, projectId: p.id });
    const moved = await updateDomain(userId, domain.id, { port: 3301 });
    expect(moved.domain).toMatchObject({ projectId: p.id, port: 3301 });
    // A project change without a port follows that project; a null project detaches but keeps the port.
    const detached = await updateDomain(userId, domain.id, { projectId: null });
    expect(detached.domain).toMatchObject({ projectId: null, port: 3301 });
  });

  it("the server setters change one setting and leave the other alone", async () => {
    const before = await getServerForUser(userId, serverId);
    expect(before.buildMemoryMb).toBe(512);
    await setBuildMemory(userId, serverId, 768);
    const afterMemory = await getServerForUser(userId, serverId);
    expect(afterMemory).toMatchObject({ buildMemoryMb: 768, buildCpuQuarters: before.buildCpuQuarters });
    await setBuildCpu(userId, serverId, 1);
    expect(await getServerForUser(userId, serverId)).toMatchObject({ buildMemoryMb: 768, buildCpuQuarters: 4 });
  });
});
