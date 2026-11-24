import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { upsertUser } from "@/server/auth/session";
import { getDb, schema } from "@/server/db";
import { createProject, updateProject } from "@/server/projects";
import { createServer } from "@/server/servers";
import { useFreshDb } from "@/server/test/db";

let ctx: Awaited<ReturnType<typeof useFreshDb>>;
let userId: string;
let serverId: string;

const base = {
  repoUrl: "https://github.com/example/strategy",
  runtime: "node" as const,
  startCommand: "node server.js",
};

beforeAll(async () => {
  ctx = await useFreshDb();
  userId = (await upsertUser({ id: "strategy-owner", name: "Owner", email: null, slackId: null })).id;
  serverId = (await createServer(userId, "strategy-server")).id;
});

afterAll(async () => {
  await ctx.cleanup();
});

async function setVolume(projectId: string, hasVolumes: boolean) {
  const db = await getDb();
  await db.update(schema.projects).set({ hasVolumes }).where(eq(schema.projects.id, projectId));
}

describe("deploy strategy stored per app", () => {
  it("defaults to rolling when none is given", async () => {
    const p = await createProject(userId, { ...base, serverId, name: "Default Strategy", port: 3701 });
    expect(p.deployStrategy).toBe("rolling");
  });

  it("stores the strategy chosen at create time", async () => {
    const p = await createProject(userId, { ...base, serverId, name: "Recreate App", port: 3702, deployStrategy: "recreate" });
    expect(p.deployStrategy).toBe("recreate");
  });

  it("stores a strategy change on update, and keeps it on a later unrelated update", async () => {
    const p = await createProject(userId, { ...base, serverId, name: "Blue Green App", port: 3703 });
    const changed = await updateProject(userId, p.id, { deployStrategy: "blue_green" });
    expect(changed.deployStrategy).toBe("blue_green");
    const renamed = await updateProject(userId, p.id, { name: "Blue Green Renamed" });
    expect(renamed.deployStrategy).toBe("blue_green");
  });

  it("refuses rolling and blue/green on an app with a volume, and accepts recreate", async () => {
    const p = await createProject(userId, { ...base, serverId, name: "Volume App", port: 3704, deploymentMode: "compose", composeFilePath: "compose.yaml", composeService: "web" });
    await setVolume(p.id, true);
    await expect(updateProject(userId, p.id, { deployStrategy: "rolling" })).rejects.toThrow(/recreate strategy/);
    await expect(updateProject(userId, p.id, { deployStrategy: "blue_green" })).rejects.toThrow(/recreate strategy/);
    const kept = await updateProject(userId, p.id, { deployStrategy: "recreate" });
    expect(kept.deployStrategy).toBe("recreate");
  });

  it("refuses to leave recreate for an app that has a volume, even when only the mode is sent", async () => {
    const p = await createProject(userId, { ...base, serverId, name: "Volume Keeps", port: 3705, deploymentMode: "compose", composeFilePath: "compose.yaml", composeService: "web", deployStrategy: "recreate" });
    await setVolume(p.id, true);
    await expect(updateProject(userId, p.id, { deployStrategy: "rolling" })).rejects.toThrow();
    const after = await updateProject(userId, p.id, { name: "Volume Keeps Renamed" });
    expect(after.deployStrategy).toBe("recreate");
  });
});
