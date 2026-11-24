import { describe, expect, it } from "vitest";
import { ENDPOINTS } from "@/server/api-v1";
import parity from "./orchard-parity.json";

const endpointById = new Map(ENDPOINTS.map((endpoint) => [endpoint.id, endpoint]));

describe("Orchard endpoint parity", () => {
  it("keeps the present and partial baselines in sync with the manifest", () => {
    const present = parity.tools.filter((tool) => tool.status === "present").length;
    const partial = parity.tools.filter((tool) => tool.status === "partial").length;
    expect(parity.baseline_present).toBe(present);
    expect(parity.baseline_partial).toBe(partial);
  });

  it("maps every supported configuration, job, and notification tool to a registry endpoint", () => {
    const names = [
      "add_env_vars",
      "set_env_vars",
      "delete_env_vars",
      "get_env_vars",
      "create_deploy_webhook_token",
      "list_deploy_webhook_tokens",
      "delete_deploy_webhook_token",
      "delete_project",
      "create_job",
      "list_jobs",
      "get_job",
      "update_job",
      "run_job",
      "list_job_runs",
      "get_job_run_logs",
      "delete_job",
      "list_notification_channels",
      "create_notification_channel",
      "list_notification_rules",
      "create_notification_rule",
      "test_notification_channel",
    ];

    for (const name of names) {
      const tool = parity.tools.find((entry) => entry.name === name);
      expect(tool, name).toBeDefined();
      expect(tool!.status, name).not.toBe("missing");
      expect(tool!.ours, name).toBeTruthy();
      expect(endpointById.has(tool!.ours!), name).toBe(true);
      expect(endpointById.get(tool!.ours!)?.scope, name).not.toBeNull();
    }
  });

  it("requires exact-name confirmation for destructive endpoint mappings", () => {
    for (const name of [
      "set_env_vars",
      "delete_env_vars",
      "delete_project",
      "create_deploy_webhook_token",
      "delete_deploy_webhook_token",
      "delete_job",
      "run_job",
    ]) {
      const tool = parity.tools.find((entry) => entry.name === name)!;
      const endpoint = endpointById.get(tool.ours!)!;
      expect(endpoint.input.shape, name).toHaveProperty("confirmName");
    }
  });

  it("keeps secret-bearing endpoint responses out of idempotent replay", () => {
    for (const id of ["add_env_vars", "set_env_vars", "rotate_deploy_hook", "create_notification_channel"]) {
      expect(endpointById.get(id)?.sensitive, id).toBe(true);
    }
  });

  it("records unsupported deployment deletion and job cancellation as missing", () => {
    for (const name of ["delete_deployment", "cancel_job_run"]) {
      const tool = parity.tools.find((entry) => entry.name === name);
      expect(tool?.status, name).toBe("missing");
      expect(tool?.ours, name).toBeNull();
    }
  });
});
