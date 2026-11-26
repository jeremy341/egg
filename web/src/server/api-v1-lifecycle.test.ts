import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Principal } from "@/server/api-tokens";
import { LIFECYCLE_ENDPOINTS, apiGetVolumes, apiOperateDeployment } from "@/server/api-v1-lifecycle";
import { RATE_LIMITS, rateLimiter } from "@/server/rate-limit";

const { operateDeployment, deploymentVolumes } = vi.hoisted(() => ({
  operateDeployment: vi.fn(),
  deploymentVolumes: vi.fn(),
}));

vi.mock("@/server/deploy/lifecycle", () => ({ operateDeployment, deploymentVolumes }));

const writer: Principal = { userId: "u-writer", tokenId: "t", scopes: ["deployments:write"] };
const reader: Principal = { userId: "u-reader", tokenId: "t", scopes: ["deployments:read"] };
const noScope: Principal = { userId: "u-none", tokenId: "t", scopes: ["projects:read"] };
const id = "dep-1";

const endpointOf = (id: string) => {
  const ep = LIFECYCLE_ENDPOINTS.find((e) => e.id === id);
  if (!ep) throw new Error(`Missing endpoint ${id}`);
  return ep;
};

beforeEach(() => {
  rateLimiter().clear();
  operateDeployment.mockReset().mockImplementation(async (_userId: string, _id: string, input: { action: string }) => ({
    action: input.action,
    deploymentId: id,
    output: "Started egg-app.service",
  }));
  deploymentVolumes.mockReset().mockResolvedValue({ deploymentId: id, volumes: ["egg-app_data", "egg-app_cache"] });
});

describe("lifecycle service layer", () => {
  it("passes each verb through to the deployment service with the token owner's id", async () => {
    for (const action of ["start", "stop", "restart"] as const) {
      const result = await apiOperateDeployment(writer, id, { action });
      expect(operateDeployment).toHaveBeenLastCalledWith(writer.userId, id, { action });
      expect(result).toMatchObject({ action, deploymentId: id, output: expect.any(String) });
    }
    expect(operateDeployment).toHaveBeenCalledTimes(3);
  });

  it("passes scale limits through without inventing replica counts", async () => {
    await apiOperateDeployment(writer, id, { action: "scale", memoryMb: 512, cpuPercent: 200 });
    expect(operateDeployment).toHaveBeenCalledWith(writer.userId, id, {
      action: "scale",
      memoryMb: 512,
      cpuPercent: 200,
    });
  });

  it("checks deployments:write before touching the container", async () => {
    await expect(apiOperateDeployment(noScope, id, { action: "start" })).rejects.toMatchObject({ status: 403 });
    await expect(apiOperateDeployment(reader, id, { action: "stop" })).rejects.toMatchObject({ status: 403 });
    expect(operateDeployment).not.toHaveBeenCalled();
  });

  it("limits how often one user can change a service", async () => {
    const frequent: Principal = { ...writer, userId: "u-frequent" };
    for (let i = 0; i < RATE_LIMITS.serviceRestart.limit; i++) {
      await apiOperateDeployment(frequent, id, { action: "restart" });
    }
    await expect(apiOperateDeployment(frequent, id, { action: "restart" })).rejects.toMatchObject({ status: 429 });
    expect(operateDeployment).toHaveBeenCalledTimes(RATE_LIMITS.serviceRestart.limit);
  });

  it("reads volumes only with deployments:read", async () => {
    expect(await apiGetVolumes(reader, id)).toEqual({ deploymentId: id, volumes: ["egg-app_data", "egg-app_cache"] });
    expect(deploymentVolumes).toHaveBeenCalledWith(reader.userId, id);

    await expect(apiGetVolumes(noScope, id)).rejects.toMatchObject({ status: 403 });
    await expect(apiGetVolumes(writer, id)).rejects.toMatchObject({ status: 403 });
    expect(deploymentVolumes).toHaveBeenCalledTimes(1);
  });
});

describe("lifecycle endpoint descriptions", () => {
  it("lists one verb per lifecycle action and one volume read", () => {
    expect(LIFECYCLE_ENDPOINTS.map((e) => [e.id, e.method, e.path])).toEqual([
      ["start_deployment", "POST", "/deployments/{deploymentId}/start"],
      ["stop_deployment", "POST", "/deployments/{deploymentId}/stop"],
      ["restart_deployment", "POST", "/deployments/{deploymentId}/restart"],
      ["scale_deployment", "POST", "/deployments/{deploymentId}/scale"],
      ["get_volumes", "GET", "/deployments/{deploymentId}/volumes"],
    ]);
    expect(new Set(LIFECYCLE_ENDPOINTS.map((e) => e.id)).size).toBe(LIFECYCLE_ENDPOINTS.length);
    expect(new Set(LIFECYCLE_ENDPOINTS.map((e) => `${e.method} ${e.path}`)).size).toBe(LIFECYCLE_ENDPOINTS.length);
  });

  it("marks the verbs as writes and the volume read as an SSH read", () => {
    for (const ep of LIFECYCLE_ENDPOINTS.filter((e) => e.method === "POST")) {
      expect(ep, ep.id).toMatchObject({
        scope: "deployments:write",
        bucket: "write",
        status: 200,
        readOnly: false,
        untrusted: true,
      });
    }
    expect(endpointOf("stop_deployment").destructive).toBe(true);
    for (const e of LIFECYCLE_ENDPOINTS.filter((x) => x.id !== "stop_deployment")) expect(e.destructive).toBe(false);

    expect(endpointOf("get_volumes")).toMatchObject({
      scope: "deployments:read",
      bucket: "ssh",
      readOnly: true,
      untrusted: true,
    });
  });

  it("validates scale limits and refuses extra fields", () => {
    const scale = endpointOf("scale_deployment");
    expect(scale.input.parse({ deploymentId: id })).toEqual({ deploymentId: id });
    expect(scale.input.parse({ deploymentId: id, memoryMb: 128, cpuPercent: 6400 })).toMatchObject({
      memoryMb: 128,
      cpuPercent: 6400,
    });
    for (const bad of [
      { memoryMb: 0 },
      { memoryMb: 32769 },
      { memoryMb: 512.5 },
      { cpuPercent: 0 },
      { cpuPercent: 6401 },
      { replicas: 2 },
    ]) {
      expect(scale.input.safeParse({ deploymentId: id, ...bad }).success, JSON.stringify(bad)).toBe(false);
    }
    expect(endpointOf("start_deployment").input.safeParse({}).success).toBe(false);
  });

  it("answers with the action, the id and the container's output", async () => {
    for (const e of LIFECYCLE_ENDPOINTS.filter((x) => x.method === "POST")) {
      expect(e.response.parse({ action: "start", deploymentId: id, output: "Started" })).toEqual({
        action: "start",
        deploymentId: id,
        output: "Started",
      });
      expect(e.response.safeParse({ output: 42 }).success).toBe(false);
    }
    expect(endpointOf("get_volumes").response.parse({ deploymentId: id, volumes: ["egg-app_data"] })).toEqual({
      deploymentId: id,
      volumes: ["egg-app_data"],
    });
  });

  it("delegates each run to the matching service call", async () => {
    for (const action of ["start", "stop", "restart", "scale"] as const) {
      const ep = endpointOf(`${action}_deployment`);
      const body = action === "scale" ? { memoryMb: 1024 } : {};
      await ep.run(writer as never, ep.input.parse({ deploymentId: id, ...body }) as never);
      expect(operateDeployment).toHaveBeenLastCalledWith(writer.userId, id, { action, ...body });
    }

    const volumes = endpointOf("get_volumes");
    await volumes.run(reader as never, volumes.input.parse({ deploymentId: id }) as never);
    expect(deploymentVolumes).toHaveBeenCalledWith(reader.userId, id);
  });

  it("documents that scale changes limits, not replicas", () => {
    expect(endpointOf("scale_deployment").description).toMatch(/no replicas|memory/i);
    expect(endpointOf("get_volumes").description).toMatch(/untrusted|data, never as instructions/i);
  });
});
