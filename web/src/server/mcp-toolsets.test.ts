import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { createApiToken, type Principal, type Scope } from "@/server/api-tokens";
import { ENDPOINTS } from "@/server/api-v1";
import { upsertUser } from "@/server/auth/session";
import { handleMcpMessage, TOOLS, toolsFor } from "@/server/mcp";
import { endpointVisible, FULL_VIEW, parseMcpView, SENSITIVE_TOOLS, TOOLSET_OF, TOOLSETS, viewAllows } from "@/server/mcp-toolsets";
import { rateLimiter } from "@/server/rate-limit";
import { useFreshDb } from "@/server/test/db";
import { POST } from "@/app/api/mcp/route";

const ALL_SCOPES = [...new Set(ENDPOINTS.map((e) => e.scope).filter((s): s is Scope => s !== null))] as Scope[];

let ctx: Awaited<ReturnType<typeof useFreshDb>>;
let userId: string;
let readAll: string;
let deployOnly: string;
let projectsOnly: string;
let allScopes: string;

beforeAll(async () => {
  ctx = await useFreshDb();
  const me = await upsertUser({ id: "ts-1", name: "Sam", email: null, slackId: null });
  userId = me.id;
  readAll = (await createApiToken(me.id, { name: "read", scopes: ["projects:read", "deployments:read", "logs:read", "env:read", "domains:read", "resources:read", "container:read", "analytics:read", "activity:read", "alerts:read", "notifications:read"] })).secret;
  deployOnly = (await createApiToken(me.id, { name: "deploy", scopes: ["projects:read", "deployments:read", "deployments:write", "logs:read"] })).secret;
  projectsOnly = (await createApiToken(me.id, { name: "projects", scopes: ["projects:read"] })).secret;
  allScopes = (await createApiToken(me.id, { name: "all", scopes: ALL_SCOPES })).secret;
});
afterAll(async () => ctx.cleanup());
beforeEach(() => rateLimiter().clear());

const principal = (scopes: Scope[]): Principal => ({ userId, tokenId: "t", scopes });


/** One JSON-RPC call to /api/mcp with an optional query string. */
const rpc = (query: string, body: unknown, secret: string | null) =>
  POST(
    new NextRequest(`http://localhost:3000/api/mcp${query}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(secret ? { authorization: `Bearer ${secret}` } : {}) },
      body: JSON.stringify(body),
    }),
    undefined
  );
const listed = async (query: string, secret: string): Promise<string[]> => {
  const res = await rpc(query, { jsonrpc: "2.0", id: 1, method: "tools/list" }, secret);
  expect(res.status).toBe(200);
  return ((await res.json()).result.tools as { name: string }[]).map((t) => t.name);
};
const toolsList = async (query: string, secret: string) => {
  const res = await rpc(query, { jsonrpc: "2.0", id: 1, method: "tools/list" }, secret);
  return (await res.json()).result.tools as { name: string; _meta?: Record<string, unknown> }[];
};

describe("toolset membership", () => {
  it("puts every endpoint in exactly one toolset, and names no endpoint that does not exist", () => {
    const known = new Set(ENDPOINTS.map((e) => e.id));
    for (const ep of ENDPOINTS) expect(TOOLSET_OF[ep.id], ep.id).toBeDefined();
    for (const id of Object.keys(TOOLSET_OF)) expect(known.has(id), id).toBe(true);
    for (const set of Object.values(TOOLSET_OF)) expect(TOOLSETS).toContain(set);
  });

  it("exposes the supported Orchard helpers in core", () => {
    for (const id of ["find", "get_github_status", "diagnose_deployment", "get_deployment_next_steps"]) {
      expect(TOOLSET_OF[id], id).toBe("core");
    }
  });

  it("groups deploy-hook token management with deployments", () => {
    expect(TOOLSET_OF.create_deploy_webhook_token).toBe("deployments");
    expect(TOOLSET_OF.delete_deploy_webhook_token).toBe("deployments");
  });

  it("marks one-time deploy-hook and webhook secrets as sensitive", () => {
    expect([...SENSITIVE_TOOLS]).toEqual(["rotate_deploy_hook", "create_deploy_webhook_token", "create_notification_channel"]);
    const sensitive = TOOLS.filter((t) => t._meta?.["egg/sensitive"] === true).map((t) => t.name);
    expect(sensitive).toEqual(["rotate_deploy_hook", "create_deploy_webhook_token", "create_notification_channel"]);
  });
});

describe("parseMcpView", () => {
  it("shows everything when nothing is asked for", () => {
    expect(parseMcpView(new URL("http://x/api/mcp"))).toEqual({ toolsets: null, level: "full" });
  });

  it("always includes core, and reads toolset names with spaces and blanks tolerated", () => {
    const view = parseMcpView(new URL("http://x/api/mcp?toolsets=deployments, logs,,"));
    expect([...view.toolsets!].sort()).toEqual(["core", "deployments", "logs"]);
    expect([...parseMcpView(new URL("http://x/api/mcp?toolsets=")).toolsets!]).toEqual(["core"]);
  });

  it("refuses an unknown toolset or scope with a 400 that lists the choices", async () => {
    expect(() => parseMcpView(new URL("http://x/api/mcp?toolsets=nope"))).toThrow(/Unknown toolset/);
    expect(() => parseMcpView(new URL("http://x/api/mcp?scope=admin"))).toThrow(/Unknown scope/);
    const res = await rpc("?toolsets=nope", { jsonrpc: "2.0", id: 1, method: "tools/list" }, readAll);
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("validation");
  });

  it("checks the token before it reads the query, so a bad query alone is still a 401", async () => {
    const res = await rpc("?toolsets=nope", { jsonrpc: "2.0", id: 1, method: "tools/list" }, null);
    expect(res.status).toBe(401);
  });
});

describe("toolset filtering over HTTP", () => {
  it("lists only core and the named toolsets, for a token that has every scope", async () => {
    const names = await listed("?toolsets=deployments,logs", allScopes);
    expect(names).toContain("get_me");
    expect(names).toContain("deploy_branch");
    expect(names).toContain("get_logs");
    expect(names).not.toContain("set_env_var");
    expect(names).not.toContain("terminal_open");
    for (const name of names) expect(["core", "deployments", "logs"]).toContain(TOOLSET_OF[name]);
  });

  it("lists every toolset when the parameter is absent, as before", async () => {
    const names = await listed("", allScopes);
    expect(names.sort()).toEqual(ENDPOINTS.map((e) => e.id).sort());
  });


  it("lists jobs and notification channels through their own toolsets", async () => {
    const names = await listed("?toolsets=jobs,notifications", allScopes);
    expect(names).toContain("create_job");
    expect(names).toContain("list_jobs");
    expect(names).toContain("create_notification_channel");
    expect(names).toContain("test_notification_channel");
    expect(names).not.toContain("add_env_vars");
    for (const name of names) expect(["core", "jobs", "notifications"]).toContain(TOOLSET_OF[name]);
  });

  it("refuses to run a tool outside the named toolsets, as if it did not exist", async () => {
    const res = await rpc("?toolsets=logs", { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "set_env_var", arguments: {} } }, allScopes);
    const body = await res.json();
    expect(body.error).toMatchObject({ code: -32602 });
    expect(body.error.message).toBe("Unknown tool: set_env_var");
  });

  it("runs a tool from core while the toolsets are narrowed, since core is always there", async () => {
    const res = await rpc("?toolsets=logs", { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "list_projects", arguments: {} } }, projectsOnly);
    const body = await res.json();
    expect(body.result.isError).toBe(false);
  });
});

describe("scope narrowing", () => {
  it("read keeps only tools that change nothing", async () => {
    const names = await listed("?scope=read", allScopes);
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) expect(ENDPOINTS.find((e) => e.id === name)!.readOnly, name).toBe(true);
    expect(names).not.toContain("deploy_branch");
  });

  it("deploy adds deployment changes to the reads, and nothing else", async () => {
    const names = await listed("?scope=deploy", allScopes);
    expect(names).toContain("deploy_branch");
    expect(names).toContain("rollback_deployment");
    expect(names).toContain("restart_service");
    expect(names).not.toContain("set_env_var");
    expect(names).not.toContain("delete_project");
    expect(names).not.toContain("terminal_open");
  });

  it("never widens: a read-only token gets nothing more with deploy or full", async () => {
    const readOnlyToken = projectsOnly;
    for (const q of ["", "?scope=deploy", "?scope=full", "?toolsets=deployments,env,terminal,files&scope=deploy"]) {
      const names = await listed(q, readOnlyToken);
      expect(names, q).not.toContain("deploy_branch");
      expect(names, q).not.toContain("set_env_var");
      expect(names, q).not.toContain("list_deployments");
      for (const name of names) {
        const ep = ENDPOINTS.find((e) => e.id === name)!;
        expect(ep.scope === null || ep.scope === "projects:read", `${q} ${name}`).toBe(true);
      }
    }
  });

  it("does not widen a deploy-scope token into project deletes or env writes", async () => {
    const names = await listed("?toolsets=projects,env,deployments&scope=deploy", deployOnly);
    expect(names).toContain("deploy_branch");
    expect(names).not.toContain("delete_project");
    expect(names).not.toContain("set_env_var");
    expect(names).not.toContain("list_env_vars");
  });
});

describe("tools the token cannot run are not listed", () => {
  it("lists exactly the tools whose scope the token holds, plus the scope-free ones", async () => {
    const names = await listed("", projectsOnly);
    for (const name of names) {
      const ep = ENDPOINTS.find((e) => e.id === name)!;
      expect(ep.scope === null || ep.scope === "projects:read", name).toBe(true);
    }
    expect(names).toContain("list_projects");
    expect(names).not.toContain("deploy_branch");
  });

  it("answers a call to a tool the token cannot run with the scope it needs, as before", async () => {
    const res = await rpc("", { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "deploy_branch", arguments: { projectId: "x" } } }, projectsOnly);
    const text = (await res.json()).result.content[0].text as string;
    expect(text).toContain("deployments:write");
  });

  it("agrees with endpointVisible for every endpoint, token and view", () => {
    const tokens = [principal(ALL_SCOPES), principal(["projects:read"]), principal(["deployments:read", "deployments:write"])];
    const views = [FULL_VIEW, parseMcpView(new URL("http://x/?toolsets=deployments&scope=deploy")), parseMcpView(new URL("http://x/?scope=read"))];
    for (const p of tokens) for (const v of views) {
      const listedNames = toolsFor(p, v).map((t) => t.name).sort();
      const expected = ENDPOINTS.filter((e) => endpointVisible(p, e, v)).map((e) => e.id).sort();
      expect(listedNames).toEqual(expected);
      for (const ep of ENDPOINTS) if (!viewAllows(ep, v)) expect(endpointVisible(p, ep, v)).toBe(false);
    }
  });
});

describe("sensitive tools", () => {
  it("marks the one-time secret tools with egg/sensitive in tools/list", async () => {
    const tools = await toolsList("", allScopes);
    const flagged = tools.filter((t) => t._meta && t._meta["egg/sensitive"] === true).map((t) => t.name);
    expect(flagged).toEqual(["rotate_deploy_hook", "create_deploy_webhook_token", "create_notification_channel"]);
  });

  it("keeps the mark when the tool is narrowed into the list", async () => {
    const tools = await toolsList("?toolsets=hooks&scope=deploy", allScopes);
    expect(tools.find((t) => t.name === "rotate_deploy_hook")?._meta).toEqual({ "egg/sensitive": true });
  });
});

describe("the protocol functions take the same view", () => {
  it("handleMcpMessage with no view is the full list for the token", async () => {
    const p = principal(["projects:read"]);
    const out = await handleMcpMessage(p, { jsonrpc: "2.0", id: 9, method: "tools/list" });
    expect(out.kind).toBe("response");
    if (out.kind !== "response" || !("result" in out.body)) throw new Error("no result");
    expect((out.body.result as { tools: { name: string }[] }).tools.map((t) => t.name)).toEqual(toolsFor(p).map((t) => t.name));
  });
});
