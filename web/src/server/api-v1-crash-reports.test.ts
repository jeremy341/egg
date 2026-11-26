import { describe, expect, it } from "vitest";
import { ENDPOINTS } from "@/server/api-v1";

describe("crash report endpoints", () => {
  it("registers the bounded project list and crash detail paths", () => {
    const endpoints = ENDPOINTS.filter((endpoint) => endpoint.id.includes("crash_report"));

    expect(endpoints.map(({ id, method, path, scope }) => ({ id, method, path, scope }))).toEqual([
      { id: "list_crash_reports", method: "GET", path: "/projects/{projectId}/crash-reports", scope: "logs:read" },
      { id: "get_crash_report", method: "GET", path: "/crash-reports/{crashId}", scope: "logs:read" },
    ]);
  });
});
