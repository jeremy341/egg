import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Principal } from "@/server/api-tokens";
import { apiListReleases, RELEASE_ENDPOINTS } from "@/server/api-v1-releases";

const mocks = vi.hoisted(() => ({ deploymentPage: vi.fn(), getDb: vi.fn(), getReadableProject: vi.fn() }));

vi.mock("@/server/queries", () => ({ deploymentPage: mocks.deploymentPage }));
vi.mock("@/server/db", () => ({
  getDb: mocks.getDb,
  schema: {
    deployments: { projectId: "projectId" },
    WEBHOOK_EVENTS: ["deployment.started", "deployment.succeeded", "deployment.failed"],
  },
}));
vi.mock("@/server/projects", () => ({ getReadableProject: mocks.getReadableProject }));

const reader: Principal = { userId: "owner", tokenId: "token", scopes: ["deployments:read"] };
const deployment = {
  id: "release-1", projectId: "project-1", projectSlug: "app", env: "production", rawState: "ready",
  source: "manual", branch: "main", sha: "a".repeat(40), commit: "First release", pr: null, author: null,
  isCurrent: true, cleanedUp: false, error: null, createdAt: "2026-01-01T00:00:00.000Z", durationMs: 1000,
};
const endpoint = (id: string) => {
  const found = RELEASE_ENDPOINTS.find((entry) => entry.id === id);
  if (!found) throw new Error(`Missing endpoint ${id}`);
  return found;
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.deploymentPage.mockResolvedValue({ rows: [deployment], nextCursor: "next-release" });
  mocks.getReadableProject.mockResolvedValue({ id: "project-1" });
  mocks.getDb.mockResolvedValue({
    select: () => ({ from: () => ({ where: async () => [{ value: 3 }] }) }),
  });
});

describe("list releases", () => {
  it("exposes a paginated read endpoint for project releases", () => {
    expect(RELEASE_ENDPOINTS.map(({ id, method, path }) => [id, method, path])).toEqual([
      ["list_releases", "GET", "/projects/{projectId}/releases"],
    ]);
    expect(endpoint("list_releases").scope).toBe("deployments:read");
    expect(endpoint("list_releases").input.parse({ projectId: "project-1", limit: 10, cursor: "cursor-1" })).toEqual({
      projectId: "project-1", limit: 10, cursor: "cursor-1",
    });
    expect(() => endpoint("list_releases").input.parse({ projectId: "project-1", limit: 101 })).toThrow();
  });

  it("returns the requested page and total after checking project access", async () => {
    await expect(apiListReleases(reader, "project-1", 10, "cursor-0")).resolves.toMatchObject({
      releases: [{ id: "release-1", projectId: "project-1" }],
      items: [{ id: "release-1" }],
      total: 3,
      nextCursor: "next-release",
    });
    expect(mocks.getReadableProject).toHaveBeenCalledWith("owner", "project-1");
    expect(mocks.deploymentPage).toHaveBeenCalledWith("owner", { projectId: "project-1", limit: 10, cursor: "cursor-0" });
  });

  it("requires deployments:read before checking project access", async () => {
    await expect(apiListReleases({ ...reader, scopes: ["projects:read"] }, "project-1", 20)).rejects.toMatchObject({ status: 403 });
    expect(mocks.getReadableProject).not.toHaveBeenCalled();
    expect(mocks.deploymentPage).not.toHaveBeenCalled();
  });
});
