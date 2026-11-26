import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ENDPOINTS } from "@/server/api-v1";

const parity = JSON.parse(readFileSync(new URL("./orchard-parity.json", import.meta.url), "utf8")) as {
  baseline_present: number;
  baseline_partial: number;
  tools: { name: string; status: string; ours: string | null }[];
};

const byName = new Map(parity.tools.map((tool) => [tool.name, tool]));
const endpointIds = new Set(ENDPOINTS.map((endpoint) => endpoint.id));

describe("Orchard core parity", () => {
  it("keeps the manifest baselines equal to its current classifications", () => {
    expect(parity.tools.filter((tool) => tool.status === "present")).toHaveLength(parity.baseline_present);
    expect(parity.tools.filter((tool) => tool.status === "partial")).toHaveLength(parity.baseline_partial);
  });

  it("maps supported core tools to registered endpoints and leaves unsupported tools missing", () => {
    for (const name of ["diagnose_deployment", "get_deployment_next_steps", "find", "get_github_status"]) {
      const tool = byName.get(name);
      expect(tool, name).toMatchObject({ status: "partial", ours: name });
      expect(endpointIds.has(tool!.ours!), name).toBe(true);
    }

    expect(byName.get("get_resource_quota")).toMatchObject({ status: "partial", ours: "get_project_resources" });
    expect(byName.get("get_observability_link")).toMatchObject({ status: "missing", ours: null });
    expect(byName.get("get_current_user")).toMatchObject({ status: "present", ours: "get_me" });
    expect(endpointIds.has("get_me")).toBe(true);
    expect(ENDPOINTS.filter((endpoint) => endpoint.id === "get_me")).toHaveLength(1);
  });
});
