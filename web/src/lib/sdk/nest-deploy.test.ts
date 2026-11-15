import { describe, expect, it } from "vitest";
import { ENDPOINTS } from "@/server/api-v1";
import { NestDeploy, NestDeployError, type FetchInit, type FetchLike, type FetchResponse } from "./nest-deploy";

type Call = { url: string; init: FetchInit };

function reply(status: number, body: unknown, headers: Record<string, string> = {}): FetchResponse {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (n) => headers[n.toLowerCase()] ?? null },
    text: async () => text,
  };
}

/** A fake fetch that records calls and answers from a queue (the last answer repeats). */
function fake(...answers: (FetchResponse | Error)[]) {
  const calls: Call[] = [];
  let i = 0;
  const fetch: FetchLike = async (url, init) => {
    calls.push({ url, init });
    const a = answers[Math.min(i++, answers.length - 1)];
    if (a instanceof Error) throw a;
    return a;
  };
  return { fetch, calls };
}

const TOKEN = "ndp_secretsecretsecret";
const BASE = "https://deploy.example.com";
const client = (f: FetchLike, extra: Partial<ConstructorParameters<typeof NestDeploy>[0]> = {}) =>
  new NestDeploy({ token: TOKEN, baseUrl: BASE, fetch: f, ...extra });

describe("requests", () => {
  it("sends the token as a bearer header and asks for JSON", async () => {
    const { fetch, calls } = fake(reply(200, { projects: [] }));
    await client(fetch).listProjects();
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://deploy.example.com/api/v1/projects");
    expect(calls[0].init.method).toBe("GET");
    expect(calls[0].init.headers.Authorization).toBe(`Bearer ${TOKEN}`);
    expect(calls[0].init.headers.Accept).toBe("application/json");
    expect(calls[0].init.body).toBeUndefined();
  });

  it("accepts a base address with a trailing slash or with /api/v1 already on it", async () => {
    for (const baseUrl of [`${BASE}/`, `${BASE}/api/v1`, `${BASE}/api/v1/`]) {
      const { fetch, calls } = fake(reply(200, { projects: [] }));
      await client(fetch, { baseUrl }).listProjects();
      expect(calls[0].url).toBe("https://deploy.example.com/api/v1/projects");
    }
  });

  it("encodes ids in the path and leaves out options that were not given", async () => {
    const { fetch, calls } = fake(reply(200, { deployments: [] }));
    const nest = client(fetch);
    await nest.listDeployments("a b/c");
    await nest.listDeployments("p1", { limit: 5 });
    expect(calls[0].url).toBe(`${BASE}/api/v1/projects/a%20b%2Fc/deployments`);
    expect(calls[1].url).toBe(`${BASE}/api/v1/projects/p1/deployments?limit=5`);
  });

  it("posts a JSON body only when there is one", async () => {
    const { fetch, calls } = fake(reply(202, { deployment: { id: "d1" } }));
    const nest = client(fetch);
    await nest.deploy("p1");
    await nest.deploy("p1", { branch: "feature/x" });
    await nest.redeploy("d1");
    expect(calls[0].init.method).toBe("POST");
    expect(calls[0].init.body).toBe("{}");
    expect(calls[0].init.headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(calls[1].init.body!)).toEqual({ branch: "feature/x" });
    expect(calls[2].url).toBe(`${BASE}/api/v1/deployments/d1/redeploy`);
    expect(calls[2].init.body).toBeUndefined();
  });

  it("returns the parsed answer", async () => {
    const me = { user: { name: "Sam" }, token: { name: "t", scopes: ["logs:read"], expiresAt: "2027-01-01T00:00:00.000Z" }, counts: { servers: 1, projects: 2 } };
    const { fetch } = fake(reply(200, me));
    expect(await client(fetch).me()).toEqual(me);
  });
});

describe("every method calls a real endpoint of the API", () => {
  it("matches each request to a method and path in the endpoint list", async () => {
    const { fetch, calls } = fake(reply(200, {}));
    const nest = client(fetch);
    await nest.me();
    await nest.listServers();
    await nest.listProjects();
    await nest.getProject("P");
    await nest.getStatusPage("P");
    await nest.listDeployments("P");
    await nest.getDeployment("D");
    await nest.deploy("P");
    await nest.redeploy("D");
    await nest.cancelDeployment("D");
    await nest.rollback("D");
    await nest.getLogs("P");
    await nest.getDeploymentLogs("D");
    await nest.listDomains();
    await nest.listEnvNames("P");
    await nest.getAnalytics("P");
    await nest.getUsageHistory("S");
    await nest.getAlerts("P");
    await nest.getActivity();

    const known = new Set(ENDPOINTS.map((e) => `${e.method} ${e.path.replace(/\{[^}]+\}/g, "*")}`));
    for (const c of calls) {
      const path = new URL(c.url).pathname.replace(/^\/api\/v1/, "");
      const shape = path
        .split("/")
        .map((s, i, all) => (["P", "D", "S"].includes(s) ? "*" : all[i - 1] === "env" ? "*" : s))
        .join("/");
      expect(known.has(`${c.init.method} ${shape}`), `${c.init.method} ${path}`).toBe(true);
    }
  });
});

describe("errors", () => {
  it("maps an API error to a NestDeployError with its status, code and message", async () => {
    const { fetch } = fake(reply(403, { error: { code: "forbidden", message: "This token does not have the logs:read permission." } }));
    const err = await client(fetch).getLogs("P").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(NestDeployError);
    expect(err).toBeInstanceOf(Error);
    expect(err).toMatchObject({
      name: "NestDeployError",
      status: 403,
      code: "forbidden",
      message: "This token does not have the logs:read permission.",
      retryAfterSeconds: null,
    });
  });

  it("keeps the Retry-After seconds on a 429", async () => {
    const { fetch } = fake(reply(429, { error: { code: "rate_limited", message: "Slow down." } }, { "retry-after": "17" }));
    const err = (await client(fetch).listProjects().catch((e: unknown) => e)) as NestDeployError;
    expect(err).toMatchObject({ status: 429, code: "rate_limited", retryAfterSeconds: 17 });
  });

  it("gives a generic error when a failure is not the API's JSON", async () => {
    const { fetch } = fake(reply(502, "<html>Bad gateway</html>"));
    const err = (await client(fetch).listProjects().catch((e: unknown) => e)) as NestDeployError;
    expect(err).toMatchObject({ status: 502, code: "http_error", message: "The server answered 502." });
  });

  it("reports a network failure as status 0 without the underlying text", async () => {
    const { fetch } = fake(new TypeError(`connect ECONNREFUSED with ${TOKEN}`));
    const err = (await client(fetch).listProjects().catch((e: unknown) => e)) as NestDeployError;
    expect(err).toMatchObject({ status: 0, code: "network_error" });
    expect(err.message).not.toContain(TOKEN);
  });

  it("reports a success that is not JSON as bad_response", async () => {
    const { fetch } = fake(reply(200, "ok"));
    const err = (await client(fetch).listProjects().catch((e: unknown) => e)) as NestDeployError;
    expect(err).toMatchObject({ status: 200, code: "bad_response" });
  });

  it("times out a request that never answers", async () => {
    const hang: FetchLike = (_url, init) =>
      new Promise((_resolve, reject) => init.signal?.addEventListener("abort", () => reject(new Error("aborted"))));
    const err = (await client(hang, { timeoutMs: 20 }).listProjects().catch((e: unknown) => e)) as NestDeployError;
    expect(err).toMatchObject({ status: 0, code: "timeout" });
  });

  it("never puts the token in an error", async () => {
    const { fetch } = fake(reply(401, { error: { code: "unauthorized", message: "That access token is not valid." } }));
    const err = (await client(fetch).me().catch((e: unknown) => e)) as NestDeployError;
    expect(JSON.stringify({ ...err, message: err.message, stack: undefined })).not.toContain(TOKEN);
  });

  it("refuses to start without a token, an address or a fetch", () => {
    const { fetch } = fake(reply(200, {}));
    expect(() => new NestDeploy({ token: " ", baseUrl: BASE, fetch })).toThrow(expect.objectContaining({ code: "missing_token" }));
    expect(() => new NestDeploy({ token: TOKEN, baseUrl: "", fetch })).toThrow(expect.objectContaining({ code: "missing_base_url" }));
    const original = globalThis.fetch;
    // @ts-expect-error simulate a runtime with no fetch
    delete globalThis.fetch;
    try {
      expect(() => new NestDeploy({ token: TOKEN, baseUrl: BASE })).toThrow(expect.objectContaining({ code: "no_fetch" }));
    } finally {
      globalThis.fetch = original;
    }
  });
});

describe("pagination", () => {
  const line = (id: number) => ({ id, at: "2026-11-05T00:00:00.000Z", level: "info", message: `line ${id}` });
  const page = (ids: number[], more: boolean) => ({
    deploymentId: "D",
    lines: ids.map(line),
    nextAfter: ids[ids.length - 1] ?? 0,
    more,
  });

  it("follows nextAfter until a page is not full", async () => {
    const { fetch, calls } = fake(reply(200, page([1, 2], true)), reply(200, page([3, 4], true)), reply(200, page([5], false)));
    const seen: number[] = [];
    for await (const l of client(fetch).deploymentLogLines("D", { pageSize: 2 })) seen.push(l.id);
    expect(seen).toEqual([1, 2, 3, 4, 5]);
    expect(calls.map((c) => new URL(c.url).search)).toEqual(["?after=0&limit=2", "?after=2&limit=2", "?after=4&limit=2"]);
  });

  it("starts from a given line id, and stops if the server does not advance", async () => {
    const { fetch, calls } = fake(reply(200, { deploymentId: "D", lines: [], nextAfter: 9, more: true }));
    const seen: number[] = [];
    for await (const l of client(fetch).deploymentLogLines("D", { after: 9 })) seen.push(l.id);
    expect(seen).toEqual([]);
    expect(calls).toHaveLength(1);
    expect(new URL(calls[0].url).searchParams.get("after")).toBe("9");
  });

  it("follows the activity cursor to the last page", async () => {
    const item = (id: number) => ({ id, action: "deploy.trigger", kind: "deployments", label: "x", target: null, suffix: null, fields: [], viaToken: null, tone: "neutral", at: "t" });
    const { fetch, calls } = fake(
      reply(200, { items: [item(3), item(2)], nextCursor: "100.5", total: 3 }),
      reply(200, { items: [item(1)], nextCursor: null, total: 3 })
    );
    const ids: number[] = [];
    for await (const i of client(fetch).activityItems({ kind: "deployments", limit: 2 })) ids.push(i.id);
    expect(ids).toEqual([3, 2, 1]);
    expect(calls.map((c) => new URL(c.url).search)).toEqual(["?kind=deployments&limit=2", "?kind=deployments&limit=2&cursor=100.5"]);
  });

  it("passes an error from a later page to the caller", async () => {
    const { fetch } = fake(reply(200, page([1, 2], true)), reply(429, { error: { code: "rate_limited", message: "Wait." } }, { "retry-after": "3" }));
    const seen: number[] = [];
    const run = async () => {
      for await (const l of client(fetch).deploymentLogLines("D")) seen.push(l.id);
    };
    await expect(run()).rejects.toMatchObject({ status: 429, retryAfterSeconds: 3 });
    expect(seen).toEqual([1, 2]);
  });
});
