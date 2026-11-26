import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Principal } from "@/server/api-tokens";
import { callEndpoint, endpointById } from "@/server/api-v1";
import { upsertUser } from "@/server/auth/session";
import { schema } from "@/server/db";
import { createProject, deployBranch } from "@/server/projects";
import { createServer } from "@/server/servers";
import { useFreshDb } from "@/server/test/db";

const NOW = new Date("2026-11-25T12:00:00.000Z");

let ctx: Awaited<ReturnType<typeof useFreshDb>>;
let userId: string;
let projectId: string;
let otherProjectId: string;
let deploymentId: string;
let otherDeploymentId: string;

const endpoint = () => {
  const found = endpointById("get_deployment_metrics");
  if (!found) throw new Error("Missing get_deployment_metrics endpoint");
  return found;
};

const reader = (): Principal => ({ userId, tokenId: "metrics-token", scopes: ["deployments:read"] });

beforeAll(async () => {
  ctx = await useFreshDb();
  const owner = await upsertUser({ id: "deployment-metrics-owner", name: "Owner", email: null, slackId: null });
  const other = await upsertUser({ id: "deployment-metrics-other", name: "Other", email: null, slackId: null });
  userId = owner.id;

  const ownerServerId = (await createServer(owner.id, "metrics-owner")).id;
  const otherServerId = (await createServer(other.id, "metrics-other")).id;
  const project = await createProject(owner.id, {
    serverId: ownerServerId,
    name: "Metrics owner",
    slug: "metrics-owner",
    repoUrl: "https://github.com/metrics/owner.git",
    runtime: "node",
    port: 3000,
  });
  const otherProject = await createProject(other.id, {
    serverId: otherServerId,
    name: "Metrics other",
    slug: "metrics-other",
    repoUrl: "https://github.com/metrics/other.git",
    runtime: "node",
    port: 3001,
  });
  projectId = project.id;
  otherProjectId = otherProject.id;
  deploymentId = (await deployBranch(owner.id, project.id)).id;
  otherDeploymentId = (await deployBranch(other.id, otherProject.id)).id;
});

afterAll(async () => {
  await ctx.cleanup();
  vi.useRealTimers();
});

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  await ctx.db.delete(schema.projectSamples);
  await ctx.db.insert(schema.projectSamples).values([
    { projectId, at: new Date("2026-11-25T10:00:00.000Z"), memMb: 900, cpuPercent: 90, cpuNs: 1, restarts: 50 },
    { projectId, at: new Date("2026-11-25T10:59:00.000Z"), memMb: 50, cpuPercent: 5, cpuNs: 1, restarts: 1 },
    { projectId, at: new Date("2026-11-25T11:05:00.000Z"), memMb: 100, cpuPercent: 10, cpuNs: 1, restarts: 2 },
    { projectId, at: new Date("2026-11-25T11:10:00.000Z"), memMb: 200, cpuPercent: 20, cpuNs: 1, restarts: 3 },
    { projectId, at: new Date("2026-11-25T11:19:00.000Z"), memMb: 300, cpuPercent: null, cpuNs: 1, restarts: 5 },
    { projectId, at: new Date("2026-11-25T12:01:00.000Z"), memMb: 1000, cpuPercent: 100, cpuNs: 1, restarts: 100 },
    { projectId: otherProjectId, at: new Date("2026-11-25T11:05:00.000Z"), memMb: 999, cpuPercent: 999, cpuNs: 1, restarts: 999 },
  ]);
});

describe("get_deployment_metrics", () => {
  it("is a read endpoint at the deployment metrics path", () => {
    expect(endpoint()).toMatchObject({
      id: "get_deployment_metrics",
      method: "GET",
      path: "/deployments/{deploymentId}/metrics",
      scope: "deployments:read",
      readOnly: true,
    });
  });

  it("buckets the visible project's CPU, memory and cumulative restart deltas", async () => {
    const result = await callEndpoint(reader(), endpoint(), { deploymentId, window: "1", bucket: "15" });
    expect(result).toEqual({
      deploymentId,
      projectId,
      window: 1,
      bucket: 15,
      samples: [
        {
          at: "2026-11-25T11:00:00.000Z",
          cpuPercent: 15,
          memoryMb: 150,
          restarts: 2,
        },
        {
          at: "2026-11-25T11:15:00.000Z",
          cpuPercent: null,
          memoryMb: 300,
          restarts: 2,
        },
      ],
    });
  });

  it("defaults to 24 hours and 60-minute buckets and bounds both query values", () => {
    const ep = endpoint();
    expect(ep.input.parse({ deploymentId })).toMatchObject({ window: 24, bucket: 60 });
    expect(ep.input.parse({ deploymentId, window: "1", bucket: "5" })).toMatchObject({ window: 1, bucket: 5 });
    expect(ep.input.parse({ deploymentId, window: "168", bucket: "1440" })).toMatchObject({ window: 168, bucket: 1440 });
    for (const window of ["0", "169"]) expect(() => ep.input.parse({ deploymentId, window })).toThrow();
    for (const bucket of ["4", "1441"]) expect(() => ep.input.parse({ deploymentId, bucket })).toThrow();
  });

  it("requires deployments:read before reading samples", async () => {
    await expect(
      callEndpoint({ ...reader(), scopes: [] }, endpoint(), { deploymentId }),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("returns 404 for a deployment owned by another caller", async () => {
    await expect(
      callEndpoint(reader(), endpoint(), { deploymentId: otherDeploymentId }),
    ).rejects.toMatchObject({ status: 404 });
  });
});
