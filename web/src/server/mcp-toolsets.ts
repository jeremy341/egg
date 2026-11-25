import type { Principal } from "@/server/api-tokens";
import { HttpError } from "@/server/http";
import type { Endpoint } from "@/server/api-v1";

/**
 * Which MCP tools a connection sees. Three things narrow the list, and none of
 * them can widen it:
 *
 * - the token's own scopes (a tool the token cannot run is not listed, and a call
 *   to it is refused as unknown);
 * - `?toolsets=a,b` picks groups of tools; `core` is always included, and leaving
 *   the parameter out means every group;
 * - `?scope=read` keeps only tools that change nothing, and `?scope=deploy` adds
 *   deployment changes to those and nothing else.
 *
 * The server checks all of this again on every call, so a client that ignores the
 * list still gets nothing it could not get from its token.
 */

export const TOOLSETS = [
  "core",
  "deployments",
  "logs",
  "env",
  "projects",
  "domains",
  "hooks",
  "jobs",
  "notifications",
  "alerts",
  "servers",
  "analytics",
  "activity",
  "terminal",
  "files",
] as const;
export type Toolset = (typeof TOOLSETS)[number];

/** Every endpoint belongs to exactly one toolset. A test checks that none is left out. */
export const TOOLSET_OF: Record<string, Toolset> = {
  get_me: "core",
  find: "core",
  list_projects: "core",
  get_project: "core",
  get_deployment: "core",
  diagnose_deployment: "core",
  get_deployment_next_steps: "core",
  get_github_status: "core",
  list_github_repos: "core",

  list_deployments: "deployments",
  get_deployment_metrics: "deployments",
  get_rollout: "deployments",
  create_project: "deployments",
  deploy_branch: "deployments",
  deploy_from_github_url: "deployments",
  redeploy: "deployments",
  cancel_deployment: "deployments",
  rollback_deployment: "deployments",
  restart_service: "deployments",
  list_deployment_errors: "deployments",
  triage_deployment_error: "deployments",

  get_logs: "logs",
  get_deployment_logs: "logs",
  get_log_context: "logs",
  search_logs: "logs",

  list_env_vars: "env",
  get_env_vars: "env",
  set_env_var: "env",
  set_env_var_secret: "env",
  delete_env_var: "env",
  add_env_vars: "env",
  set_env_vars: "env",
  delete_env_vars: "env",
  list_environments: "env",
  create_environment: "env",
  rename_environment: "env",
  delete_environment: "env",
  set_default_environment: "env",
  get_shared_env_vars: "env",
  add_shared_env_vars: "env",
  set_shared_env_vars: "env",
  delete_shared_env_vars: "env",

  update_project: "projects",
  delete_project: "projects",

  list_domains: "domains",
  add_domain: "domains",
  verify_domain: "domains",
  remove_domain: "domains",

  rotate_deploy_hook: "hooks",
  revoke_deploy_hook: "hooks",
  list_deploy_webhook_tokens: "hooks",

  get_alerts: "alerts",
  get_notifications: "alerts",
  test_notification: "alerts",

  create_job: "jobs",
  list_jobs: "jobs",
  get_job: "jobs",
  update_job: "jobs",
  run_job: "jobs",
  list_job_runs: "jobs",
  get_job_run_logs: "jobs",
  delete_job: "jobs",

  list_notification_channels: "notifications",
  create_notification_channel: "notifications",
  list_notification_rules: "notifications",
  create_notification_rule: "notifications",
  test_notification_channel: "notifications",

  list_servers: "servers",
  get_server_usage: "servers",
  get_project_resources: "servers",
  get_resource_history: "servers",
  get_container_inventory: "servers",

  get_analytics: "analytics",
  get_status_page: "analytics",

  get_activity: "activity",

  terminal_status: "terminal",
  terminal_open: "terminal",
  terminal_send: "terminal",
  terminal_read: "terminal",
  terminal_resize: "terminal",
  terminal_close: "terminal",

  list_files: "files",
  read_file: "files",
  download_file: "files",
  write_file: "files",
  make_folder: "files",
  rename_file: "files",
  delete_file: "files",

  // Endpoints added in the second parity pass.
  get_audit_log: "activity",
  list_registry_credentials: "env",
  set_registry_credential: "env",
  delete_registry_credential: "env",
  start_deployment: "deployments",
  stop_deployment: "deployments",
  restart_deployment: "deployments",
  scale_deployment: "deployments",
  get_volumes: "deployments",
  get_job_run: "jobs",
  cancel_job_run: "jobs",
  replace_job_steps: "jobs",
  get_build_logs: "logs",
  get_build_history: "logs",
  get_killed_container_logs: "logs",
  get_repo_branches: "core",
  get_repo_contents: "core",
  get_repo_dockerfiles: "core",
  detect_repo_config: "core",
  list_github_deploy_targets: "core",
  get_notification_channel: "notifications",
  update_notification_channel: "notifications",
  delete_notification_channel: "notifications",
  update_notification_rule: "notifications",
  delete_notification_rule: "notifications",
  list_notification_deliveries: "notifications",
  replay_notification_channel: "notifications",
  get_auto_deploy_status: "deployments",
  enable_auto_deploy: "deployments",
  disable_auto_deploy: "deployments",
  get_ingress: "domains",
  update_ingress: "domains",
  get_ingress_protection: "domains",
  set_ingress_protection: "domains",

  // Third parity pass.
  list_services: "deployments",
  update_deployment_github_repo: "deployments",
  create_service: "deployments",
  update_service: "domains",
  delete_service: "deployments",
  set_service_exposure: "domains",
  set_service_port_public: "domains",
  create_deployment: "deployments",
  delete_deployment: "deployments",
  rename_deployment: "deployments",
  retry_deployment_apply: "deployments",
  update_deployment_build_config: "deployments",
  update_deployment_health_check: "deployments",
  update_deployment_image: "deployments",
  update_deployment_pull_policy: "deployments",
  update_deployment_resources: "deployments",
  update_deployment_strategy: "deployments",
  update_deployment_volumes: "deployments",
  get_compose_stack: "deployments",
  list_compose_stacks: "deployments",
  list_compose_releases: "deployments",
  list_releases: "deployments",
  analyze_deployment_resources: "deployments",
  get_deployment_volumes: "deployments",
  redeploy_compose_stack: "deployments",
  list_organizations: "core",
  get_organization: "core",
  get_image_history: "logs",
  list_build_runs: "logs",
  get_deploy_verdict: "deployments",
  get_deployment_http_metrics: "analytics",
  get_request_stats: "analytics",
  get_anomalies: "alerts",
  get_attack_signals: "alerts",
  get_resource_recommendation: "servers",
  get_observability_link: "analytics",
};

/**
 * Tools whose result carries a secret that is shown once. Marked in the tool list
 * with `_meta: { "egg/sensitive": true }` so a client can keep the result out of
 * logs and transcripts. Deploy-hook URLs and webhook signing secrets cannot be
 * read again after creation or rotation.
 */
export const SENSITIVE_TOOLS: ReadonlySet<string> = new Set(["rotate_deploy_hook", "create_notification_channel"]);

export const SCOPE_LEVELS = ["full", "read", "deploy"] as const;
export type ScopeLevel = (typeof SCOPE_LEVELS)[number];

export type McpView = {
  /** Null means every toolset. */
  toolsets: ReadonlySet<Toolset> | null;
  level: ScopeLevel;
};

export const FULL_VIEW: McpView = { toolsets: null, level: "full" };

/**
 * The view a request's query string asks for. Unknown toolset or scope names are
 * a 400, so a typo cannot silently show more or fewer tools than intended.
 */
export function parseMcpView(url: URL): McpView {
  const rawSets = url.searchParams.get("toolsets");
  const rawLevel = url.searchParams.get("scope");

  let toolsets: ReadonlySet<Toolset> | null = null;
  if (rawSets !== null) {
    const names = rawSets.split(",").map((s) => s.trim()).filter((s) => s !== "");
    const chosen = new Set<Toolset>(["core"]);
    for (const name of names) {
      if (!(TOOLSETS as readonly string[]).includes(name)) {
        throw new HttpError(400, `Unknown toolset "${name.slice(0, 40)}". Choose from: ${TOOLSETS.join(", ")}.`, "validation");
      }
      chosen.add(name as Toolset);
    }
    toolsets = chosen;
  }

  let level: ScopeLevel = "full";
  if (rawLevel !== null) {
    if (!(SCOPE_LEVELS as readonly string[]).includes(rawLevel)) {
      throw new HttpError(400, `Unknown scope "${rawLevel.slice(0, 40)}". Use read or deploy.`, "validation");
    }
    level = rawLevel as ScopeLevel;
  }
  return { toolsets, level };
}

/** Whether the connection's view (toolsets and scope level) includes this endpoint. */
export function viewAllows(ep: Endpoint, view: McpView): boolean {
  const set = TOOLSET_OF[ep.id];
  if (set === undefined) return false;
  if (view.toolsets !== null && !view.toolsets.has(set)) return false;

  if (view.level === "read") return ep.readOnly;
  if (view.level === "deploy") return ep.readOnly || ep.scope === "deployments:write";
  return true;
}

/** Whether the endpoint is listed: the token must cover its scope AND the view must include it. */
export function endpointVisible(p: Principal, ep: Endpoint, view: McpView): boolean {
  if (ep.scope !== null && !p.scopes.includes(ep.scope)) return false;
  return viewAllows(ep, view);
}
