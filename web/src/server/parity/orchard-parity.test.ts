import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ENDPOINTS } from "@/server/api-v1";

const parityPath = new URL("./orchard-parity.json", import.meta.url);
const promotedTools = [
  ["list_github_repos", "present", "list_github_repos"],
  ["get_image_history", "partial", "list_deployments"],
  ["list_releases", "partial", "list_deployments"],
  ["list_build_runs", "partial", "list_deployments"],
  ["get_build_history", "partial", "get_deployment_logs"],
  ["update_deployment_health_check", "partial", "update_project"],
  ["enable_auto_deploy", "partial", "update_project"],
  ["disable_auto_deploy", "partial", "update_project"],
  ["get_auto_deploy_status", "partial", "get_project"],
] as const;

describe("Orchard deployment parity", () => {
  it("maps each supported Orchard tool to a registered endpoint and raises the counts", () => {
    const exists = existsSync(parityPath);
    expect(exists).toBe(true);
    if (!exists) return;

    const parity = JSON.parse(readFileSync(parityPath, "utf8")) as {
      baseline_present: number;
      baseline_partial: number;
      tools: { name: string; status: string; ours: string | null }[];
    };
    const entries = new Map(parity.tools.map((tool) => [tool.name, tool]));
    const endpointIds = new Set(ENDPOINTS.map((endpoint) => endpoint.id));

    for (const [name, status, ours] of promotedTools) {
      expect(entries.get(name), name).toMatchObject({ status, ours });
      expect(endpointIds.has(ours), `${name} -> ${ours}`).toBe(true);
    }
    expect(parity.baseline_present).toBe(23);
    expect(parity.baseline_partial).toBe(19);
    expect(parity.tools.filter((tool) => tool.status === "present")).toHaveLength(23);
    expect(parity.tools.filter((tool) => tool.status === "partial")).toHaveLength(19);
  });
});
