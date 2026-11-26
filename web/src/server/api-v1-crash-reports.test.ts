import { describe, expect, it } from "vitest";
import { ENDPOINTS } from "@/server/api-v1";
import { TOOLSET_OF } from "@/server/mcp-toolsets";

describe("crash report endpoints", () => {
  it("registers the bounded project list and crash detail paths", () => {
    const endpoints = ENDPOINTS.filter((endpoint) => endpoint.id.includes("crash_report"));

    expect(endpoints.map(({ id, method, path, scope }) => ({ id, method, path, scope }))).toEqual([
      { id: "list_crash_reports", method: "GET", path: "/projects/{projectId}/crash-reports", scope: "logs:read" },
      { id: "get_crash_report", method: "GET", path: "/crash-reports/{crashId}", scope: "logs:read" },
    ]);

    const list = ENDPOINTS.find((endpoint) => endpoint.id === "list_crash_reports");
    const get = ENDPOINTS.find((endpoint) => endpoint.id === "get_crash_report");
    expect(list).toMatchObject({ scope: "logs:read", bucket: "read", readOnly: true, untrusted: true });
    expect(get).toMatchObject({ scope: "logs:read", bucket: "read", readOnly: true, untrusted: true });
    expect(list?.input.safeParse({ projectId: "P", limit: 50 }).success).toBe(true);
    expect(list?.input.safeParse({ projectId: "P", limit: 51 }).success).toBe(false);
    expect(get?.input.safeParse({ crashId: "CRASH" }).success).toBe(true);
    expect(TOOLSET_OF.list_crash_reports).toBe("logs");
    expect(TOOLSET_OF.get_crash_report).toBe("logs");
  });
});
