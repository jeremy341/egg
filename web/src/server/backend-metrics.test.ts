import { afterEach, expect, it } from "vitest";
import { backendMetricsSnapshot, measureBackendRequest, recordBackendQuery } from "@/server/backend-metrics";
afterEach(() => { delete process.env.EGG_BACKEND_METRICS; });
it("counts statements per request without retaining SQL or resource identifiers", async () => {
  process.env.EGG_BACKEND_METRICS = "1";
  await measureBackendRequest("/api/projects/private-id", async () => { recordBackendQuery(); recordBackendQuery(); });
  const result = backendMetricsSnapshot();
  expect(result.routes.find((r) => r.family === "/api/projects")).toMatchObject({ requests: 1, queries: 2 });
  expect(JSON.stringify(result)).not.toContain("private-id");
});
