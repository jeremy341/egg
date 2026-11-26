import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { Principal, Scope } from "@/server/api-tokens";
import { callEndpoint, endpointById } from "@/server/api-v1";
import { upsertUser } from "@/server/auth/session";
import { schema } from "@/server/db";
import { createProject, deployBranch } from "@/server/projects";
import { createServer } from "@/server/servers";
import { useFreshDb } from "@/server/test/db";

let ctx: Awaited<ReturnType<typeof useFreshDb>>;
let owner: { id: string };
let outsider: { id: string };
let projectId: string;
let deploymentId: string;
let outsiderDeploymentId: string;

const endpoint = (id: string) => {
  const found = endpointById(id);
  expect(found, `endpoint ${id} is registered`).toBeDefined();
  if (!found) throw new Error(`Missing endpoint ${id}`);
  return found;
};

const principal = (userId: string, scopes: Scope[]): Principal => ({ userId, tokenId: "test-token", scopes });

beforeAll(async () => {
  ctx = await useFreshDb();
  owner = await upsertUser({ id: "orchard-owner", name: "Owner", email: null, slackId: null });
  outsider = await upsertUser({ id: "orchard-outsider", name: "Outsider", email: null, slackId: null });
  const server = await createServer(owner.id, "orchard-owner");
  const otherServer = await createServer(outsider.id, "orchard-outsider");
  const project = await createProject(owner.id, {
    serverId: server.id,
    name: "Sparrow App",
    slug: "sparrow-app",
    repoUrl: "https://github.com/sam/sparrow.git",
    runtime: "node",
    port: 3030,
    autoDeploy: false,
    healthPath: "/health",
  });
  const otherProject = await createProject(outsider.id, {
    serverId: otherServer.id,
    name: "Hidden App",
    slug: "hidden-app",
    repoUrl: "https://github.com/outsider/hidden.git",
    runtime: "node",
    port: 3031,
  });
  projectId = project.id;
  deploymentId = (await deployBranch(owner.id, projectId)).id;
  outsiderDeploymentId = (await deployBranch(outsider.id, otherProject.id)).id;

  await ctx.db.insert(schema.githubInstallations).values({
    id: 9201,
    userId: owner.id,
    accountLogin: "sam",
    accountType: "User",
    createdAt: new Date("2026-01-02T03:04:05.000Z"),
  });
  await ctx.db.update(schema.projects).set({ repoFullName: "sam/sparrow", installationId: 9201 }).where(eq(schema.projects.id, projectId));
  await ctx.db.insert(schema.deploymentLogs).values({
    deploymentId,
    at: new Date("2026-01-02T03:04:06.000Z"),
    level: "error",
    message: "Build failed while installing dependencies",
  });
});

afterAll(async () => {
  await ctx.cleanup();
});

describe("Orchard core endpoint behavior", () => {
  it("requires the endpoint's read scope before accessing its data", async () => {
    const cases: [string, unknown][] = [
      ["find", { query: "sparrow" }],
      ["get_github_status", {}],
      ["diagnose_deployment", { deploymentId }],
      ["get_deployment_next_steps", { deploymentId }],
    ];

    for (const [id, input] of cases) {
      await expect(callEndpoint(principal(owner.id, []), endpoint(id), input), id).rejects.toMatchObject({ status: 403 });
    }
  });

  it("searches only the caller's projects by name, slug, and repository", async () => {
    const ep = endpoint("find");
    const result = await callEndpoint(principal(owner.id, ["projects:read"]), ep, { query: "sparrow" });
    expect(result).toMatchObject({
      query: "sparrow",
      results: [{ kind: "project", id: projectId, name: "Sparrow App", slug: "sparrow-app", repo: "sam/sparrow" }],
    });
    await expect(callEndpoint(principal(owner.id, ["projects:read"]), ep, { query: "hidden" })).resolves.toMatchObject({ results: [] });
  });

  it("reports the caller's GitHub App installations without exposing credentials", async () => {
    const result = await callEndpoint(principal(owner.id, ["projects:read"]), endpoint("get_github_status"), {});
    expect(result).toMatchObject({
      connected: true,
      installations: [{ id: 9201, accountLogin: "sam", accountType: "User" }],
    });
    expect(JSON.stringify(result)).not.toMatch(/token|secret|privateKey/i);
  });

  it("assembles deployment status and build evidence, limiting optional signals by scope", async () => {
    const result = await callEndpoint(
      principal(owner.id, ["deployments:read"]),
      endpoint("diagnose_deployment"),
      { deploymentId }
    );
    expect(result).toMatchObject({
      deployment: { id: deploymentId, projectId },
      buildErrors: [{ level: "error", message: "Build failed while installing dependencies" }],
      resources: null,
      alerts: null,
      unavailable: expect.arrayContaining(["resource usage requires resources:read", "alert history requires alerts:read"]),
    });
    await expect(
      callEndpoint(principal(owner.id, ["deployments:read"]), endpoint("diagnose_deployment"), { deploymentId: outsiderDeploymentId })
    ).rejects.toMatchObject({ status: 404 });
  });

  it("reports setup checks supported by the project and names checks outside the caller's scopes", async () => {
    const result = await callEndpoint(
      principal(owner.id, ["projects:read"]),
      endpoint("get_deployment_next_steps"),
      { deploymentId }
    );
    expect(result).toMatchObject({
      deploymentId,
      projectId,
      steps: expect.arrayContaining([
        { id: "auto_deploy", applicable: true, done: false },
        { id: "health_check", applicable: true, done: true },
        { id: "status_page", applicable: true, done: false },
      ]),
      unavailable: expect.arrayContaining([
        "custom domain status requires domains:read",
        "notification status requires notifications:read",
        "resource requests are not supported",
      ]),
    });
    await expect(
      callEndpoint(principal(owner.id, ["projects:read"]), endpoint("get_deployment_next_steps"), { deploymentId: outsiderDeploymentId })
    ).rejects.toMatchObject({ status: 404 });
  });
});
