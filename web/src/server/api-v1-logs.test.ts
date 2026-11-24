import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Principal } from "@/server/api-tokens";
import {
  LOG_ENDPOINTS,
  apiGetBuildHistory,
  apiGetBuildLogs,
  apiGetKilledContainerLogs,
  apiGetLogContext,
  apiListDeploymentErrors,
  apiSearchLogs,
  apiTriageDeploymentError,
} from "@/server/api-v1-logs";

const mocks = vi.hoisted(() => ({
  fetchRuntimeLogPage: vi.fn(),
  fetchRuntimeLogContext: vi.fn(),
  deploymentLogs: vi.fn(),
  deploymentPage: vi.fn(),
  errorGroups: vi.fn(),
  changeErrorGroup: vi.fn(),
  tagAudit: vi.fn(),
}));

vi.mock("@/server/runtime-info", () => ({
  fetchRuntimeLogPage: mocks.fetchRuntimeLogPage,
  fetchRuntimeLogContext: mocks.fetchRuntimeLogContext,
}));
vi.mock("@/server/projects", () => ({ deploymentLogs: mocks.deploymentLogs }));
vi.mock("@/server/queries", () => ({ deploymentPage: mocks.deploymentPage }));
vi.mock("@/server/error-groups", () => ({
  errorGroups: mocks.errorGroups,
  changeErrorGroup: mocks.changeErrorGroup,
}));
vi.mock("@/server/api-v1-audit", () => ({ tagAudit: mocks.tagAudit }));

const reader: Principal = {
  userId: "u-reader",
  tokenId: "t",
  scopes: ["logs:read", "deployments:read", "analytics:read"],
};
const writer: Principal = { userId: "u-writer", tokenId: "t", scopes: ["projects:write"] };
const noScope: Principal = { userId: "u-none", tokenId: "t", scopes: ["projects:read"] };

const endpointOf = (id: string) => {
  const ep = LOG_ENDPOINTS.find((e) => e.id === id);
  if (!ep) throw new Error(`Missing endpoint ${id}`);
  return ep;
};

const bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value), "utf8");

const deploymentView = (overrides: Record<string, unknown> = {}) => ({
  id: "dep-1",
  projectId: "p-1",
  projectSlug: "app",
  projectName: "App",
  repo: "sam/app",
  env: "production",
  state: "ready",
  rawState: "ready",
  source: "manual",
  branch: "main",
  sha: "abc123",
  commit: "Ship it",
  pr: null,
  author: "Sam",
  age: "just now",
  duration: "1s",
  durationMs: 1000,
  port: 3000,
  isCurrent: true,
  cleanedUp: false,
  error: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  ...overrides,
});

beforeEach(() => {
  for (const fn of Object.values(mocks)) fn.mockReset();
  mocks.tagAudit.mockImplementation(async (_p: Principal, _action: string, fn: () => Promise<unknown>) => fn());
  mocks.errorGroups.mockResolvedValue([
    { fingerprint: "0123456789abcdef", message: "TypeError", file: "", count: 1, firstSeen: 1, lastSeen: 2, status: "open", assigneeId: null },
  ]);
});

describe("log service layer", () => {
  it("searches the journal with the token owner's id and caps the answer at 40 KB", async () => {
    const lines = Array.from({ length: 300 }, (_, i) => `line-${i}-` + "x".repeat(200));
    mocks.fetchRuntimeLogPage.mockResolvedValue({ lines, older: "1.5" });
    const out = await apiSearchLogs(reader, "p-1", { range: "24h", level: "problems", limit: 200, before: "1.5", q: "oops" });
    expect(mocks.fetchRuntimeLogPage).toHaveBeenCalledWith(reader.userId, "p-1", 200, "oops", {
      range: "24h",
      level: "problems",
      before: "1.5",
    });
    expect(out).toMatchObject({ projectId: "p-1", source: "service-journal", older: "1.5", truncated: true });
    expect(bytes(out)).toBeLessThanOrEqual(40 * 1024);
    expect(out.lines.at(-1)).toContain("line-299");
  });

  it("refuses a search without logs:read before reading the journal", async () => {
    await expect(apiSearchLogs(noScope, "p-1", { range: "7d", level: "all", limit: 100 })).rejects.toMatchObject({ status: 403 });
    expect(mocks.fetchRuntimeLogPage).not.toHaveBeenCalled();
  });

  it("reads log context around a timestamp and marks clipped text", async () => {
    const at = Date.parse("2026-01-01T00:00:00.000Z");
    mocks.fetchRuntimeLogContext.mockResolvedValue(Array.from({ length: 200 }, (_, i) => `${i}-` + "y".repeat(500)));
    const out = await apiGetLogContext(reader, "p-1", at, 30, 60, 200);
    expect(mocks.fetchRuntimeLogContext).toHaveBeenCalledWith(reader.userId, "p-1", at, 30, 60, 200);
    expect(out.at).toBe("2026-01-01T00:00:00.000Z");
    expect(out.truncated).toBe(true);
    expect(bytes(out)).toBeLessThanOrEqual(40 * 1024);
  });

  it("pages build output by id and caps a huge build line", async () => {
    const now = new Date("2026-01-01T00:00:00.000Z");
    mocks.deploymentLogs.mockResolvedValue([
      { id: 1, at: now, level: "info", message: "Cloning" },
      { id: 2, at: now, level: "warn", message: "Slow install" },
      { id: 3, at: now, level: "error", message: "Build failed" },
    ]);
    const page = await apiGetBuildLogs(reader, "dep-1", 0, 2);
    expect(mocks.deploymentLogs).toHaveBeenCalledWith(reader.userId, "dep-1", 0, 3);
    expect(page.lines.map((l) => l.message)).toEqual(["Cloning", "Slow install"]);
    expect(page).toMatchObject({ deploymentId: "dep-1", more: true, nextAfter: 2, truncated: false });

    mocks.deploymentLogs.mockResolvedValue([{ id: 9, at: now, level: "error", message: "x".repeat(100_000) }]);
    const capped = await apiGetBuildLogs(reader, "dep-1", 0, 500);
    expect(mocks.deploymentLogs).toHaveBeenLastCalledWith(reader.userId, "dep-1", 0, 501);
    expect(capped.truncated).toBe(true);
    expect(capped.lines[0].message.length).toBeLessThan(100_000);
    expect(capped.nextAfter).toBe(9);
    expect(bytes(capped)).toBeLessThanOrEqual(40 * 1024);
  });

  it("lists build history newest first, clips long commits and carries the cursor", async () => {
    mocks.deploymentPage.mockResolvedValue({
      rows: [deploymentView({ id: "dep-2", commit: "x".repeat(1000) }), deploymentView()],
      nextCursor: "dep-1",
    });
    const out = await apiGetBuildHistory(reader, "p-1", 2);
    expect(mocks.deploymentPage).toHaveBeenCalledWith(reader.userId, { projectId: "p-1", limit: 2, cursor: undefined });
    expect(out.builds.map((b) => b.id)).toEqual(["dep-2", "dep-1"]);
    expect(out.builds[0].commit).toHaveLength(201);
    expect(out).toMatchObject({ projectId: "p-1", nextCursor: "dep-1", truncated: true });
    expect(bytes(out)).toBeLessThanOrEqual(40 * 1024);
  });

  it("keeps only kill-related journal lines and caps them", async () => {
    mocks.fetchRuntimeLogPage.mockResolvedValue({
      lines: ["all fine", "oom-killer invoked", "warn: slow", "Killed process 12", "code=killed, status=9/KILL"],
      older: null,
    });
    const out = await apiGetKilledContainerLogs(reader, "p-1", 200, "7d");
    expect(mocks.fetchRuntimeLogPage).toHaveBeenCalledWith(reader.userId, "p-1", 200, "", {
      range: "7d",
      level: "problems",
    });
    expect(out.lines).toEqual(["oom-killer invoked", "Killed process 12", "code=killed, status=9/KILL"]);
    expect(out.truncated).toBe(false);

    mocks.fetchRuntimeLogPage.mockResolvedValue({ lines: Array.from({ length: 100 }, () => "OOM " + "z".repeat(1000)), older: null });
    const capped = await apiGetKilledContainerLogs(reader, "p-1", 200, "7d");
    expect(capped.truncated).toBe(true);
    expect(bytes(capped)).toBeLessThanOrEqual(40 * 1024);
  });

  it("lists and filters error groups, capping their messages at 40 KB", async () => {
    mocks.errorGroups.mockResolvedValue([
      { fingerprint: "0123456789abcdef", message: "x".repeat(100_000), file: "app.js", count: 2, firstSeen: 1, lastSeen: 2, status: "open", assigneeId: null },
      { fingerprint: "fedcba9876543210", message: "Resolved", file: "b.js", count: 1, firstSeen: 1, lastSeen: 3, status: "resolved", assigneeId: "u-1" },
    ]);
    const all = await apiListDeploymentErrors(reader, "p-1", 30, "all", 100);
    expect(mocks.errorGroups).toHaveBeenCalledWith(reader.userId, "p-1", 30);
    expect(all.groups.length).toBeGreaterThan(0);
    expect(all.groups.length).toBeLessThanOrEqual(2);
    expect(all.source).toBe("client-analytics");
    expect(all.truncated).toBe(true);
    expect(bytes(all)).toBeLessThanOrEqual(40 * 1024);

    const open = await apiListDeploymentErrors(reader, "p-1", 30, "open", 100);
    expect(open.groups.map((g) => g.fingerprint)).toEqual(["0123456789abcdef"]);
  });

  it("triages only with projects:write, auditing the change", async () => {
    mocks.changeErrorGroup.mockResolvedValue({ status: "resolved", assigneeId: null });
    expect(await apiTriageDeploymentError(writer, "p-1", "0123456789abcdef", "resolve")).toEqual({
      status: "resolved",
      assigneeId: null,
    });
    expect(mocks.tagAudit).toHaveBeenCalledWith(writer, "errors.triage", expect.any(Function));
    expect(mocks.changeErrorGroup).toHaveBeenCalledWith(writer.userId, "p-1", "0123456789abcdef", "resolve", null);
    await expect(apiTriageDeploymentError(reader, "p-1", "0123456789abcdef", "resolve")).rejects.toMatchObject({ status: 403 });
    expect(mocks.changeErrorGroup).toHaveBeenCalledTimes(1);

    await expect(apiTriageDeploymentError(writer, "p-1", "0123456789abcdef", "assign")).rejects.toMatchObject({ status: 400 });
    await expect(apiTriageDeploymentError(writer, "p-1", "ffffffffffffffff", "resolve")).rejects.toMatchObject({ status: 404 });
    expect(mocks.changeErrorGroup).toHaveBeenCalledTimes(1);
  });
});

describe("log endpoint descriptions", () => {
  it("exposes exactly the seven log tools once", () => {
    expect(LOG_ENDPOINTS.map((e) => [e.id, e.method, e.path])).toEqual([
      ["search_logs", "GET", "/projects/{projectId}/logs/search"],
      ["get_log_context", "GET", "/projects/{projectId}/logs/context"],
      ["get_build_logs", "GET", "/deployments/{deploymentId}/build-logs"],
      ["get_build_history", "GET", "/projects/{projectId}/builds"],
      ["get_killed_container_logs", "GET", "/projects/{projectId}/logs/killed"],
      ["list_deployment_errors", "GET", "/projects/{projectId}/errors"],
      ["triage_deployment_error", "POST", "/projects/{projectId}/errors/{fingerprint}"],
    ]);
    expect(new Set(LOG_ENDPOINTS.map((e) => e.id)).size).toBe(LOG_ENDPOINTS.length);
    expect(new Set(LOG_ENDPOINTS.map((e) => `${e.method} ${e.path}`)).size).toBe(LOG_ENDPOINTS.length);
    for (const ep of LOG_ENDPOINTS) expect(ep.tag, ep.id).toBe("Logs");
  });

  it("uses the right scopes and rate buckets", () => {
    expect(endpointOf("search_logs")).toMatchObject({ scope: "logs:read", bucket: "ssh", readOnly: true, untrusted: true });
    expect(endpointOf("get_log_context")).toMatchObject({ scope: "logs:read", bucket: "ssh", readOnly: true, untrusted: true });
    expect(endpointOf("get_killed_container_logs")).toMatchObject({ scope: "logs:read", bucket: "ssh", readOnly: true, untrusted: true });
    expect(endpointOf("get_build_logs")).toMatchObject({ scope: "deployments:read", bucket: "read", readOnly: true, untrusted: true });
    expect(endpointOf("get_build_history")).toMatchObject({ scope: "deployments:read", bucket: "read", readOnly: true, untrusted: true });
    expect(endpointOf("list_deployment_errors")).toMatchObject({ scope: "analytics:read", bucket: "read", readOnly: true, untrusted: true });
    expect(endpointOf("triage_deployment_error")).toMatchObject({
      scope: "projects:write",
      bucket: "write",
      status: 200,
      readOnly: false,
      destructive: false,
      untrusted: true,
    });
  });

  it("bounds every input and validates the required ids", () => {
    expect(endpointOf("search_logs").input.safeParse({ projectId: "p-1" }).success).toBe(true);
    expect(endpointOf("search_logs").input.safeParse({ projectId: "p-1", limit: 0 }).success).toBe(false);
    expect(endpointOf("get_build_logs").input.safeParse({ deploymentId: "dep-1", limit: 501 }).success).toBe(false);
    expect(endpointOf("get_build_history").input.safeParse({ projectId: "p-1", limit: 51 }).success).toBe(false);
    expect(endpointOf("get_log_context").input.safeParse({ projectId: "p-1" }).success).toBe(false);
    expect(
      endpointOf("get_log_context").input.safeParse({ projectId: "p-1", at: "2026-01-01T00:00:00.000Z" }).success
    ).toBe(true);
    expect(endpointOf("triage_deployment_error").input.safeParse({ projectId: "p-1", fingerprint: "0123456789abcdef" }).success).toBe(false);
    expect(
      endpointOf("triage_deployment_error").input.safeParse({ projectId: "p-1", fingerprint: "0123456789abcdef", action: "resolve" }).success
    ).toBe(true);
  });
});
