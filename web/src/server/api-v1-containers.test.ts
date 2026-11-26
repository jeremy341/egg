import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Principal, Scope } from "@/server/api-tokens";
import { ENDPOINTS, callEndpoint } from "@/server/api-v1";
import { upsertUser } from "@/server/auth/session";
import { dockerContainerName } from "@/server/deploy/remote";
import { serverDiscriminator } from "@/server/deploy/layout";
import { createProject } from "@/server/projects";
import { forgetServiceStatus } from "@/server/service-status";
import { useFreshDb } from "@/server/test/db";
import { parseProjectContainers } from "@/server/api-v1-containers";

vi.mock("@/server/servers", async (original) => {
  const real = await original<typeof import("@/server/servers")>();
  return { ...real, withServerSession: vi.fn() };
});

import { createServer, withServerSession } from "@/server/servers";

let ctx: Awaited<ReturnType<typeof useFreshDb>>;
let ownerId: string;
let otherId: string;
let serverId: string;
let composeProjectId: string;
let nativeProjectId: string;
let remoteOutput = "";
let remoteScript = "";
const session = {
  script: vi.fn(async (script: string) => {
    remoteScript = script;
    return { code: 0, stdout: "", stderr: "" };
  }),
};

const mainContainerId = "a".repeat(64);
const cacheContainerId = "b".repeat(64);
const otherContainerId = "c".repeat(64);
const startedAt = "2026-11-25T11:12:13.000Z";
const createdAt = "2026-11-25T10:00:00.000Z";

function mainContainerName() {
  return dockerContainerName("compose-app", undefined, serverDiscriminator(serverId));
}

function endpointFor(id: string) {
  const endpoint = ENDPOINTS.find((entry) => entry.id === id);
  if (!endpoint) throw new Error(`${id} is not registered`);
  return endpoint;
}

function call(id: string, userId: string, input: Record<string, unknown>, scopes: Scope[] = ["container:read"]) {
  const principal: Principal = { userId, tokenId: "test-token", scopes };
  return callEndpoint(principal, endpointFor(id), input);
}

function composeRows() {
  return [
    "EGG_MAIN_RESTARTS\t4",
    `${mainContainerId}\t/${mainContainerName()}\trunning\t2\t${startedAt}\tghcr.io/example/app:1.2.0\t${createdAt}\t`,
    `${cacheContainerId}\t/egg-compose-app-cache-1\trunning\t0\t${startedAt}\tredis:7\t${createdAt}\tcache`,
    `${otherContainerId}\t/${mainContainerName()}-pv-12345678\trunning\t9\t${startedAt}\tghcr.io/example/app:1.2.0\t${createdAt}\t`,
  ].join("\n");
}

beforeAll(async () => {
  ctx = await useFreshDb();
  ownerId = (await upsertUser({ id: "container-owner", name: "Sam", email: null, slackId: null })).id;
  otherId = (await upsertUser({ id: "container-other", name: "Kim", email: null, slackId: null })).id;
  serverId = (await createServer(ownerId, "sam-containers")).id;
  composeProjectId = (await createProject(ownerId, {
    serverId,
    name: "Compose App",
    slug: "compose-app",
    repoUrl: "https://github.com/example/app.git",
    runtime: "node",
    port: 3000,
    containerPort: 3000,
    deploymentMode: "compose",
    composeFilePath: "compose.yml",
    composeService: "api",
  })).id;
  nativeProjectId = (await createProject(ownerId, {
    serverId,
    name: "Native App",
    slug: "native-app",
    repoUrl: "https://github.com/example/native.git",
    runtime: "node",
    port: 3001,
  })).id;
});

afterAll(async () => {
  await ctx.cleanup();
});

beforeEach(() => {
  remoteOutput = composeRows();
  remoteScript = "";
  session.script.mockReset();
  session.script.mockImplementation(async (script: string) => {
    remoteScript = script;
    return { code: 0, stdout: remoteOutput, stderr: "" };
  });
  vi.mocked(withServerSession).mockReset();
  vi.mocked(withServerSession).mockImplementation(async (_server, run) => run(session as never));
  forgetServiceStatus(composeProjectId);
});

describe("project container endpoints", () => {
  it("lists only the container view fields and resolves Compose service labels", async () => {
    await expect(call("list_project_containers", ownerId, { projectId: composeProjectId })).resolves.toEqual({
      projectId: composeProjectId,
      containers: [
        {
          id: mainContainerId,
          name: mainContainerName(),
          service: "api",
          state: "running",
          restartCount: 4,
          startedAt,
        },
        {
          id: cacheContainerId,
          name: "egg-compose-app-cache-1",
          service: "cache",
          state: "running",
          restartCount: 0,
          startedAt,
        },
      ],
    });
    expect(session.script).toHaveBeenCalledTimes(1);
    expect(remoteScript).toContain("com.docker.compose.project=egg-compose-app-");
    expect(remoteScript).toContain("-p NRestarts --value");
  });

  it("returns details only for a container in this project's scoped set", async () => {
    await expect(call("get_project_container", ownerId, { projectId: composeProjectId, containerId: mainContainerId })).resolves.toEqual({
      projectId: composeProjectId,
      container: {
        id: mainContainerId,
        name: mainContainerName(),
        service: "api",
        state: "running",
        restartCount: 4,
        startedAt,
        image: "ghcr.io/example/app:1.2.0",
        createdAt,
      },
    });
    expect(remoteScript).not.toContain(".Config.Env");

    await expect(call("get_project_container", ownerId, { projectId: composeProjectId, containerId: otherContainerId }))
      .rejects.toMatchObject({ status: 404 });
  });

  it("checks scope and project access before reading the container", async () => {
    await expect(call("list_project_containers", ownerId, { projectId: composeProjectId }, ["projects:read"]))
      .rejects.toMatchObject({ status: 403 });
    await expect(call("list_project_containers", otherId, { projectId: composeProjectId }))
      .rejects.toMatchObject({ status: 404 });
    expect(withServerSession).not.toHaveBeenCalled();
  });

  it("returns no Docker containers for a native systemd project", async () => {
    await expect(call("list_project_containers", ownerId, { projectId: nativeProjectId })).resolves.toEqual({
      projectId: nativeProjectId,
      containers: [],
    });
    expect(withServerSession).not.toHaveBeenCalled();
  });

  it("returns the existing health-check status, including its HTTP result", async () => {
    remoteOutput = [
      "EGG_ACTIVE=active",
      "EGG_LoadState=loaded",
      "EGG_ActiveState=active",
      "EGG_SubState=running",
      "EGG_MainPID=42",
      "EGG_NRestarts=3",
      "EGG_ActiveEnterTimestampMonotonic=1000000",
      "EGG_MemoryCurrent=10485760",
      "EGG_CPUUsageNSec=123456",
      "EGG_InvocationID=invocation-1",
      "EGG_HTTP=200 0.025",
      "EGG_RESULT=success",
      "EGG_UPTIME=10",
    ].join("\n");

    await expect(call("get_project_health", ownerId, { projectId: composeProjectId })).resolves.toMatchObject({
      projectId: composeProjectId,
      cached: false,
      status: {
        state: "running",
        restarts: 3,
        http: { code: 200, ms: 25 },
        checkedAt: expect.any(String),
      },
    });
  });

  it("rejects a malformed container id before opening an SSH session", async () => {
    await expect(call("get_project_container", ownerId, { projectId: composeProjectId, containerId: "../../other" }))
      .rejects.toMatchObject({ status: 400 });
    expect(withServerSession).not.toHaveBeenCalled();
  });
});

describe("parseProjectContainers", () => {
  it("uses the project service name when Docker has no Compose service label", () => {
    expect(parseProjectContainers(composeRows(), "api", mainContainerName())[0]).toEqual({
      id: mainContainerId,
      name: mainContainerName(),
      service: "api",
      state: "running",
      restartCount: 4,
      startedAt,
      image: "ghcr.io/example/app:1.2.0",
      createdAt,
    });
  });

  it("returns null for a container that has never started", () => {
    const row = `${mainContainerId}\t/${mainContainerName()}\texited\t0\t0001-01-01T00:00:00Z\tghcr.io/example/app:1.2.0\t${createdAt}\t`;
    expect(parseProjectContainers(row, "api", mainContainerName())[0].startedAt).toBeNull();
  });
});
