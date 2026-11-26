import { describe, expect, it } from "vitest";
import { buildAgentSpec, buildOpenApi } from "@/server/api-v1-openapi";
import { ENDPOINTS } from "@/server/api-v1";
import { GET as agentSpecRoute } from "@/app/api/v1/agent-spec.json/route";
import { GET as openapiRoute } from "@/app/api/v1/openapi.json/route";

type Op = { operationId: string; method: string; path: string; summary: string; parameters: unknown[] };

describe("the trimmed agent spec", () => {
  it("is valid JSON served as JSON, with one operation per endpoint and no schemas", async () => {
    const res = agentSpecRoute();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    const text = await res.text();
    const spec = JSON.parse(text) as { operations: Op[] };
    const ids = spec.operations.map((o) => o.operationId).sort();
    expect(ids).toEqual(ENDPOINTS.map((e) => e.id).sort());
    for (const op of spec.operations) {
      expect(Object.keys(op).sort()).toEqual(["method", "operationId", "parameters", "path", "summary"]);
      expect(op.summary.length).toBeGreaterThan(0);
    }
    expect(text).not.toContain("components");
    expect(text).not.toContain('"requestBody"');
  });

  it("keeps the parameters of each operation exactly as the full document has them", () => {
    const full = buildOpenApi() as { paths: Record<string, Record<string, { operationId: string; parameters?: unknown[] }>> };
    const fullOps = new Map<string, unknown[]>();
    for (const methods of Object.values(full.paths)) {
      for (const op of Object.values(methods)) fullOps.set(op.operationId, op.parameters ?? []);
    }
    const spec = buildAgentSpec() as { operations: Op[] };
    for (const op of spec.operations) {
      if (op.operationId === "get_openapi") continue;
      expect(op.parameters, op.operationId).toEqual(fullOps.get(op.operationId) ?? []);
    }
  });

  it("is smaller than the full OpenAPI document, by a wide margin", async () => {
    const trimmed = await agentSpecRoute().text();
    const full = await openapiRoute().text();
    expect(trimmed.length).toBeLessThan(full.length / 2);
  });
});
