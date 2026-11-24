import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Principal } from "@/server/api-tokens";
import { COMPOSE_ENDPOINTS, apiGetComposeStack, apiListComposeReleases, apiListComposeStacks, apiRedeployComposeStack } from "@/server/api-v1-compose";

const mocks = vi.hoisted(() => ({
  projectViews: vi.fn(), deploymentPage: vi.fn(), deploymentView: vi.fn(), getDb: vi.fn(), getReadableProject: vi.fn(), redeploy: vi.fn(),
}));
vi.mock("@/server/queries", () => ({ projectViews: mocks.projectViews, deploymentPage: mocks.deploymentPage, deploymentView: mocks.deploymentView }));
vi.mock("@/server/db", () => ({
  getDb: mocks.getDb,
  schema: {
    deployments: { projectId: "projectId" },
    WEBHOOK_EVENTS: ["deployment.started", "deployment.succeeded", "deployment.failed"],
  },
}));
vi.mock("@/server/projects", () => ({ getReadableProject: mocks.getReadableProject, redeploy: mocks.redeploy }));

const reader: Principal = { userId: "owner", tokenId: "token", scopes: ["projects:read", "deployments:read"] };
const writer: Principal = { ...reader, scopes: [...reader.scopes, "deployments:write"] };
const compose = {
  id: "stack-1", slug: "compose-app", name: "Compose App", serverId: "server-1", branch: "main",
  composeFilePath: "compose.yaml", composeService: "web", containerPort: 3000,
  latestDeploymentId: "dep-1", state: "ready", deploymentMode: "compose",
};
const native = { ...compose, id: "native-1", deploymentMode: "native" };
const deployment = {
  id: "dep-1", projectId: "stack-1", projectSlug: "compose-app", env: "production", rawState: "ready",
  source: "manual", branch: "main", sha: "a".repeat(40), commit: "Initial release", pr: null, author: null,
  isCurrent: true, cleanedUp: false, error: null, createdAt: "2026-01-01T00:00:00.000Z", durationMs: 1000,
};
const ep = (id: string) => {
  const found = COMPOSE_ENDPOINTS.find((item) => item.id === id);
  if (!found) throw new Error(`Missing endpoint ${id}`);
  return found;
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.projectViews.mockResolvedValue([compose, native]);
  mocks.deploymentPage.mockResolvedValue({ rows: [deployment], nextCursor: null });
  mocks.deploymentView.mockResolvedValue({ deployment });
  mocks.getReadableProject.mockResolvedValue({ deploymentMode: "compose" });
  mocks.redeploy.mockResolvedValue({ id: "dep-2" });
  mocks.getDb.mockResolvedValue({ select: () => ({ from: () => ({ where: async () => [{ value: 1 }] }) }) });
});

describe("Compose API endpoints", () => {
  it("exposes unique routes for stack reads, releases and redeploy", () => {
    expect(COMPOSE_ENDPOINTS.map(({ id, method, path }) => [id, method, path])).toEqual([
      ["list_compose_stacks", "GET", "/compose-stacks"],
      ["get_compose_stack", "GET", "/compose-stacks/{projectId}"],
      ["list_compose_releases", "GET", "/compose-stacks/{projectId}/releases"],
      ["redeploy_compose_stack", "POST", "/compose-stacks/{projectId}/redeploy"],
    ]);
    expect(new Set(COMPOSE_ENDPOINTS.map((item) => item.id)).size).toBe(COMPOSE_ENDPOINTS.length);
    expect(ep("get_compose_stack").input.safeParse({}).success).toBe(false);
    expect(ep("list_compose_stacks").input.safeParse({ limit: 101 }).success).toBe(false);
  });

  it("lists only Compose-mode projects with cursor pagination", async () => {
    await expect(apiListComposeStacks(reader, 1)).resolves.toMatchObject({
      stacks: [{ id: "stack-1", composeService: "web" }], items: [{ id: "stack-1" }], total: 1, nextCursor: null,
    });
    await expect(apiListComposeStacks({ ...reader, scopes: [] })).rejects.toMatchObject({ status: 403 });
  });

  it("gets a Compose stack and hides non-Compose or missing projects", async () => {
    await expect(apiGetComposeStack(reader, "stack-1")).resolves.toMatchObject({ stack: { id: "stack-1" } });
    await expect(apiGetComposeStack(reader, "native-1")).rejects.toMatchObject({ status: 404 });
    await expect(apiGetComposeStack(reader, "missing")).rejects.toMatchObject({ status: 404 });
  });

  it("lists Compose releases only after scope and stack checks", async () => {
    await expect(apiListComposeReleases(reader, "stack-1", 10)).resolves.toMatchObject({
      releases: [{ id: "dep-1", projectId: "stack-1" }], items: [{ id: "dep-1" }], total: 1, nextCursor: null,
    });
    expect(mocks.deploymentPage).toHaveBeenCalledWith("owner", { projectId: "stack-1", limit: 10, cursor: undefined });
    await expect(apiListComposeReleases(reader, "native-1")).rejects.toMatchObject({ status: 404 });
    await expect(apiListComposeReleases({ ...reader, scopes: ["projects:read"] }, "stack-1")).rejects.toMatchObject({ status: 403 });
  });

  it("redeploys the latest Compose release using the existing deployment service", async () => {
    await expect(apiRedeployComposeStack(writer, "stack-1")).resolves.toMatchObject({ deployment: { id: "dep-1" } });
    expect(mocks.redeploy).toHaveBeenCalledWith("owner", "dep-1", { tokenId: "token" });
    expect(mocks.deploymentView).toHaveBeenCalledWith("owner", "dep-2");

    mocks.getReadableProject.mockResolvedValueOnce({ deploymentMode: "native" });
    await expect(apiRedeployComposeStack(writer, "native-1")).rejects.toMatchObject({ status: 404 });
    expect(mocks.redeploy).toHaveBeenCalledTimes(1);
    mocks.projectViews.mockResolvedValueOnce([{ ...compose, latestDeploymentId: null }]);
    await expect(apiRedeployComposeStack(writer, "stack-1")).rejects.toMatchObject({ status: 409 });
    await expect(apiRedeployComposeStack(reader, "stack-1")).rejects.toMatchObject({ status: 403 });
  });
});
