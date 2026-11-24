import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Principal } from "@/server/api-tokens";
import { IMAGE_ENDPOINTS, apiGetImageHistory, apiGetObservabilityLink, apiListBuildRuns } from "@/server/api-v1-images";

const mocks = vi.hoisted(() => ({ getReadableProject: vi.fn(), deploymentPage: vi.fn() }));
vi.mock("@/server/projects", () => ({ getReadableProject: mocks.getReadableProject }));
vi.mock("@/server/queries", () => ({ deploymentPage: mocks.deploymentPage }));

const reader: Principal = { userId: "u-reader", tokenId: "t", scopes: ["projects:read", "deployments:read"] };
const noScope: Principal = { userId: "u-none", tokenId: "t", scopes: ["logs:read"] };
const project = {
  id: "p-1", slug: "sample-app", imageRef: "ghcr.io/example/app:1.2.3",
  deploymentMode: "image", pullPolicy: "always", monitorState: "up",
};
const run = {
  id: "dep-1", projectId: "p-1", projectSlug: "sample-app", projectName: "Sample App",
  repo: "example/app", env: "production", state: "ready", rawState: "ready", source: "manual",
  branch: "main", sha: "abc123", commit: "Release", pr: null, author: "Example", age: "just now",
  duration: "1s", durationMs: 1000, port: 3000, isCurrent: true, cleanedUp: false, error: null,
  createdAt: "2026-01-01T00:00:00.000Z",
};

beforeEach(() => {
  mocks.getReadableProject.mockReset().mockResolvedValue(project);
  mocks.deploymentPage.mockReset().mockResolvedValue({ rows: [run], nextCursor: "next" });
});

describe("image and build endpoint services", () => {
  it("returns only current image configuration and discloses missing history", async () => {
    await expect(apiGetImageHistory(reader, "p-1")).resolves.toEqual({
      projectId: "p-1", imageRef: project.imageRef, deploymentMode: "image",
      pullPolicy: "always", historyAvailable: false,
    });
    expect(mocks.getReadableProject).toHaveBeenCalledWith(reader.userId, "p-1");
  });

  it("lists deployment records as build runs and forwards pagination", async () => {
    await expect(apiListBuildRuns(reader, "p-1", 10, "cursor")).resolves.toMatchObject({
      projectId: "p-1", runs: [{ id: "dep-1", state: "ready", branch: "main", sha: "abc123" }], nextCursor: "next",
    });
    expect(mocks.deploymentPage).toHaveBeenCalledWith(reader.userId, {
      projectId: "p-1", limit: 10, cursor: "cursor",
    });
  });

  it("returns encoded Egg project and analytics paths with monitor state", async () => {
    mocks.getReadableProject.mockResolvedValue({ ...project, slug: "my app/one" });
    await expect(apiGetObservabilityLink(reader, "p-1")).resolves.toEqual({
      projectId: "p-1", projectUrl: "/projects/my%20app%2Fone",
      analyticsUrl: "/projects/my%20app%2Fone/analytics", monitorState: "up",
    });
  });

  it("requires the matching read scope for each operation", async () => {
    await expect(apiGetImageHistory(noScope, "p-1")).rejects.toMatchObject({ status: 403 });
    await expect(apiListBuildRuns(noScope, "p-1", 10)).rejects.toMatchObject({ status: 403 });
    await expect(apiGetObservabilityLink(noScope, "p-1")).rejects.toMatchObject({ status: 403 });
    expect(mocks.getReadableProject).not.toHaveBeenCalled();
    expect(mocks.deploymentPage).not.toHaveBeenCalled();
  });
});

describe("IMAGE_ENDPOINTS", () => {
  it("exposes the three operations with distinct routes and bounded pagination", () => {
    expect(IMAGE_ENDPOINTS.map(({ id, method, path }) => [id, method, path])).toEqual([
      ["get_image_history", "GET", "/projects/{projectId}/image-history"],
      ["list_build_runs", "GET", "/projects/{projectId}/build-runs"],
      ["get_observability_link", "GET", "/projects/{projectId}/observability-link"],
    ]);
    expect(new Set(IMAGE_ENDPOINTS.map((entry) => entry.id)).size).toBe(IMAGE_ENDPOINTS.length);
    expect(new Set(IMAGE_ENDPOINTS.map((entry) => `${entry.method} ${entry.path}`)).size).toBe(IMAGE_ENDPOINTS.length);
    const list = IMAGE_ENDPOINTS.find((entry) => entry.id === "list_build_runs");
    expect(list?.input.parse({ projectId: "p-1" })).toMatchObject({ limit: 20 });
    expect(() => list?.input.parse({ projectId: "p-1", limit: 51 })).toThrow();
  });
});
