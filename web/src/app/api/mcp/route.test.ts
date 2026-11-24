import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { createApiToken, SCOPES } from "@/server/api-tokens";
import { upsertUser } from "@/server/auth/session";
import { rateLimiter } from "@/server/rate-limit";
import { useFreshDb } from "@/server/test/db";
import { DELETE, GET, POST } from "@/app/api/mcp/route";

/**
 * Route-level checks for /api/mcp. The service behaviour of the JSON-RPC server is
 * covered in server/mcp.test.ts; here we check what a client sees at the HTTP edge:
 * envelopes, status codes, headers, the query string, the body cap and bearer auth.
 */

let ctx: Awaited<ReturnType<typeof useFreshDb>>;
let userId: string;
let fullToken: string;
let readToken: string;

/** The cap is private to the route module, so read it instead of guessing a number. */
const MAX_BODY_BYTES = (() => {
  const src = readFileSync(path.join(__dirname, "route.ts"), "utf8");
  const m = /const MAX_BODY_BYTES = (\d+) \* 1024;/.exec(src);
  if (!m) throw new Error("The MCP body cap was not found in its route.");
  return Number(m[1]) * 1024;
})();

type Tool = { name: string; inputSchema: Record<string, unknown> };
type Envelope = {
  jsonrpc: "2.0";
  id: string | number | null;
  result?: { tools?: Tool[]; [key: string]: unknown };
  error?: { code: number; message: string };
};

const rpc = (method: string, params?: unknown, id: number | string = 1) => ({ jsonrpc: "2.0", id, method, params });
const send = (body: unknown, secret: string | null = fullToken, query = "", headers: Record<string, string> = {}) =>
  POST(
    new NextRequest(`http://localhost:3000/api/mcp${query}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(secret ? { authorization: `Bearer ${secret}` } : {}), ...headers },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
    undefined
  );
const envelope = async (res: Response) => (await res.json()) as Envelope;
/** Payload inside an untrusted frame, or the plain text when there is no frame. */
const inner = (text: string) => {
  const m = text.match(/<egg-untrusted\|([0-9a-f]{32})>\n([\s\S]*)\n<\/egg-untrusted\|\1>/);
  return m ? m[2] : text;
};

beforeAll(async () => {
  ctx = await useFreshDb();
  userId = (await upsertUser({ id: "route-mcp-user", name: "Sam", email: null, slackId: null })).id;
  fullToken = (await createApiToken(userId, { name: "all", scopes: [...SCOPES] })).secret;
  readToken = (await createApiToken(userId, { name: "read", scopes: ["projects:read"] })).secret;
});
afterAll(async () => ctx.cleanup());
beforeEach(() => rateLimiter().clear());

describe("bearer auth", () => {
  it("refuses a missing, unknown or wrong-prefix token before reading the body", async () => {
    for (const secret of [null, "egg_unknown", "sk_wrong_prefix"]) {
      const res = await send("{{{ not json", secret);
      expect(res.status, String(secret)).toBe(401);
      expect(res.headers.get("www-authenticate")).toMatch(/^Bearer resource_metadata="https?:\/\/[^"]+\/\.well-known\/oauth-protected-resource\/api\/mcp"$/);
      const body = await res.json();
      expect(body.error.code).toBe("unauthorized");
      expect(body.jsonrpc).toBeUndefined();
    }
    // A signed-in browser cookie is never an API credential.
    const cookie = await send(rpc("tools/list"), null, "", { cookie: "egg_session=abc" });
    expect(cookie.status).toBe(401);
  });

  it("answers an authenticated message with Cache-Control: no-store", async () => {
    const res = await send(rpc("ping"));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("accepts only POST: there is no stream and no session to end", async () => {
    for (const method of [GET, DELETE]) {
      const res = await method(
        new NextRequest("http://localhost:3000/api/mcp", { headers: { authorization: `Bearer ${fullToken}` } }),
        undefined
      );
      expect(res.status).toBe(405);
      expect(res.headers.get("allow")).toBe("POST");
    }
  });
});

describe("JSON-RPC envelope", () => {
  it("answers malformed JSON with a parse-error envelope and id null", async () => {
    const res = await send("{{{");
    expect(res.status).toBe(400);
    expect(await envelope(res)).toMatchObject({
      jsonrpc: "2.0",
      id: null,
      error: { code: -32700, message: "Parse error" },
    });
  });

  it("refuses batches and messages that are not JSON-RPC 2.0 with -32600", async () => {
    for (const bad of [[rpc("ping")], {}, { id: 1 }, { jsonrpc: "1.0", id: 1, method: "ping" }, "5"]) {
      const res = await send(bad);
      expect(res.status).toBe(400);
      expect(await envelope(res)).toMatchObject({ jsonrpc: "2.0", id: null, error: { code: -32600 } });
    }
  });

  it("echoes the id, string ids included, on results and errors", async () => {
    const pong = await envelope(await send(rpc("ping", undefined, "abc-1")));
    expect(pong).toMatchObject({ jsonrpc: "2.0", id: "abc-1", result: {} });
    const missing = await envelope(await send(rpc("nope", undefined, 7)));
    expect(missing).toMatchObject({ jsonrpc: "2.0", id: 7, error: { code: -32601 } });
  });

  it("answers notifications and client responses with 202 and an empty body", async () => {
    for (const msg of [
      { jsonrpc: "2.0", method: "notifications/initialized" },
      { jsonrpc: "2.0", id: 9, result: {} },
    ]) {
      const res = await send(msg);
      expect(res.status).toBe(202);
      expect(res.headers.get("cache-control")).toBe("no-store");
      expect(await res.text()).toBe("");
    }
  });
});

describe("initialize, tools/list and tools/call", () => {
  it("initializes and negotiates the protocol version", async () => {
    const res = await send(
      rpc("initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "t", version: "1" } })
    );
    expect(res.status).toBe(200);
    const body = await envelope(res);
    expect(body.result).toMatchObject({
      protocolVersion: "2025-03-26",
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: "egg", title: "Egg", version: "1.0.0" },
    });
    expect((body.result!.instructions as string)).toContain("get_me first");
    const newer = await envelope(await send(rpc("initialize", { protocolVersion: "2099-01-01" })));
    expect(newer.result).toMatchObject({ protocolVersion: "2025-06-18" });
  });

  it("lists the visible tools with schemas and annotations", async () => {
    const body = await envelope(await send(rpc("tools/list")));
    const tools = body.result!.tools!;
    const names = tools.map((t) => t.name);
    expect(names).toContain("get_me");
    expect(names).toContain("list_projects");
    expect(names).toContain("deploy_branch");
    for (const tool of tools) expect(tool.inputSchema).toMatchObject({ type: "object", additionalProperties: false });
  });

  it("runs a tool through the same service as the REST API", async () => {
    const body = await envelope(await send(rpc("tools/call", { name: "get_me", arguments: {} })));
    expect(body.error).toBeUndefined();
    const result = body.result as { content: { text: string }[]; isError: boolean };
    expect(result.isError).toBe(false);
    const data = JSON.parse(inner(result.content[0].text)) as {
      user: { name: string };
      token: { name: string };
    };
    expect(data.user.name).toBe("Sam");
    expect(data.token.name).toBe("all");
  });

  it("reports bad tool calls as JSON-RPC errors", async () => {
    const unknown = await envelope(await send(rpc("tools/call", { name: "delete_everything" })));
    expect(unknown.error).toMatchObject({ code: -32602 });
    expect(unknown.error!.message).toContain("Unknown tool");
    const badParams = await envelope(await send(rpc("tools/call", { name: 5 })));
    expect(badParams.error).toMatchObject({ code: -32602 });
    const badArgs = await envelope(await send(rpc("tools/call", { name: "get_project", arguments: {} })));
    const outcome = badArgs.result as { isError: boolean; content: { text: string }[] };
    expect(outcome.isError).toBe(true);
    expect(inner(outcome.content[0].text)).toMatch(/^validation:/);
  });
});

describe("toolset and scope URL params", () => {
  const names = async (query: string, secret = fullToken) => {
    const body = await envelope(await send(rpc("tools/list"), secret, query));
    return body.result!.tools!.map((t: Tool) => t.name);
  };

  it("?toolsets picks groups, with core always included", async () => {
    const core = await names("?toolsets=core");
    expect(core).toEqual(expect.arrayContaining(["get_deployment", "get_me", "get_project", "list_projects"]));
    const logs = await names("?toolsets=logs");
    expect(logs).toContain("get_logs");
    expect(logs).toContain("get_me");
    expect(logs).not.toContain("deploy_branch");
  });

  it("?scope=read hides writes and ?scope=deploy adds deployments only", async () => {
    const read = await names("?scope=read");
    expect(read).toContain("list_projects");
    expect(read).not.toContain("deploy_branch");
    const deploy = await names("?scope=deploy");
    expect(deploy).toContain("deploy_branch");
    expect(deploy).not.toContain("delete_project");
  });

  it("the token's own scopes narrow the list as well", async () => {
    const visible = await names("", readToken);
    expect(visible).toContain("list_projects");
    expect(visible).not.toContain("deploy_branch");
    expect(visible).not.toContain("get_logs");
  });

  it("a call outside the view reads as an unknown tool", async () => {
    const hiddenByScope = await envelope(
      await send(rpc("tools/call", { name: "deploy_branch", arguments: { projectId: "x" } }), fullToken, "?scope=read")
    );
    expect(hiddenByScope.error).toMatchObject({ code: -32602 });
    expect(hiddenByScope.error!.message).toContain("Unknown tool");
    const hiddenByToolset = await envelope(
      await send(rpc("tools/call", { name: "set_env_var", arguments: {} }), fullToken, "?toolsets=logs")
    );
    expect(hiddenByToolset.error!.message).toContain("Unknown tool");
  });

  it("rejects unknown toolsets and scopes with a 400 validation error", async () => {
    for (const query of ["?toolsets=nope", "?scope=nope"]) {
      const res = await send(rpc("ping"), fullToken, query);
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toMatchObject({ code: "validation" });
      expect(body.jsonrpc).toBeUndefined();
    }
  });
});

describe("body cap", () => {
  /** A valid ping message padded with ASCII whitespace to exactly `bytes` bytes. */
  const paddedPing = (bytes: number) => {
    const head = '{"jsonrpc":"2.0","id":1,"method":"ping","params":{"pad":"';
    const tail = '"}}';
    return head + "x".repeat(bytes - head.length - tail.length) + tail;
  };

  it("accepts a message right at the cap", async () => {
    const body = paddedPing(MAX_BODY_BYTES);
    expect(Buffer.byteLength(body, "utf8")).toBe(MAX_BODY_BYTES);
    const res = await send(body);
    expect(res.status).toBe(200);
    expect((await envelope(res)).result).toEqual({});
  });

  it("refuses one byte over the cap with a 413", async () => {
    const res = await send(paddedPing(MAX_BODY_BYTES + 1));
    expect(res.status).toBe(413);
    expect(await res.json()).toMatchObject({
      error: { code: "too_large", message: "The request body is too large." },
    });
  });
});
