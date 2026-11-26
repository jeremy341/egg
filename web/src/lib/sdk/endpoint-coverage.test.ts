import { describe, expect, it } from "vitest";
import { ENDPOINTS } from "@/server/api-v1";
import { Egg, type FetchInit, type FetchLike } from "./egg";

/**
 * The typed client must reach every endpoint of the public API. The server's own
 * list (`ENDPOINTS`, the one behind the HTTP routes, the OpenAPI document and the
 * MCP tools) is the source of truth: add an endpoint there and this file fails
 * until the client has a method for it and it is listed below.
 */

type Call = { url: string; init: FetchInit };

const PARAMS: Record<string, string> = {
  projectId: "P",
  deploymentId: "D",
  environmentId: "ENV",
  serverId: "S",
  domainId: "DOM",
  sessionId: "SESS",
  key: "KEY",
  webhookId: "HOOK",
  credentialId: "CRED",
  runId: "RUN",
  channelId: "HOOK",
  ruleId: "RULE",
  deliveryId: "DEL",
  serviceId: "SVC",
  orgId: "ORG",
  fingerprint: "FP",
  jobId: "JOB",
};

function recorder() {
  const calls: Call[] = [];
  const fetch: FetchLike = async (url, init) => {
    calls.push({ url, init });
    return { ok: true, status: 200, headers: { get: () => null }, text: async () => "{}" };
  };
  return { fetch, calls, nest: new Egg({ token: "egg_testtesttest", baseUrl: "https://x.test", fetch }) };
}

type Call$ = (nest: Egg) => Promise<unknown>;

/** One call per endpoint id. A new endpoint without a line here fails the test below. */
const CLIENT_CALLS: Record<string, Call$> = {
  get_me: (n) => n.me(),
  list_projects: (n) => n.listProjects(),
  get_project: (n) => n.getProject("P"),
  create_project: (n) =>
    n.createProject({ serverId: "S", name: "App", repoUrl: "https://github.com/a/b.git", runtime: "node", port: 3000 }),
  update_project: (n) => n.updateProject("P", { autoDeploy: false }),
  delete_project: (n) => n.deleteProject("P"),
  list_deployments: (n) => n.listDeployments("P"),
  deploy_branch: (n) => n.deploy("P"),
  redeploy: (n) => n.redeploy("D"),
  cancel_deployment: (n) => n.cancelDeployment("D"),
  rollback_deployment: (n) => n.rollback("D"),
  get_rollout: (n) => n.rollout("D", { wait: true }),
  restart_service: (n) => n.restartService("P"),
  get_deployment: (n) => n.getDeployment("D"),
  get_deployment_metrics: (n) => n.getDeploymentMetrics("D", { window: 12, bucket: 15 }),
  get_deployment_logs: (n) => n.getDeploymentLogs("D"),
  list_releases: (n) => n.listReleases("P"),
  analyze_deployment_resources: (n) => n.analyzeDeploymentResources("D"),
  get_deployment_volumes: (n) => n.getDeploymentVolumes("D"),
  get_logs: (n) => n.getLogs("P"),
  list_domains: (n) => n.listDomains(),
  add_domain: (n) => n.addDomain({ serverId: "S", domain: "app.example.com", port: 3000, projectId: "P" }),
  verify_domain: (n) => n.verifyDomain("DOM"),
  remove_domain: (n) => n.removeDomain("DOM"),
  get_server_usage: (n) => n.getServerUsage("S"),
  get_resource_history: (n) => n.getUsageHistory("S"),
  get_project_resources: (n) => n.getProjectResources("P"),
  list_servers: (n) => n.listServers(),
  get_container_inventory: (n) => n.getContainerInventory("S"),
  list_env_vars: (n) => n.listEnvNames("P"),
  set_env_var: (n) => n.setEnvVar("P", "KEY", { value: "v" }),
  delete_env_var: (n) => n.deleteEnvVar("P", "KEY"),
  rotate_deploy_hook: (n) => n.rotateDeployHook("P"),
  revoke_deploy_hook: (n) => n.revokeDeployHook("P"),
  get_notifications: (n) => n.getNotifications("P"),
  test_notification: (n) => n.testNotification("P"),
  get_alerts: (n) => n.getAlerts("P"),
  get_status_page: (n) => n.getStatusPage("P"),
  get_analytics: (n) => n.getAnalytics("P"),
  get_activity: (n) => n.getActivity(),
  terminal_status: (n) => n.terminalStatus("P"),
  terminal_open: (n) => n.terminalOpen("P"),
  terminal_send: (n) => n.terminalSend("P", "SESS", "ls\n"),
  terminal_read: (n) => n.terminalRead("P", "SESS"),
  terminal_resize: (n) => n.terminalResize("P", "SESS", { cols: 100, rows: 30 }),
  terminal_close: (n) => n.terminalClose("P", "SESS"),
  list_files: (n) => n.listFiles("P"),
  read_file: (n) => n.readFile("P", "shared/a.txt"),
  download_file: (n) => n.downloadFile("P", "shared/a.bin"),
  write_file: (n) => n.writeFile("P", { path: "shared/a.txt", content: "hi" }),
  make_folder: (n) => n.makeFolder("P", "shared/new"),
  rename_file: (n) => n.renameFile("P", { from: "shared/a", to: "shared/b" }),
  delete_file: (n) => n.deleteFile("P", "shared/a"),
  get_audit_log: (n) => n.getAuditLog(),
  list_registry_credentials: (n) => n.listRegistryCredentials(),
  set_registry_credential: (n) => n.setRegistryCredential({ host: "ghcr.io" }),
  delete_registry_credential: (n) => n.deleteRegistryCredential("CRED", { confirmName: "ghcr.io" }),
  start_deployment: (n) => n.startDeployment("D"),
  stop_deployment: (n) => n.stopDeployment("D"),
  restart_deployment: (n) => n.restartDeployment("D"),
  scale_deployment: (n) => n.scaleDeployment("D", { memoryMb: 512 }),
  get_volumes: (n) => n.getVolumes("D"),
  get_job_run: (n) => n.getJobRun("P", "JOB", "RUN"),
  cancel_job_run: (n) => n.cancelJobRun("P", "JOB", "RUN"),
  replace_job_steps: (n) => n.replaceJobSteps("P", "JOB", { steps: [] }),
  get_build_logs: (n) => n.getBuildLogs("D"),
  get_build_history: (n) => n.getBuildHistory("P"),
  get_killed_container_logs: (n) => n.getKilledContainerLogs("P"),
  get_repo_branches: (n) => n.getRepoBranches(),
  get_repo_contents: (n) => n.getRepoContents(),
  get_repo_dockerfiles: (n) => n.getRepoDockerfiles(),
  detect_repo_config: (n) => n.detectRepoConfig(),
  list_github_deploy_targets: (n) => n.listGithubDeployTargets(),
  get_notification_channel: (n) => n.getNotificationChannel("HOOK"),
  update_notification_channel: (n) => n.updateNotificationChannel("HOOK", {}),
  delete_notification_channel: (n) => n.deleteNotificationChannel("HOOK", "hooks.example.com"),
  update_notification_rule: (n) => n.updateNotificationRule("HOOK", "RULE", {}),
  delete_notification_rule: (n) => n.deleteNotificationRule("HOOK", "RULE"),
  list_notification_deliveries: (n) => n.listNotificationDeliveries("HOOK"),
  replay_notification_channel: (n) => n.replayNotificationChannel("HOOK", "DEL"),
  get_auto_deploy_status: (n) => n.getAutoDeployStatus("P"),
  enable_auto_deploy: (n) => n.enableAutoDeploy("P"),
  disable_auto_deploy: (n) => n.disableAutoDeploy("P"),
  get_ingress: (n) => n.getIngress("DOM"),
  update_ingress: (n) => n.updateIngress("DOM", {}),
  get_ingress_protection: (n) => n.getIngressProtection("DOM"),
  set_ingress_protection: (n) => n.setIngressProtection("DOM", {}),
  find: (n) => n.find("demo"),
  search_logs: (n) => n.searchLogs("P", "error"),
  get_log_context: (n) => n.getLogContext("P", 1),
  list_deployment_errors: (n) => n.listDeploymentErrors("P"),
  triage_deployment_error: (n) => n.triageDeploymentError("P", "FP", {}),
  diagnose_deployment: (n) => n.diagnoseDeployment("D"),
  get_deployment_next_steps: (n) => n.getDeploymentNextSteps("D"),
  list_github_repos: (n) => n.listGithubRepos(),
  get_github_status: (n) => n.getGithubStatus("P"),
  add_env_vars: (n) => n.addEnvVars("P", { variables: [] }),
  set_env_vars: (n) => n.setEnvVars("P", { variables: [] }),
  delete_env_vars: (n) => n.deleteEnvVars("P", { keys: [] }),
  list_deploy_webhook_tokens: (n) => n.listDeployWebhookTokens("P"),
  list_jobs: (n) => n.listJobs("P"),
  get_job: (n) => n.getJob("P", "JOB"),
  create_job: (n) => n.createJob("P", {}),
  update_job: (n) => n.updateJob("P", "JOB", {}),
  run_job: (n) => n.runJob("P", "JOB"),
  list_job_runs: (n) => n.listJobRuns("P", "JOB"),
  get_job_run_logs: (n) => n.getJobRunLogs("P", "JOB", "RUN"),
  delete_job: (n) => n.deleteJob("P", "JOB"),
  list_notification_channels: (n) => n.listNotificationChannels(),
  create_notification_channel: (n) => n.createNotificationChannel({}),
  list_notification_rules: (n) => n.listNotificationRules(),
  create_notification_rule: (n) => n.createNotificationRule("HOOK", {}),
  test_notification_channel: (n) => n.testNotificationChannel("HOOK"),
  create_deployment: (n) => n.createDeployment({}),
  delete_deployment: (n) => n.deleteDeployment("D"),
  rename_deployment: (n) => n.renameDeployment("D", { name: "App" }),
  retry_deployment_apply: (n) => n.retryDeploymentApply("D"),
  update_deployment_build_config: (n) => n.updateDeploymentBuildConfig("D", {}),
  update_deployment_health_check: (n) => n.updateDeploymentHealthCheck("D", {}),
  update_deployment_image: (n) => n.updateDeploymentImage("D", {}),
  update_deployment_pull_policy: (n) => n.updateDeploymentPullPolicy("D", {}),
  update_deployment_resources: (n) => n.updateDeploymentResources("D", {}),
  update_deployment_strategy: (n) => n.updateDeploymentStrategy("D", {}),
  update_deployment_volumes: (n) => n.updateDeploymentVolumes("D", {}),
  update_deployment_github_repo: (n) => n.updateDeploymentGithubRepo("D", {}),
  list_services: (n) => n.listServices(),
  update_service: (n) => n.updateService("SVC", {}),
  list_environments: (n) => n.listEnvironments(),
  create_environment: (n) => n.createEnvironment({}),
  rename_environment: (n) => n.renameEnvironment("ENV", {}),
  delete_environment: (n) => n.deleteEnvironment("ENV", "Staging"),
  set_default_environment: (n) => n.setDefaultEnvironment("ENV"),
  get_shared_env_vars: (n) => n.getSharedEnvVars("ENV"),
  add_shared_env_vars: (n) => n.addSharedEnvVars("ENV", {}),
  set_shared_env_vars: (n) => n.setSharedEnvVars("ENV", {}),
  delete_shared_env_vars: (n) => n.deleteSharedEnvVars("ENV", {}),
  create_service: (n) => n.createService({}),
  delete_service: (n) => n.deleteService("SVC"),
  set_service_exposure: (n) => n.setServiceExposure("SVC", {}),
  set_service_port_public: (n) => n.setServicePortPublic("SVC", {}),
  get_compose_stack: (n) => n.getComposeStack("P"),
  list_compose_stacks: (n) => n.listComposeStacks(),
  list_compose_releases: (n) => n.listComposeReleases("P"),
  redeploy_compose_stack: (n) => n.redeployComposeStack("P"),
  list_organizations: (n) => n.listOrganizations(),
  get_organization: (n) => n.getOrganization("ORG"),
  get_image_history: (n) => n.getImageHistory("P"),
  list_build_runs: (n) => n.listBuildRuns("P"),
  get_deploy_verdict: (n) => n.getDeployVerdict("D"),
  get_deployment_http_metrics: (n) => n.getDeploymentHttpMetrics("D"),
  get_request_stats: (n) => n.getRequestStats("P"),
  get_anomalies: (n) => n.getAnomalies("P"),
  get_attack_signals: (n) => n.getAttackSignals("P"),
  get_resource_recommendation: (n) => n.getResourceRecommendation("P"),
  get_observability_link: (n) => n.getObservabilityLink("P"),};

function expectedPath(template: string): string {
  return template.replace(/\{([^}]+)\}/g, (_, name: string) => {
    const value = PARAMS[name];
    if (!value) throw new Error(`Add a sample value for the path parameter {${name}} to PARAMS.`);
    return value;
  });
}

describe("the typed client covers the whole public API", () => {
  it("has a client call for every endpoint, and none for an endpoint that is gone", () => {
    const ids = ENDPOINTS.map((e) => e.id).sort();
    expect(Object.keys(CLIENT_CALLS).sort()).toEqual(ids);
  });

  it.each(ENDPOINTS.map((e) => [e.id, e.method, e.path] as const))("%s uses %s %s", async (id, method, path) => {
    const call = CLIENT_CALLS[id];
    expect(call, `The client has no method for ${id}`).toBeTypeOf("function");
    const { nest, calls } = recorder();
    await call(nest);
    expect(calls).toHaveLength(1);
    expect(calls[0].init.method).toBe(method);
    expect(new URL(calls[0].url).pathname).toBe(`/api/v1${expectedPath(path)}`);
  });
});

describe("request bodies and queries of the newer calls", () => {
  it("sends the channel host as confirmName when deleting a notification channel", async () => {
    const { nest, calls } = recorder();
    await nest.deleteNotificationChannel("HOOK", "hooks.example.com");
    expect(calls[0].init.method).toBe("DELETE");
    expect(JSON.parse(calls[0].init.body!)).toEqual({ confirmName: "hooks.example.com" });
  });

  it("sends the body of create, update, env and file calls as JSON", async () => {
    const { nest, calls } = recorder();
    await nest.setEnvVar("P", "A B", { value: "secret", target: "preview" });
    await nest.writeFile("P", { path: "shared/a.txt", content: "hi", overwrite: true });
    await nest.updateProject("P", { port: 4000 });
    await nest.terminalOpen("P", { cols: 120, rows: 40 });
    expect(calls[0].url).toBe("https://x.test/api/v1/projects/P/env/A%20B");
    expect(JSON.parse(calls[0].init.body!)).toEqual({ value: "secret", target: "preview" });
    expect(JSON.parse(calls[1].init.body!)).toEqual({ path: "shared/a.txt", content: "hi", overwrite: true });
    expect(JSON.parse(calls[2].init.body!)).toEqual({ port: 4000 });
    expect(JSON.parse(calls[3].init.body!)).toEqual({ cols: 120, rows: 40 });
  });

  it("sends flags and paths as query strings, and leaves out what was not given", async () => {
    const { nest, calls } = recorder();
    await nest.deleteProject("P");
    await nest.deleteProject("P", { removeFromServer: true });
    await nest.deleteEnvVar("P", "KEY", { target: "production" });
    await nest.deleteFile("P", "shared/dir", { recursive: true });
    await nest.listFiles("P", { path: "shared" });
    await nest.terminalRead("P", "SESS", { since: 12 });
    expect(calls.map((c) => c.url.replace("https://x.test/api/v1", ""))).toEqual([
      "/projects/P",
      "/projects/P?removeFromServer=true",
      "/projects/P/env/KEY?target=production",
      "/projects/P/files?path=shared%2Fdir&recursive=true",
      "/projects/P/files?path=shared",
      "/projects/P/terminal/SESS/output?since=12",
    ]);
  });
});


