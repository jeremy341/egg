import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Principal } from "@/server/api-tokens";
import { apiAnalyzeDeploymentResources, apiGetDeploymentVolumes, QUERY_ENDPOINTS } from "@/server/api-v1-query";

const mocks = vi.hoisted(() => ({ deploymentView: vi.fn(), projectRightSize: vi.fn(), deploymentVolumes: vi.fn() }));
vi.mock("@/server/queries", () => ({ deploymentView: mocks.deploymentView, projectRightSize: mocks.projectRightSize }));
vi.mock("@/server/deploy/lifecycle", () => ({ deploymentVolumes: mocks.deploymentVolumes }));

const principal: Principal = {
  userId: "owner-1",
  tokenId: "query-token",
  scopes: ["deployments:read", "resources:read"],
};
const endpointOf = (id: string) => {
  const found = QUERY_ENDPOINTS.find((entry) => entry.id === id);
  if (!found) throw new Error(`Missing endpoint: ${id}`);
  return found;
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.deploymentView.mockResolvedValue({ deployment: { id: "dep-1", projectId: "project-1" } });
  mocks.projectRightSize.mockResolvedValue({ status: "recommendation", memoryMb: 768 });
  mocks.deploymentVolumes.mockResolvedValue({ deploymentId: "dep-1", volumes: ["egg-app_data"] });
});

describe("query endpoints", () => {
  it("exports exact-name resource and volume queries with distinct routes", () => {
    expect(QUERY_ENDPOINTS.map(({ id, method, path }) => ({ id, method, path }))).toEqual([
      { id: "analyze_deployment_resources", method: "GET", path: "/deployments/{deploymentId}/resource-analysis" },
      { id: "get_deployment_volumes", method: "GET", path: "/deployments/{deploymentId}/deployment-volumes" },
    ]);
    expect(new Set(QUERY_ENDPOINTS.map(({ path }) => path)).size).toBe(QUERY_ENDPOINTS.length);
  });

  it("uses the deployment owner's project for the monitor-backed recommendation", async () => {
    await expect(apiAnalyzeDeploymentResources(principal, "dep-1")).resolves.toEqual({
      deploymentId: "dep-1",
      projectId: "project-1",
      source: "project-monitor-resource-samples",
      recommendation: { status: "recommendation", memoryMb: 768 },
    });
    expect(mocks.deploymentView).toHaveBeenCalledWith("owner-1", "dep-1");
    expect(mocks.projectRightSize).toHaveBeenCalledWith("owner-1", "project-1");
  });

  it("requires resource scope before reading a deployment or its samples", async () => {
    await expect(apiAnalyzeDeploymentResources({ ...principal, scopes: ["deployments:read"] }, "dep-1"))
      .rejects.toMatchObject({ status: 403 });
    expect(mocks.deploymentView).not.toHaveBeenCalled();
    expect(mocks.projectRightSize).not.toHaveBeenCalled();
  });

  it("lists only volumes owned by the requested deployment", async () => {
    await expect(apiGetDeploymentVolumes(principal, "dep-1")).resolves.toEqual({
      deploymentId: "dep-1",
      volumes: ["egg-app_data"],
    });
    expect(mocks.deploymentVolumes).toHaveBeenCalledWith("owner-1", "dep-1");
  });

  it("requires deployment read scope before listing volumes", async () => {
    await expect(apiGetDeploymentVolumes({ ...principal, scopes: ["resources:read"] }, "dep-1"))
      .rejects.toMatchObject({ status: 403 });
    expect(mocks.deploymentVolumes).not.toHaveBeenCalled();
  });

  it("validates required ids and rejects undeclared input", () => {
    for (const id of ["analyze_deployment_resources", "get_deployment_volumes"]) {
      const input = endpointOf(id).input;
      expect(input.safeParse({ deploymentId: "dep-1" }).success).toBe(true);
      expect(input.safeParse({}).success).toBe(false);
      expect(input.safeParse({ deploymentId: "dep-1", surprise: true }).success).toBe(false);
    }
  });
});
