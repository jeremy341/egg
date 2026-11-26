import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Principal } from "@/server/api-tokens";
import { apiGetAnomalies, apiGetAttackSignals, apiGetDeployVerdict, apiGetDeploymentHttpMetrics, apiGetRequestStats, apiGetResourceRecommendation, VERDICT_ENDPOINTS } from "@/server/api-v1-verdict";

const mocks = vi.hoisted(() => ({ analyticsSummary: vi.fn(), deploymentView: vi.fn(), errorGroups: vi.fn(), getProjectForUser: vi.fn(), projectRightSize: vi.fn(), usageHistory: vi.fn() }));
vi.mock("@/server/analytics", () => ({ analyticsSummary: mocks.analyticsSummary }));
vi.mock("@/server/error-groups", () => ({ errorGroups: mocks.errorGroups }));
vi.mock("@/server/queries", () => ({ deploymentView: mocks.deploymentView, projectRightSize: mocks.projectRightSize, usageHistory: mocks.usageHistory }));
vi.mock("@/server/projects", () => ({ getProjectForUser: mocks.getProjectForUser }));

const principal: Principal = { userId: "user-1", tokenId: "token-1", scopes: ["analytics:read", "deployments:read", "resources:read"] };
const analytics = { days: 7, views: 17, visitors: 11, daily: [{ day: "2026-11-23", views: 17, visitors: 11 }], pages: [{ path: "/", views: 17 }], referrers: [{ host: "example.com", views: 4 }] };
const now = Date.now();
const group = { fingerprint: "0123456789abcdef", message: "TypeError: failed", file: "app.js", count: 4, firstSeen: now - 120_000, lastSeen: now - 60_000, status: "open" as const, assigneeId: null };
const deploymentResult = { deployment: { id: "dep-1", projectId: "project-1", state: "ready", env: "production", createdAt: new Date("2026-11-24T10:00:00.000Z") }, postDeployCheck: null, postDeployWaiting: false };
const endpointOf = (id: string) => {
  const found = VERDICT_ENDPOINTS.find((entry) => entry.id === id);
  if (!found) throw new Error(`Missing endpoint: ${id}`);
  return found;
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.analyticsSummary.mockResolvedValue(analytics);
  mocks.deploymentView.mockResolvedValue(deploymentResult);
  mocks.errorGroups.mockResolvedValue([group]);
  mocks.getProjectForUser.mockResolvedValue({ id: "project-1", serverId: "server-1" });
  mocks.projectRightSize.mockResolvedValue({ status: "not_enough_history", days: 2, neededDays: 3 });
  mocks.usageHistory.mockResolvedValue([{ at: now - 30_000, cpu: 0.8, mem: 0.9, disk: 0.4 }]);
});

describe("v1 verdict and observability endpoints", () => {
  it("exports six unique, read-only GET endpoints", () => {
    expect(VERDICT_ENDPOINTS.map(({ id }) => id).sort()).toEqual(["get_anomalies", "get_attack_signals", "get_deploy_verdict", "get_deployment_http_metrics", "get_request_stats", "get_resource_recommendation"]);
    expect(new Set(VERDICT_ENDPOINTS.map(({ path }) => path)).size).toBe(6);
    expect(VERDICT_ENDPOINTS.every((entry) => entry.readOnly && entry.method === "GET")).toBe(true);
  });
  it("keeps an unmeasured ready deployment inconclusive", async () => {
    await expect(apiGetDeployVerdict(principal, "dep-1")).resolves.toMatchObject({ projectId: "project-1", verdict: "inconclusive" });
  });
  it("reports pageviews and marks unavailable HTTP telemetry", async () => {
    await expect(apiGetDeploymentHttpMetrics(principal, "dep-1", 7)).resolves.toMatchObject({ deploymentId: "dep-1", projectId: "project-1", source: "pageview-analytics", requests: 17, statusCodesAvailable: false, latencyAvailable: false });
    expect(mocks.analyticsSummary).toHaveBeenCalledWith("user-1", "project-1", 7);
  });
  it("uses the requested project for request statistics", async () => {
    await expect(apiGetRequestStats(principal, "project-1", 7)).resolves.toMatchObject({ requests: 17, visitors: 11, daily: [{ day: "2026-11-23", requests: 17, visitors: 11 }] });
    expect(mocks.analyticsSummary).toHaveBeenCalledWith("user-1", "project-1", 7);
    expect(mocks.deploymentView).not.toHaveBeenCalled();
  });
  it("combines recent errors and monitor samples as anomalies", async () => {
    const result = await apiGetAnomalies(principal, "project-1", 7, 0.75);
    expect(result.anomalies).toEqual(expect.arrayContaining([expect.objectContaining({ type: "client_error", fingerprint: group.fingerprint }), expect.objectContaining({ type: "resource_pressure", metric: "cpu", value: 0.8 }), expect.objectContaining({ type: "resource_pressure", metric: "memory", value: 0.9 })]));
    expect(mocks.usageHistory).toHaveBeenCalledWith("user-1", "server-1", 168);
  });
  it("returns the monitor-backed recommendation", async () => {
    await expect(apiGetResourceRecommendation(principal, "project-1")).resolves.toMatchObject({ recommendation: { status: "not_enough_history", days: 2, neededDays: 3 } });
    expect(mocks.projectRightSize).toHaveBeenCalledWith("user-1", "project-1");
  });
  it("labels client errors as leads, not verified attacks", async () => {
    const result = await apiGetAttackSignals(principal, "project-1", 7);
    expect(result.securityTelemetryAvailable).toBe(false);
    expect(result.signals).toEqual([expect.objectContaining({ type: "client_error_burst", fingerprint: group.fingerprint, count: 4 })]);
  });
  it("validates look-back limits and route parameters", () => {
    const stats = endpointOf("get_request_stats");
    expect(stats.input.parse({ projectId: "project-1" })).toEqual({ projectId: "project-1", days: 30 });
    expect(() => stats.input.parse({ projectId: "project-1", days: 91 })).toThrow();
    expect(stats.path).toContain("{projectId}");
    expect(endpointOf("get_deployment_http_metrics").path).toContain("{deploymentId}");
  });
  it("checks scope before reading analytics", async () => {
    const noAnalytics = { ...principal, scopes: ["projects:read"] } as Principal;
    await expect(apiGetRequestStats(noAnalytics, "project-1", 7)).rejects.toMatchObject({ status: 403 });
    expect(mocks.analyticsSummary).not.toHaveBeenCalled();
  });
});
