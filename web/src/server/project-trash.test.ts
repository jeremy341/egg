import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { upsertUser } from "@/server/auth/session";
import { getDb, schema } from "@/server/db";
import { createProject, getProjectForUser, listProjects, revealEnvVar, setEnvVar, updateProject } from "@/server/projects";
import { createRule, listRules } from "@/server/alert-rules";
import { listTrashedProjects, purgeExpiredTrash, restoreTrashedProject, trashProject, TRASH_KEEP_MS } from "@/server/project-trash";
import { createServer } from "@/server/servers";
import { useFreshDb } from "@/server/test/db";

// Session auth is replaced; the routes and the real database stay intact.
const auth = vi.hoisted(() => ({ user: "" as string }));
vi.mock("@/server/http", async (orig) => ({
  ...(await orig<typeof import("@/server/http")>()),
  authed: async () => ({ id: auth.user }),
}));

import { DELETE, PATCH } from "@/app/api/projects/[id]/route";
import { GET as listTrashRoute } from "@/app/api/projects/trash/route";
import { POST as restoreRoute } from "@/app/api/projects/trash/[trashId]/restore/route";

let ctx: Awaited<ReturnType<typeof useFreshDb>>;
let userId: string;
let serverId: string;
let port = 3700;

const base = {
  repoUrl: "https://github.com/example/demo",
  runtime: "node" as const,
  startCommand: "node server.js",
};

async function newProject(name: string) {
  return createProject(userId, { ...base, serverId, name, port: port++ });
}

beforeAll(async () => {
  ctx = await useFreshDb();
  userId = (await upsertUser({ id: "trash-owner", name: "Trash Owner", email: null, slackId: null })).id;
  serverId = (await createServer(userId, "trash-server")).id;
  auth.user = userId;
});

afterAll(async () => {
  await ctx.cleanup();
});

describe("deletion protection", () => {
  it("refuses to delete a protected app until the switch is turned off", async () => {
    const project = await newProject("guarded");
    const req = (body: unknown) =>
      new NextRequest(`http://localhost:3000/api/projects/${project.id}`, {
        method: "PATCH",
        body: JSON.stringify(body),
        headers: { "content-type": "application/json" },
      });
    const patch = await PATCH(req({ deletionProtected: true }), { params: Promise.resolve({ id: project.id }) });
    expect(patch.status).toBe(200);
    expect((await getProjectForUser(userId, project.id)).deletionProtected).toBe(true);

    const refused = await DELETE(
      new NextRequest(`http://localhost:3000/api/projects/${project.id}`, { method: "DELETE" }),
      { params: Promise.resolve({ id: project.id }) }
    );
    expect(refused.status).toBe(409);
    expect(((await refused.json()) as { error: { code: string } }).error.code).toBe("deletion_protected");
    // Still there, and still live.
    expect((await getProjectForUser(userId, project.id)).id).toBe(project.id);

    await updateProject(userId, project.id, { deletionProtected: false });
    await trashProject(userId, project.id);
    expect((await listProjects(userId)).map((p) => p.id)).not.toContain(project.id);
  });

  it("refuses the trash directly while protected, without moving anything", async () => {
    const project = await newProject("guarded-direct");
    await updateProject(userId, project.id, { deletionProtected: true });
    await expect(trashProject(userId, project.id)).rejects.toMatchObject({ status: 409 });
    expect((await listTrashedProjects(userId)).map((t) => t.projectId)).not.toContain(project.id);
  });
});

describe("project trash", () => {
  it("moves a deleted app to the trash and restores it with its data", async () => {
    const project = await newProject("keeper");
    await setEnvVar(userId, project.id, { key: "API_TOKEN", value: "s3cret", target: "all" });
    await createRule(userId, project.id, { metric: "cpu_percent", comparison: "above", threshold: 80, durationMinutes: 5 });

    await trashProject(userId, project.id);
    expect((await listProjects(userId)).map((p) => p.id)).not.toContain(project.id);
    const trashed = (await listTrashedProjects(userId)).find((t) => t.projectId === project.id);
    expect(trashed?.name).toBe("keeper");
    expect(trashed!.purgeAt.getTime() - trashed!.deletedAt.getTime()).toBe(TRASH_KEEP_MS);

    const restored = await restoreTrashedProject(userId, project.id);
    expect(restored.id).toBe(project.id);
    expect(restored.name).toBe("keeper");
    expect((await getProjectForUser(userId, project.id)).name).toBe("keeper");
    // The env var was sealed with the project's id, so it still reveals after the round trip.
    expect(await revealEnvVar(project.id, "API_TOKEN", "all")).toBe("s3cret");
    expect((await listRules(userId, project.id)).map((r) => r.threshold)).toEqual([80]);
    expect((await listTrashedProjects(userId)).map((t) => t.projectId)).not.toContain(project.id);
  });

  it("restores through the route, and the trash list shows the app", async () => {
    const project = await newProject("route-restore");
    await trashProject(userId, project.id);

    const list = await listTrashRoute(new NextRequest("http://localhost:3000/api/projects/trash"), {} as never);
    const listed = (await list.json()) as { projects: { projectId: string }[] };
    expect(listed.projects.map((p) => p.projectId)).toContain(project.id);

    const res = await restoreRoute(
      new NextRequest(`http://localhost:3000/api/projects/trash/${project.id}/restore`, { method: "POST" }),
      { params: Promise.resolve({ trashId: project.id }) }
    );
    expect(res.status).toBe(200);
    expect((await getProjectForUser(userId, project.id)).id).toBe(project.id);
  });

  it("refuses a restore when another app has taken the same name on the server", async () => {
    const original = await newProject("clash");
    await trashProject(userId, original.id);
    // The same slug is free again, so a new app may take it.
    await newProject("clash");
    await expect(restoreTrashedProject(userId, original.id)).rejects.toMatchObject({ status: 409 });
    expect((await listTrashedProjects(userId)).map((t) => t.projectId)).toContain(original.id);
  });

  it("does not let another user restore or see the trash", async () => {
    const project = await newProject("private-trash");
    await trashProject(userId, project.id);
    const otherId = (await upsertUser({ id: "trash-other", name: "Other", email: null, slackId: null })).id;
    expect(await listTrashedProjects(otherId)).toEqual([]);
    await expect(restoreTrashedProject(otherId, project.id)).rejects.toMatchObject({ status: 404 });
  });

  it("the cleanup job removes trash after 30 days and keeps newer trash", async () => {
    const old = await newProject("old-trash");
    const fresh = await newProject("fresh-trash");
    const longAgo = new Date(Date.now() - TRASH_KEEP_MS - 60_000);
    await trashProject(userId, old.id, longAgo);
    await trashProject(userId, fresh.id);

    const purged = await purgeExpiredTrash(new Date());
    expect(purged).toBe(1);
    const db = await getDb();
    expect(await db.select().from(schema.projectTrash).where(eq(schema.projectTrash.projectId, old.id)).get()).toBeUndefined();
    expect(await db.select().from(schema.projectTrash).where(eq(schema.projectTrash.projectId, fresh.id)).get()).toBeDefined();
    await expect(restoreTrashedProject(userId, old.id)).rejects.toMatchObject({ status: 404 });
  });
});
