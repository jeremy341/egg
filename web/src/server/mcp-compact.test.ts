import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { createApiToken, type Scope } from "@/server/api-tokens";
import { endpointById, ENDPOINTS } from "@/server/api-v1";
import { upsertUser } from "@/server/auth/session";
import { capOutput, COMPACT_OUTPUT_LIMIT, COMPACT_TOOLS, searchOperations } from "@/server/mcp-compact";
import { FULL_VIEW, parseMcpView } from "@/server/mcp-toolsets";
import { rateLimiter } from "@/server/rate-limit";
import { useFreshDb } from "@/server/test/db";
import { POST } from "@/app/api/mcp/compact/route";

let ctx: Awaited<ReturnType<typeof useFreshDb>>;
let userId: string;
let allTok: string;
let projectsTok: string;
let readAllTok: string;

const ALL_SCOPES = [...new Set(ENDPOINTS.map((e) => e.scope).filter((s): s is Scope => s !== null))] as Scope[];

beforeAll(async () => {
  ctx = await useFreshDb();
  const me = await upsertUser({ id: "cp-1", name: "Sam", email: null, slackId: null });
  userId = me.id;
  allTok = (await createApiToken(me.id, { name: "compact-all", scopes: ALL_SCOPES })).secret;
  projectsTok = (await createApiToken(me.id, { name: "compact-projects", scopes: ["projects:read"] })).secret;
  readAllTok = (await createApiToken(me.id, { name: "compact-read", scopes: ALL_SCOPES.filter((s) => s.endsWith(":read")) })).secret;
});
afterAll(async () => ctx.cleanup());
beforeEach(() => rateLimiter().clear());

/** One JSON-RPC call to /api/mcp/compact. */
const rpc = (secret: string | null, body: unknown, query = "") =>
  POST(
    new NextRequest(`http://localhost:3000/api/mcp/compact${query}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(secret ? { authorization: `Bearer ${secret}` } : {}) },
      body: JSON.stringify(body),
    }),
    undefined
  );
const call = async (secret: string, name: string, args: unknown, query = "") => {
  const res = await rpc(secret, { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }, query);
  expect(res.status).toBe(200);
  const body = await res.json();
  if (body.error) return { isError: true, text: body.error.message as string, rpcError: body.error };
  return { isError: body.result.isError as boolean, text: body.result.content[0].text as string, rpcError: null };
};

describe("the compact tool list", () => {
  it("offers exactly three tools, all with annotations", async () => {
    const res = await rpc(allTok, { jsonrpc: "2.0", id: 1, method: "tools/list" });
    const tools = (await res.json()).result.tools as { name: string; annotations: Record<string, boolean> }[];
    expect(tools.map((t) => t.name)).toEqual(["search_api", "describe_operation", "call_api"]);
    for (const t of tools) expect(Object.keys(t.annotations).sort()).toEqual(["destructiveHint", "idempotentHint", "openWorldHint", "readOnlyHint"]);
  });

  it("answers initialize, ping and an unknown method like the full server", async () => {
    const init = await (await rpc(allTok, { jsonrpc: "2.0", id: 1, method: "initialize", params: {} })).json();
    expect(init.result.serverInfo.name).toBe("egg-compact");
    expect((await (await rpc(allTok, { jsonrpc: "2.0", id: 2, method: "ping" })).json()).result).toEqual({});
    expect((await (await rpc(allTok, { jsonrpc: "2.0", id: 3, method: "nope" })).json()).error.code).toBe(-32601);
  });

  it("refuses a call to a tool name that is not one of the three", async () => {
    const out = await call(allTok, "list_projects", {});
    expect(out.rpcError).toMatchObject({ code: -32602 });
  });

  it("answers 401 without a valid token", async () => {
    expect((await rpc(null, { jsonrpc: "2.0", id: 1, method: "tools/list" })).status).toBe(401);
    expect((await rpc("egg_nope", { jsonrpc: "2.0", id: 1, method: "tools/list" })).status).toBe(401);
  });
});

describe("search_api", () => {
  it("finds operations by keyword, best matches first", () => {
    const out = searchOperations(
      { userId, tokenId: "t", scopes: ALL_SCOPES },
      FULL_VIEW,
      "deploy",
      10
    );
    expect(out.matches.length).toBeGreaterThan(0);
    expect(out.matches.length).toBeLessThanOrEqual(10);
    expect(out.matches.map((m) => m.operationId)).toContain("deploy_branch");
    for (const m of out.matches) expect(m).toMatchObject({ operationId: expect.any(String), method: expect.any(String), path: expect.stringMatching(/^\/api\/v1\//) });
  });

  it("returns only operations the token can run", async () => {
    const out = await call(projectsTok, "search_api", { query: "deploy" });
    expect(out.isError).toBe(false);
    const parsed = JSON.parse(stripFrame(out.text));
    expect(parsed.matches.map((m: { operationId: string }) => m.operationId)).not.toContain("deploy_branch");
    for (const m of parsed.matches as { operationId: string }[]) {
      const scope = endpointById(m.operationId)!.scope;
      expect(scope === null || scope === "projects:read", m.operationId).toBe(true);
    }
  });

  it("honours the limit and refuses an empty query or an unknown field", async () => {
    const few = JSON.parse(stripFrame((await call(allTok, "search_api", { query: "domain", limit: 2 })).text));
    expect(few.matches).toHaveLength(2);
    expect((await call(allTok, "search_api", { query: "   " })).isError).toBe(true);
    expect((await call(allTok, "search_api", { query: "deploy", extra: 1 })).isError).toBe(true);
    expect((await call(allTok, "search_api", { query: "deploy", limit: 500 })).isError).toBe(true);
  });

  it("requires every word to match somewhere", () => {
    const out = searchOperations({ userId, tokenId: "t", scopes: ALL_SCOPES }, FULL_VIEW, "deploy zzqqxx", 10);
    expect(out.total).toBe(0);
  });
});

describe("describe_operation", () => {
  it("returns the operation with its input schema, the same as its tool on /api/mcp", async () => {
    const out = await call(allTok, "describe_operation", { operationId: "deploy_branch" });
    expect(out.isError).toBe(false);
    const d = JSON.parse(stripFrame(out.text));
    expect(d).toMatchObject({ operationId: "deploy_branch", method: "POST", path: "/api/v1/projects/{projectId}/deployments", scope: "deployments:write", destructive: false });
    expect(d.inputSchema.properties).toHaveProperty("branch");
  });

  it("says an unknown operation is unknown, and does not describe one the token cannot run", async () => {
    expect((await call(allTok, "describe_operation", { operationId: "not_a_thing" })).text).toMatch(/Unknown operation/);
    const hidden = await call(projectsTok, "describe_operation", { operationId: "deploy_branch" });
    expect(hidden.isError).toBe(true);
    expect(hidden.text).toMatch(/Unknown operation/);
  });
});

describe("call_api", () => {
  it("runs a read through the same service as the REST API", async () => {
    const out = await call(projectsTok, "call_api", { operationId: "list_projects" });
    expect(out.isError).toBe(false);
    expect(out.text).toContain("egg-untrusted");
    expect(out.text).toContain('"projects"');
  });

  it("refuses a destructive operation without confirm, and runs it when confirm repeats the id", async () => {
    expect(endpointById("remove_domain")!.destructive).toBe(true);
    const refused = await call(allTok, "call_api", { operationId: "remove_domain", arguments: { domainId: "missing-domain" } });
    expect(refused.isError).toBe(true);
    expect(refused.text).toMatch(/has not run/);
    expect(refused.text).toContain('"remove_domain"');

    const wrong = await call(allTok, "call_api", { operationId: "remove_domain", arguments: { domainId: "missing-domain" }, confirm: "remove_project" });
    expect(wrong.text).toMatch(/has not run/);

    const ran = await call(allTok, "call_api", { operationId: "remove_domain", arguments: { domainId: "missing-domain" }, confirm: "remove_domain" });
    expect(ran.isError).toBe(true);
    expect(ran.text).toMatch(/not_found/);
    expect(ran.text).not.toMatch(/has not run/);
  });

  it("names the missing scope when the token cannot run the operation, as the full server does", async () => {
    const out = await call(projectsTok, "call_api", { operationId: "deploy_branch", arguments: { projectId: "x" } });
    expect(out.isError).toBe(true);
    expect(out.text).toContain("deployments:write");
  });

  it("rejects bad arguments and an unknown operation as tool errors", async () => {
    expect((await call(allTok, "call_api", { operationId: "list_projects", arguments: "nope" })).isError).toBe(true);
    expect((await call(allTok, "call_api", { operationId: "no_such_op" })).text).toMatch(/Unknown operation/);
    expect((await call(allTok, "call_api", {})).isError).toBe(true);
  });

  it("applies the toolsets and scope narrowing of the connection, the same as /api/mcp", async () => {
    const out = await call(allTok, "call_api", { operationId: "remove_domain", arguments: {}, confirm: "remove_domain" }, "?scope=read");
    expect(out.isError).toBe(true);
    expect(out.text).toMatch(/Unknown operation/);
    const env = await call(allTok, "call_api", { operationId: "list_env_vars", arguments: {} }, "?toolsets=logs");
    expect(env.text).toMatch(/Unknown operation/);
  });

  it("never runs a write for a read-only token, even with confirm", async () => {
    const out = await call(readAllTok, "call_api", { operationId: "delete_env_var", arguments: { projectId: "x", key: "A" }, confirm: "delete_env_var" });
    expect(out.isError).toBe(true);
    expect(stripFrame(out.text)).toMatch(/^forbidden: .*env:write/);
  });
});

describe("the output cap", () => {
  it("caps any result at 24,000 characters and keeps the untrusted frame whole", () => {
    const huge = "x".repeat(200_000);
    const out = capOutput(true, huge);
    expect(out.length).toBeLessThanOrEqual(COMPACT_OUTPUT_LIMIT);
    expect(out).toMatch(/<egg-untrusted\|[0-9a-f]{32}>\n/);
    expect(out).toMatch(/<\/egg-untrusted\|[0-9a-f]{32}>\n\[Output cut at 24,000 characters/);
    const nonce = out.match(/<egg-untrusted\|([0-9a-f]{32})>/)![1];
    expect(out).toContain(`</egg-untrusted|${nonce}>`);
  });

  it("leaves a short result exactly as it is", () => {
    expect(capOutput(false, "short")).toBe("short");
    expect(capOutput(true, "short")).toMatch(/^The JSON between/);
  });

  it("caps a payload that is just under the limit once framed", () => {
    for (const n of [0, 1, 500, 23_000, 23_900, 24_000, 30_000]) {
      expect(capOutput(true, "y".repeat(n)).length, String(n)).toBeLessThanOrEqual(COMPACT_OUTPUT_LIMIT);
    }
  });

  it("is declared as the output limit of 24,000 characters", () => {
    expect(COMPACT_OUTPUT_LIMIT).toBe(24_000);
    expect(COMPACT_TOOLS).toHaveLength(3);
  });
});

describe("the connection view", () => {
  it("parses the same query as /api/mcp, so the compact server narrows the same way", () => {
    expect(parseMcpView(new URL("http://x/api/mcp/compact?toolsets=logs&scope=read")).level).toBe("read");
  });

  it("reads through a read-only connection: search_api does not list deploys", async () => {
    const out = await call(allTok, "search_api", { query: "deploy", limit: 50 }, "?scope=read");
    const parsed = JSON.parse(stripFrame(out.text));
    expect(parsed.matches.map((m: { operationId: string }) => m.operationId)).not.toContain("deploy_branch");
  });
});

/** The payload inside an untrusted frame, or the text as it is. */
function stripFrame(t: string): string {
  const m = t.match(/<egg-untrusted\|([0-9a-f]{32})>\n([\s\S]*)\n<\/egg-untrusted\|\1>/);
  return m ? m[2] : t;
}
