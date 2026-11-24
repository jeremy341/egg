import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { createApiToken, SCOPES } from "@/server/api-tokens";
import { upsertUser } from "@/server/auth/session";
import { rateLimiter } from "@/server/rate-limit";
import { useFreshDb } from "@/server/test/db";
import { DELETE, GET, POST } from "@/app/api/mcp/compact/route";

/**
 * Route-level checks for /api/mcp/compact. The three tools' behaviour is covered in
 * server/mcp-compact.test.ts; here we check the HTTP edge: envelopes, status codes,
 * the query string, the body cap and bearer auth on this second endpoint.
 */

let ctx: Awaited<ReturnType<typeof useFreshDb>>;
let userId: string;
let fullToken: string;

/** The cap is private to the route module, so read it instead of guessing a number. */
const MAX_BODY_BYTES = (() => {
  const src = readFileSync(path.join(__dirname, "route.ts"), "utf8");
  const m = /const MAX_BODY_BYTES = (\d+) \* 1024;/.exec(src);
  if (!m) throw new Error("The compact MCP body cap was not found in its route.");
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
    new NextRequest(`http://localhost:3000/api/mcp/compact${query}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(secret ? { authorization: `Bearer ${secret}` } : {}), ...headers },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
    undefined
  );
const envelope = async (res: Response) => (await res.json()) as Envelope;
const toolText = (body: Envelope) => (body.result as { content: { text: string }[]; isError: boolean }).content[0].text;
const toolError = (body: Envelope) => (body.result as { isError: boolean }).isError;
/** The payload inside an untrusted frame, or the text as it is (describe_operation frames its answer). */
const stripFrame = (text: string) => {
  const m = text.match(/<egg-untrusted\|([0-9a-f]{32})>\n([\s\S]*)\n<\/egg-untrusted\|\1>/);
  return m ? m[2] : text;
};

beforeAll(async () => {
  ctx = await useFreshDb();
  userId = (await upsertUser({ id: "route-compact-user", name: "Sam", email: null, slackId: null })).id;
  fullToken = (await createApiToken(userId, { name: "compact", scopes: [...SCOPES] })).secret;
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
    const cookie = await send(rpc("tools/list"), null, "", { cookie: "egg_session=abc" });
    expect(cookie.status).toBe(401);
  });

  it("answers an authenticated message with Cache-Control: no-store", async () => {
    const res = await send(rpc("ping"));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("accepts only POST, like the full MCP endpoint", async () => {
    for (const method of [GET, DELETE]) {
      const res = await method(
        new NextRequest("http://localhost:3000/api/mcp/compact", { headers: { authorization: `Bearer ${fullToken}` } }),
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
  it("initializes with this server's identity and negotiates the version", async () => {
    const body = await envelope(await send(rpc("initialize", { protocolVersion: "2025-03-26", capabilities: {} })));
    expect(body.result).toMatchObject({
      protocolVersion: "2025-03-26",
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: "egg-compact", title: "Egg (compact)", version: "1.0.0" },
    });
    expect(body.result!.instructions as string).toContain("search_api");
    const newer = await envelope(await send(rpc("initialize", { protocolVersion: "2099-01-01" })));
    expect(newer.result).toMatchObject({ protocolVersion: "2025-06-18" });
  });

  it("lists exactly the three compact tools with schemas", async () => {
    const body = await envelope(await send(rpc("tools/list")));
    const tools = body.result!.tools!;
    expect(tools.map((t) => t.name)).toEqual(["search_api", "describe_operation", "call_api"]);
    for (const tool of tools) expect(tool.inputSchema).toMatchObject({ type: "object" });
  });

  it("runs search_api, describe_operation and call_api over one message each", async () => {
    const search = await envelope(await send(rpc("tools/call", { name: "search_api", arguments: { query: "deploy", limit: 2 } })));
    expect(toolError(search)).toBe(false);
    const found = JSON.parse(stripFrame(toolText(search))) as { matches: { operationId: string }[]; total: number };
    expect(found.matches).toHaveLength(2);
    // The two highest-ranked matches for "deploy" can change as endpoints grow;
    // what matters is that search returns real, deployable operation ids.
    expect(found.matches.map((m) => m.operationId)).toEqual(expect.arrayContaining(["cancel_deployment"]));

    const described = await envelope(await send(rpc("tools/call", { name: "describe_operation", arguments: { operationId: "get_me" } })));
    expect(toolError(described)).toBe(false);
    expect(JSON.parse(stripFrame(toolText(described)))).toMatchObject({ operationId: "get_me", path: "/api/v1/me" });

    const called = await envelope(await send(rpc("tools/call", { name: "call_api", arguments: { operationId: "get_me" } })));
    expect(toolError(called)).toBe(false);
    expect(stripFrame(toolText(called))).toContain('"token"');
  });

  it("reports an unknown tool with a JSON-RPC error", async () => {
    const res = await envelope(await send(rpc("tools/call", { name: "list_projects", arguments: {} })));
    expect(res.error).toMatchObject({ code: -32602 });
    expect(res.error!.message).toContain("Unknown tool");
  });
});

describe("toolset and scope URL params", () => {
  it("still lists the same three tools, but hides operations outside the view", async () => {
    const list = await envelope(await send(rpc("tools/list"), fullToken, "?scope=read"));
    expect(list.result!.tools!.map((t: Tool) => t.name)).toEqual(["search_api", "describe_operation", "call_api"]);

    const hiddenByScope = await envelope(
      await send(
        rpc("tools/call", { name: "call_api", arguments: { operationId: "remove_domain", confirm: "remove_domain" } }),
        fullToken,
        "?scope=read"
      )
    );
    expect(toolError(hiddenByScope)).toBe(true);
    expect(toolText(hiddenByScope)).toContain("Unknown operation");

    const hiddenByToolset = await envelope(
      await send(
        rpc("tools/call", { name: "call_api", arguments: { operationId: "list_env_vars" } }),
        fullToken,
        "?toolsets=logs"
      )
    );
    expect(toolError(hiddenByToolset)).toBe(true);
    expect(toolText(hiddenByToolset)).toContain("Unknown operation");
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
