import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { createApiToken, SCOPES, type Scope } from "@/server/api-tokens";
import { clearIdempotencyKeys } from "@/server/api-idempotency";
import { upsertUser } from "@/server/auth/session";
import { schema } from "@/server/db";
import { createProject } from "@/server/projects";
import { rateLimiter } from "@/server/rate-limit";
import { createServer } from "@/server/servers";
import { useFreshDb } from "@/server/test/db";
import { POST } from "@/app/api/mcp/route";

/**
 * Idempotency-Key on MCP write tools (tools/call on /api/mcp): the header and the
 * `idempotencyKey` argument both work, and a repeat runs the write once.
 */

let ctx: Awaited<ReturnType<typeof useFreshDb>>;
let serverId: string;
let tokenA: string;
let tokenB: string;
let hookProjectId: string;

const ALL: Scope[] = [...SCOPES];

beforeAll(async () => {
  ctx = await useFreshDb();
  const me = await upsertUser({ id: "mcp-idem-1", name: "Sam", email: null, slackId: null });
  serverId = (await createServer(me.id, "mcp-idem-server")).id;
  tokenA = (await createApiToken(me.id, { name: "mcp-idem-a", scopes: ALL })).secret;
  tokenB = (await createApiToken(me.id, { name: "mcp-idem-b", scopes: ALL })).secret;
  hookProjectId = (
    await createProject(me.id, {
      serverId,
      name: "Hook",
      slug: "hook",
      repoUrl: "https://github.com/sam/hook.git",
      runtime: "node",
      port: 3950,
    })
  ).id;
});
afterAll(async () => ctx.cleanup());
beforeEach(async () => {
  await clearIdempotencyKeys();
  rateLimiter().clear();
});

const send = (body: unknown, secret: string, headers: Record<string, string> = {}) =>
  POST(
    new NextRequest("http://localhost:3000/api/mcp", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${secret}`, ...headers },
      body: JSON.stringify(body),
    }),
    undefined
  );

const call = (name: string, args: Record<string, unknown>, id: number | string = 1) => ({
  jsonrpc: "2.0",
  id,
  method: "tools/call",
  params: { name, arguments: args },
});

/** A create_project call with a distinct name and port, so each test writes its own project. */
const spec = (name: string, port: number) => ({
  serverId,
  name,
  repoUrl: "https://github.com/sam/mcp-idem.git",
  runtime: "node",
  port,
});

async function projectsNamed(name: string) {
  return ctx.db.select().from(schema.projects).where(eq(schema.projects.name, name));
}

type Rpc = { id: number | string; result?: { isError: boolean; content: { text: string }[] }; error?: { code: number; message: string } };

/** The tool's payload, without the untrusted frame (its nonce is fresh per result). */
function payloadOf(r: Rpc): string {
  const t = r.result!.content[0].text;
  const m = t.match(/<egg-untrusted\|([0-9a-f]{32})>\n([\s\S]*)\n<\/egg-untrusted\|\1>/);
  return m ? m[2] : t;
}

describe("MCP write tools with Idempotency-Key", () => {
  it("runs a write once for a repeated key in the header, and replays the same result", async () => {
    const body = call("create_project", spec("Header Once", 3901));
    const first = await send(body, tokenA, { "Idempotency-Key": "mcp-header-1" });
    const second = await send({ ...body, id: 2 }, tokenA, { "Idempotency-Key": "mcp-header-1" });
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    const a = (await first.json()) as Rpc;
    const b = (await second.json()) as Rpc;
    expect(a.result?.isError).toBe(false);
    expect(b.id).toBe(2); // the envelope carries this request's id
    expect(payloadOf(b)).toEqual(payloadOf(a)); // same answer; the untrusted frame gets a fresh nonce each time
    expect(await projectsNamed("Header Once")).toHaveLength(1);
  });

  it("runs a write once for a repeated idempotencyKey argument", async () => {
    const body = call("create_project", { ...spec("Argument Once", 3902), idempotencyKey: "mcp-arg-1" });
    const first = (await (await send(body, tokenA)).json()) as Rpc;
    const second = (await (await send({ ...body, id: 2 }, tokenA)).json()) as Rpc;
    expect(first.result?.isError).toBe(false);
    expect(payloadOf(second)).toEqual(payloadOf(first));
    expect(await projectsNamed("Argument Once")).toHaveLength(1);
  });

  it("refuses the same key with different arguments with 422, and creates nothing", async () => {
    const first = await send(call("create_project", spec("Mismatch A", 3903)), tokenA, { "Idempotency-Key": "mcp-mismatch-1" });
    expect(first.status).toBe(200);
    const changed = await send(call("create_project", spec("Mismatch B", 3904)), tokenA, { "Idempotency-Key": "mcp-mismatch-1" });
    expect(changed.status).toBe(422);
    expect(await projectsNamed("Mismatch B")).toHaveLength(0);
  });

  it("keeps keys apart per token: the other token's write still runs", async () => {
    const a = (await (await send(call("create_project", spec("Scope A", 3905)), tokenA, { "Idempotency-Key": "mcp-shared" })).json()) as Rpc;
    const b = await send(call("create_project", spec("Scope B", 3906)), tokenB, { "Idempotency-Key": "mcp-shared" });
    expect(b.status).toBe(200);
    const bBody = (await b.json()) as Rpc;
    expect(bBody.result?.isError).toBe(false);
    expect(payloadOf(bBody)).not.toEqual(payloadOf(a));
    expect(await projectsNamed("Scope B")).toHaveLength(1);
  });

  it("refuses a malformed key with a JSON-RPC error and runs nothing", async () => {
    const res = (await (await send(call("create_project", spec("Bad Key", 3907)), tokenA, { "Idempotency-Key": "has space" })).json()) as Rpc;
    expect(res.error?.code).toBe(-32602);
    expect(await projectsNamed("Bad Key")).toHaveLength(0);
  });

  it("refuses a header and an argument that disagree, and runs nothing", async () => {
    const res = (await (
      await send(call("create_project", { ...spec("Two Keys", 3908), idempotencyKey: "mcp-x" }), tokenA, {
        "Idempotency-Key": "mcp-y",
      })
    ).json()) as Rpc;
    expect(res.error?.code).toBe(-32602);
    expect(await projectsNamed("Two Keys")).toHaveLength(0);
  });

  it("does not keep a sensitive answer: the repeat is refused and the table holds no URL", async () => {
    const args = { projectId: hookProjectId };
    const first = (await (await send(call("rotate_deploy_hook", args), tokenA, { "Idempotency-Key": "mcp-hook-1" })).json()) as Rpc;
    const url = (JSON.parse(first.result!.content[0].text) as { hook: { url: string } }).hook.url;
    expect(url).toMatch(/^https?:\/\//);

    const again = await send(call("rotate_deploy_hook", args, 2), tokenA, { "Idempotency-Key": "mcp-hook-1" });
    expect(again.status).toBe(409);
    expect(await again.text()).toContain("idempotency_secret_not_replayed");

    const rows = await ctx.db.select().from(schema.idempotencyKeys).where(eq(schema.idempotencyKeys.key, "mcp-hook-1"));
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows)).not.toContain(url);
  });
});
