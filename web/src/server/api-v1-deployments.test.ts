import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Principal } from "@/server/api-tokens";
import { DEPLOYMENT_CRUD_ENDPOINTS, apiRetryDeploymentApply, apiUpdateDeploymentResources } from "@/server/api-v1-deployments";
import { requireView } from "@/server/api-v1-models";
import { operateDeployment } from "@/server/deploy/lifecycle";
import { redeploy } from "@/server/projects";

const mocks = vi.hoisted(() => ({
  operateDeployment: vi.fn(),
  redeploy: vi.fn(),
  requireView: vi.fn(),
}));

vi.mock("@/server/api-v1-models", async () => {
  const actual = await vi.importActual<typeof import("@/server/api-v1-models")>("@/server/api-v1-models");
  return { ...actual, requireView: mocks.requireView };
});
vi.mock("@/server/deploy/lifecycle", () => ({ operateDeployment: mocks.operateDeployment }));
vi.mock("@/server/projects", async () => {
  const actual = await vi.importActual<typeof import("@/server/projects")>("@/server/projects");
  return { ...actual, redeploy: mocks.redeploy };
});

const writer: Principal = { userId: "user-1", tokenId: "token-1", scopes: ["projects:write", "deployments:write"] };
const endpointOf = (id: string) => {
  const found = DEPLOYMENT_CRUD_ENDPOINTS.find((entry) => entry.id === id);
  if (!found) throw new Error(`Missing endpoint ${id}`);
  return found;
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.redeploy.mockResolvedValue({ id: "deployment-2" });
  mocks.requireView.mockResolvedValue({ id: "deployment-2", projectId: "project-1" });
  mocks.operateDeployment.mockResolvedValue({ action: "scale", deploymentId: "deployment-1", output: "scaled" });
});

describe("deployment CRUD endpoint definitions", () => {
  it("exports each requested operation once", () => {
    expect(DEPLOYMENT_CRUD_ENDPOINTS.map((entry) => entry.id)).toEqual([
      "create_deployment",
      "delete_deployment",
      "rename_deployment",
      "retry_deployment_apply",
      "update_deployment_build_config",
      "update_deployment_github_repo",
      "update_deployment_health_check",
      "update_deployment_image",
      "update_deployment_pull_policy",
      "update_deployment_strategy",
      "update_deployment_resources",
      "update_deployment_volumes",
    ]);
    expect(new Set(DEPLOYMENT_CRUD_ENDPOINTS.map((entry) => entry.id)).size).toBe(DEPLOYMENT_CRUD_ENDPOINTS.length);
    expect(new Set(DEPLOYMENT_CRUD_ENDPOINTS.map((entry) => `${entry.method} ${entry.path}`)).size).toBe(
      DEPLOYMENT_CRUD_ENDPOINTS.length
    );
  });

  it("uses write scopes and marks deletion destructive", () => {
    for (const entry of DEPLOYMENT_CRUD_ENDPOINTS) {
      expect(entry.scope, entry.id).toMatch(/^(projects|deployments):write$/);
      expect(entry.readOnly, entry.id).toBe(false);
    }
    expect(endpointOf("delete_deployment").destructive).toBe(true);
    expect(DEPLOYMENT_CRUD_ENDPOINTS.filter((entry) => entry.id !== "delete_deployment").every((entry) => !entry.destructive)).toBe(true);
  });

  it("validates endpoint inputs and refuses unknown fields", () => {
    const rename = endpointOf("rename_deployment");
    expect(rename.input.parse({ deploymentId: "dep-1", name: "New name" })).toEqual({
      deploymentId: "dep-1",
      name: "New name",
    });
    expect(() => rename.input.parse({ deploymentId: "dep-1", name: " " })).toThrow();
    expect(() => rename.input.parse({ deploymentId: "dep-1", name: "Valid", unexpected: true })).toThrow();

    const resources = endpointOf("update_deployment_resources");
    expect(() => resources.input.parse({ deploymentId: "dep-1", memoryMb: 127 })).toThrow();
    expect(resources.input.parse({ deploymentId: "dep-1", memoryMb: 128 })).toEqual({
      deploymentId: "dep-1",
      memoryMb: 128,
    });
  });
});

describe("deployment CRUD service adapters", () => {
  it("rejects resource updates with no limits and passes valid limits to the scaler", async () => {
    await expect(apiUpdateDeploymentResources(writer, "dep-1", {})).rejects.toMatchObject({ status: 400 });
    await apiUpdateDeploymentResources(writer, "dep-1", { memoryMb: 512, cpuPercent: 200 });
    expect(operateDeployment).toHaveBeenCalledWith("user-1", "dep-1", {
      action: "scale",
      memoryMb: 512,
      cpuPercent: 200,
    });
  });

  it("requires deployment write scope before scaling", async () => {
    const reader: Principal = { userId: "user-2", tokenId: "token-2", scopes: ["deployments:read"] };
    await expect(apiUpdateDeploymentResources(reader, "dep-1", { memoryMb: 512 })).rejects.toMatchObject({ status: 403 });
    expect(operateDeployment).not.toHaveBeenCalled();
  });

  it("queues a fresh redeploy with the caller's token and returns the new deployment", async () => {
    const result = await apiRetryDeploymentApply(writer, "project-1");
    expect(redeploy).toHaveBeenCalledWith("user-1", "project-1", { tokenId: "token-1" });
    expect(requireView).toHaveBeenCalledWith(writer, "deployment-2");
    expect(result).toMatchObject({ deployment: { id: "deployment-2" } });
  });

  it("returns an explicit unsupported error for volume edits", async () => {
    await expect(endpointOf("update_deployment_volumes").run(writer, { deploymentId: "dep-1", volumes: [] } as never)).rejects.toMatchObject({
      status: 501,
      code: "not_supported",
    });
  });
});
