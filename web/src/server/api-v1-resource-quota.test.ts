import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Principal, Scope } from "@/server/api-tokens";
import { ENDPOINTS, callEndpoint } from "@/server/api-v1";
import { upsertUser } from "@/server/auth/session";
import { schema } from "@/server/db";
import { createProject } from "@/server/projects";
import { useFreshDb } from "@/server/test/db";

vi.mock("@/server/servers", async (original) => {
  const real = await original<typeof import("@/server/servers")>();
  return { ...real, withServerSession: vi.fn() };
});

import { createServer, withServerSession } from "@/server/servers";

let ctx: Awaited<ReturnType<typeof useFreshDb>>;
let me: { id: string };
let other: { id: string };
let serverId: string;
let otherServerId: string;
let projectId: string;
let dockerProjectId: string;
let otherProjectId: string;

const session = { script: vi.fn() };
let remoteOutput = "";

function quotaEndpoint() {
  const endpoint = ENDPOINTS.find((entry) => entry.id === "get_resource_quota");
  if (!endpoint) throw new Error("get_resource_quota is not registered");
  return endpoint;
}

function readQuota(userId: string, id: string, scopes: Scope[] = ["resources:read"]) {
  const principal: Principal = { userId, tokenId: "test-token", scopes };
  return callEndpoint(principal, quotaEndpoint(), { projectId: id });
}

beforeAll(async () => {
  ctx = await useFreshDb();
  me = await upsertUser({ id: "quota-owner", name: "Sam", email: null, slackId: null });
  other = await upsertUser({ id: "quota-other", name: "Kim", email: null, slackId: null });
  serverId = (await createServer(me.id, "sam-quota")).id;
  otherServerId = (await createServer(other.id, "kim-quota")).id;

  const base = { repoUrl: "https://github.com/sam/app.git", runtime: "node" as const };
  projectId = (await createProject(me.id, { ...base, serverId, name: "App", slug: "app", port: 3000 })).id;
  dockerProjectId = (
    await createProject(me.id, {
      ...base,
      serverId,
      name: "Docker App",
      slug: "docker-app",
      port: 3001,
      deploymentMode: "dockerfile",
      dockerfilePath: "Dockerfile",
    })
  ).id;
  await createProject(me.id, { ...base, serverId, name: "Worker", slug: "worker", port: 3002, workloadKind: "worker" });
  otherProjectId = (await createProject(other.id, { ...base, serverId: otherServerId, name: "Theirs", slug: "theirs", port: 3003 })).id;
});

afterAll(async () => {
  await ctx.cleanup();
});

beforeEach(async () => {
  await ctx.db.delete(schema.projectSamples);
  await ctx.db.delete(schema.usageSamples);
  remoteOutput = "";
  session.script.mockReset();
  session.script.mockImplementation(async () => ({ code: 0, stdout: remoteOutput, stderr: "" }));
  vi.mocked(withServerSession).mockReset();
  vi.mocked(withServerSession).mockImplementation(async (_server, fn) => fn(session as never));
});

describe("get_resource_quota", () => {
  it("requires resources:read before opening a server session", async () => {
    await expect(readQuota(me.id, projectId, ["projects:read"])).rejects.toMatchObject({ status: 403 });
    expect(withServerSession).not.toHaveBeenCalled();
  });

  it("returns latest project and server usage with managed systemd limits", async () => {
    const now = Date.now();
    await ctx.db.insert(schema.projectSamples).values([
      { projectId, at: new Date(now - 60_000), memMb: 256, cpuPercent: 12, restarts: 0 },
      { projectId, at: new Date(now), memMb: 384, cpuPercent: 31, restarts: 1 },
    ]);
    await ctx.db.insert(schema.usageSamples).values([
      { serverId, at: new Date(now - 60_000), cpuLoad: 1, cpus: 4, memUsedMb: 2048, memTotalMb: 8192, diskUsedMb: 4096, diskTotalMb: 20_480 },
      { serverId, at: new Date(now), cpuLoad: 2, cpus: 4, memUsedMb: 4096, memTotalMb: 8192, diskUsedMb: 6144, diskTotalMb: 20_480 },
    ]);
    remoteOutput = "cpu=2s\nmemory=1073741824\n";

    await expect(readQuota(me.id, projectId)).resolves.toEqual({
      project: {
        id: projectId,
        slug: "app",
        name: "App",
        cpuLimitCores: 2,
        memoryLimitMb: 1024,
        cpuUsagePercent: 31,
        memoryUsageMb: 384,
      },
      server: {
        serviceCount: 3,
        memoryTotalMb: 8192,
        memoryUsedMb: 4096,
        diskTotalMb: 20_480,
        diskUsedMb: 6144,
      },
    });
  });

  it("returns null for limits and usage that have not been measured", async () => {
    await expect(readQuota(me.id, projectId)).resolves.toMatchObject({
      project: {
        cpuLimitCores: null,
        memoryLimitMb: null,
        cpuUsagePercent: null,
        memoryUsageMb: null,
      },
      server: {
        serviceCount: 3,
        memoryTotalMb: null,
        memoryUsedMb: null,
        diskTotalMb: null,
        diskUsedMb: null,
      },
    });
  });

  it("reads Docker CPU and memory limits from the managed container", async () => {
    remoteOutput = "536870912|2000000000|0|0\n";

    await expect(readQuota(me.id, dockerProjectId)).resolves.toMatchObject({
      project: { cpuLimitCores: 2, memoryLimitMb: 512 },
    });
  });

  it("returns 404 when the caller does not own the project", async () => {
    await expect(readQuota(me.id, otherProjectId)).rejects.toMatchObject({ status: 404 });
    expect(withServerSession).not.toHaveBeenCalled();
  });
});
