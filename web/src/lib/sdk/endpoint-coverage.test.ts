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
  serverId: "S",
  domainId: "DOM",
  sessionId: "SESS",
  key: "KEY",
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
  get_deployment: (n) => n.getDeployment("D"),
  get_deployment_logs: (n) => n.getDeploymentLogs("D"),
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
};

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
