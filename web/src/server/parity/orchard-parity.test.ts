import { describe, expect, it } from "vitest";
import { ENDPOINTS } from "@/server/api-v1";
import parity from "./orchard-parity.json";

type Status = "present" | "partial" | "missing";
type Tool = { name: string; status: Status; ours: string | null; note?: string };
const tools = parity.tools as Tool[];
const endpoints = new Set(ENDPOINTS.map((endpoint) => endpoint.id));
const entry = (name: string) => {
  const found = tools.find((tool) => tool.name === name);
  if (!found) throw new Error(`Missing Orchard parity entry: ${name}`);
  return found;
};

describe("Orchard query and observability parity", () => {
  it("keeps the baseline counts in sync and every mapped tool points at a registered endpoint", () => {
    expect(tools.filter((tool) => tool.status === "present")).toHaveLength(parity.baseline_present);
    expect(tools.filter((tool) => tool.status === "partial")).toHaveLength(parity.baseline_partial);
    for (const tool of tools) {
      if (tool.status === "missing") expect(tool.ours, tool.name).toBeNull();
    }
    for (const name of [
      "get_deployment_logs", "search_logs", "get_log_context", "list_deployment_errors",
      "triage_deployment_error", "get_anomalies", "get_changes", "get_build_logs",
      "get_deployment_metrics", "analyze_deployment_resources",
    ]) {
      const tool = entry(name);
      expect(tool.ours, name).toBeTruthy();
      expect(endpoints.has(tool.ours!), `${name} -> ${tool.ours}`).toBe(true);
    }
  });

  it("records the supported query and observability mappings with their limits", () => {
    expect(Object.fromEntries([
      "get_deployment_logs",
      "search_logs",
      "get_log_context",
      "list_deployment_errors",
      "triage_deployment_error",
      "get_anomalies",
      "get_changes",
      "get_deploy_verdict",
      "get_resource_recommendation",
      "get_build_logs",
      "list_killed_containers",
      "get_killed_container_logs",
      "get_deployment_metrics",
      "analyze_deployment_resources",
    ].map((name) => {
      const tool = entry(name);
      return [name, { status: tool.status, ours: tool.ours }];
    }))).toEqual({
      get_deployment_logs: { status: "present", ours: "get_logs" },
      search_logs: { status: "partial", ours: "search_logs" },
      get_log_context: { status: "partial", ours: "get_log_context" },
      list_deployment_errors: { status: "partial", ours: "list_deployment_errors" },
      triage_deployment_error: { status: "partial", ours: "triage_deployment_error" },
      get_anomalies: { status: "partial", ours: "get_alerts" },
      get_changes: { status: "partial", ours: "get_activity" },
      get_deploy_verdict: { status: "missing", ours: null },
      get_resource_recommendation: { status: "missing", ours: null },
      get_build_logs: { status: "partial", ours: "get_deployment_logs" },
      list_killed_containers: { status: "missing", ours: null },
      get_killed_container_logs: { status: "missing", ours: null },
      get_deployment_metrics: { status: "partial", ours: "get_project_resources" },
      analyze_deployment_resources: { status: "partial", ours: "get_project_resources" },
    });
    expect(entry("search_logs").note).toMatch(/one-service/);
    expect(entry("get_log_context").note).toMatch(/one service journal/);
  });

  it("skips request-level statistics when there is no ingress access-log store", () => {
    expect(entry("get_request_stats")).toMatchObject({ status: "missing", ours: null });
    expect(entry("get_request_stats").note).toMatch(/no ingress access-log store/);
  });
});
