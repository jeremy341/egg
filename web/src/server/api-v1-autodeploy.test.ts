import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { Principal, Scope } from "@/server/api-tokens";
import { callEndpoint } from "@/server/api-v1";
import {
  apiDisableAutoDeploy,
  apiEnableAutoDeploy,
  apiGetAutoDeployStatus,
  AUTODEPLOY_ENDPOINTS,
} from "@/server/api-v1-autodeploy";
import { upsertUser } from "@/server/auth/session";
import { schema } from "@/server/db";
import { createProject } from "@/server/projects";
import { createServer } from "@/server/servers";
import { useFreshDb } from "@/server/test/db";

let ctx: Awaited<ReturnType<typeof useFreshDb>>;
let owner: { id: string };
let outsider: { id: string };
let projectId: string;
let theirProjectId: string;
let noSourceProjectId: string;

const endpoint = (id: string) => {
  const found = AUTODEPLOY_ENDPOINTS.find((e) => e.id === id);
  expect(found, `endpoint ${id} exists`).toBeDefined();
  if (!found) throw new Error(`Missing endpoint ${id}`);
  return found;
};
const principal = (userId: string, scopes: Scope[]): Principal => ({ userId, tokenId: "auto-token", scopes });
const call = (userId: string, scopes: Scope[], id: string, idValue = projectId) =>
  callEndpoint(principal(userId, scopes), endpoint(id), { projectId: idValue });
const stored = async (id: string) =>
  (await ctx.db.select().from(schema.projects).where(eq(schema.projects.id, id))).at(0);

beforeAll(async () => {
  ctx = await useFreshDb();
  owner = await upsertUser({ id: "auto-owner", name: "Owner", email: null, slackId: null });
  outsider = await upsertUser({ id: "auto-outsider", name: "Outsider", email: null, slackId: null });
  const server = (await createServer(owner.id, "auto-sam")).id;
  const theirServer = (await createServer(outsider.id, "auto-kim")).id;
  const base = { repoUrl: "https://github.com/sam/auto.git", repoFullName: "sam/auto", runtime: "node" as const };
  projectId = (await createProject(owner.id, {
    ...base,
    serverId: server,
    name: "Auto App",
    slug: "auto-app",
    port: 3940,
    productionBranch: "trunk",
    autoDeploy: false,
  })).id;
  theirProjectId = (await createProject(outsider.id, {
    ...base,
    repoFullName: "kim/auto",
    repoUrl: "https://github.com/kim/auto.git",
    serverId: theirServer,
    name: "Theirs",
    slug: "theirs-auto",
    port: 3941,
    autoDeploy: false,
  })).id;
  noSourceProjectId = (await createProject(owner.id, {
    ...base,
    serverId: server,
    name: "No Source",
    slug: "no-source",
    port: 3942,
    autoDeploy: false,
  })).id;
  // Non-GitHub projects need a configured webhook before auto-deploy can be turned on.
  await ctx.db.update(schema.projects).set({ sourceProvider: "gitlab" }).where(eq(schema.projects.id, noSourceProjectId));
});

afterAll(async () => {
  await ctx.cleanup();
});

describe("the auto-deploy endpoint descriptions", () => {
  it("offers one read and two writes under the Orchard tool names", () => {
    expect(AUTODEPLOY_ENDPOINTS.map((e) => e.id)).toEqual([
      "get_auto_deploy_status",
      "enable_auto_deploy",
      "disable_auto_deploy",
    ]);
    expect(endpoint("get_auto_deploy_status")).toMatchObject({
      method: "GET",
      path: "/projects/{projectId}/auto-deploy",
      scope: "projects:read",
      bucket: "read",
      readOnly: true,
    });
    expect(endpoint("enable_auto_deploy")).toMatchObject({
      method: "PUT",
      path: "/projects/{projectId}/auto-deploy",
      scope: "projects:write",
      bucket: "write",
      readOnly: false,
    });
    expect(endpoint("disable_auto_deploy")).toMatchObject({
      method: "DELETE",
      path: "/projects/{projectId}/auto-deploy",
      scope: "projects:write",
      bucket: "write",
      readOnly: false,
    });
  });

  it("takes only a project id and answers with the switch and its push source", () => {
    for (const ep of AUTODEPLOY_ENDPOINTS) {
      expect(ep.input.safeParse({ projectId: "P" }).success).toBe(true);
      expect(ep.input.safeParse({ projectId: "P", surprise: 1 }).success).toBe(false);
      expect(ep.response.safeParse({ projectId: "P", autoDeploy: false, repo: "sam/auto", branch: "trunk" }).success).toBe(true);
    }
  });
});

describe("get_auto_deploy_status", () => {
  it("reports the project's existing switch, repository and branch", async () => {
    await expect(call(owner.id, ["projects:read"], "get_auto_deploy_status")).resolves.toEqual({
      projectId,
      autoDeploy: false,
      repo: "sam/auto",
      branch: "trunk",
    });
  });

  it("needs projects:read and does not reveal another owner's project", async () => {
    await expect(call(owner.id, ["projects:write"], "get_auto_deploy_status")).rejects.toMatchObject({ status: 403 });
    await expect(call(owner.id, ["projects:read"], "get_auto_deploy_status", theirProjectId)).rejects.toMatchObject({ status: 404 });
  });
});

describe("enable_auto_deploy and disable_auto_deploy", () => {
  it("turns the switch on, records who did it, and is safe to repeat", async () => {
    await expect(call(owner.id, ["projects:write"], "enable_auto_deploy")).resolves.toEqual({
      projectId,
      autoDeploy: true,
    });
    expect((await stored(projectId))?.autoDeploy).toBe(true);
    const entries = await ctx.db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.action, "project.update"));
    expect(entries.at(-1)).toMatchObject({
      userId: owner.id,
      target: projectId,
      meta: JSON.stringify({ fields: "autoDeploy", via: "api", token: "auto-token" }),
    });
    await expect(call(owner.id, ["projects:write"], "enable_auto_deploy")).resolves.toMatchObject({ autoDeploy: true });
  });

  it("turns the switch back off without starting a deployment", async () => {
    await expect(call(owner.id, ["projects:write"], "disable_auto_deploy")).resolves.toEqual({
      projectId,
      autoDeploy: false,
    });
    expect((await stored(projectId))?.autoDeploy).toBe(false);
    await expect(call(owner.id, ["projects:write"], "disable_auto_deploy")).resolves.toMatchObject({ autoDeploy: false });
  });

  it("needs projects:write and returns 404 for another owner's project", async () => {
    for (const id of ["enable_auto_deploy", "disable_auto_deploy"]) {
      await expect(call(owner.id, ["projects:read"], id)).rejects.toMatchObject({ status: 403 });
      await expect(call(owner.id, ["projects:write"], id, theirProjectId)).rejects.toMatchObject({ status: 404 });
    }
    expect((await stored(theirProjectId))?.autoDeploy).toBe(false);
  });

  it("refuses to enable a project with no push source configured", async () => {
    await expect(call(owner.id, ["projects:write"], "enable_auto_deploy", noSourceProjectId)).rejects.toMatchObject({ status: 400 });
    expect((await stored(noSourceProjectId))?.autoDeploy).toBe(false);
  });

  it("checks the scope in the service functions too, not just in the transport", async () => {
    await expect(apiEnableAutoDeploy(principal(owner.id, []), projectId)).rejects.toMatchObject({ status: 403 });
    await expect(apiDisableAutoDeploy(principal(owner.id, []), projectId)).rejects.toMatchObject({ status: 403 });
    await expect(apiGetAutoDeployStatus(principal(owner.id, []), projectId)).rejects.toMatchObject({ status: 403 });
  });
});
