import { describe, expect, it } from "vitest";
import type { FetchInit, FetchLike, FetchResponse } from "./egg";
import { parseCli, run } from "../../../scripts/egg-cli.mjs";

const TOKEN = "egg_observe_test_token123";
const URL_BASE = "https://egg.example.com";
const ENV = { EGG_TOKEN: TOKEN, EGG_URL: URL_BASE };

function reply(status: number, body: unknown): FetchResponse {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return { ok: status >= 200 && status < 300, status, headers: { get: () => null }, text: async () => text };
}

type Handler = (call: { url: URL; init: FetchInit }) => FetchResponse | Error | Promise<FetchResponse>;
type Routes = Record<string, FetchResponse | Handler>;

function routes(table: Routes) {
  const calls: { method: string; path: string; search: string; body: unknown; auth: string | undefined }[] = [];
  const fetch: FetchLike = async (rawUrl, init) => {
    const url = new URL(rawUrl);
    calls.push({
      method: init.method,
      path: url.pathname,
      search: url.search,
      body: init.body === undefined ? undefined : JSON.parse(init.body),
      auth: init.headers.Authorization,
    });
    const entry = table[`${init.method} ${url.pathname}`];
    if (!entry) return reply(404, { error: { code: "not_found", message: `No fake route for ${init.method} ${url.pathname}` } });
    const answer = typeof entry === "function" ? await entry({ url, init }) : entry;
    if (answer instanceof Error) throw answer;
    return answer;
  };
  return { fetch, calls };
}

async function egg(argv: string[], table: Routes = {}) {
  const { fetch, calls } = routes(table);
  let out = "";
  let err = "";
  const code = await run(argv, {
    env: ENV,
    fetch,
    stdout: { isTTY: true, write: (s: string) => void (out += s) },
    stderr: { write: (s: string) => void (err += s) },
    sleep: async () => false,
    pollMs: 1,
  });
  return { code, out, err, calls };
}

const deployment = { id: "dep_1", projectId: "p_1", projectSlug: "app", env: "production", state: "ready" };

describe("observe-events CLI commands", () => {
  it("parses and filters deployment log entries", async () => {
    expect(parseCli(["observe", "logs", "dep_1", "--tail", "25", "--search", "keep", "--level", "error", "--json"])).toMatchObject({
      ok: true,
      command: "observe logs",
      args: ["dep_1"],
      flags: { tail: "25", search: "keep", level: "error", json: true },
    });

    const r = await egg(["observe", "logs", "dep_1", "--tail", "25", "--search", "keep", "--level", "error", "--json"], {
      "GET /api/v1/deployments/dep_1/logs": reply(200, {
        deploymentId: "dep_1",
        lines: [
          { id: 1, at: "2026-11-25T10:00:00Z", level: "info", message: "keep this" },
          { id: 2, at: "2026-11-25T10:01:00Z", level: "error", message: "keep this" },
          { id: 3, at: "2026-11-25T10:02:00Z", level: "error", message: "skip this" },
        ],
        nextAfter: 3,
        more: false,
      }),
    });
    expect(r.code).toBe(0);
    expect(r.calls.map((call) => call.path)).toEqual(["/api/v1/deployments/dep_1/logs"]);
    expect(new URLSearchParams(r.calls[0].search).get("limit")).toBe("25");
    expect(JSON.parse(r.out)).toEqual({
      deploymentId: "dep_1",
      lines: [{ id: 2, at: "2026-11-25T10:01:00Z", level: "error", message: "keep this" }],
      nextAfter: 3,
      more: false,
    });
  });

  it("parses and reads deployment HTTP metrics", async () => {
    expect(parseCli(["observe", "http", "dep_1", "--json"])).toMatchObject({ ok: true, command: "observe http", args: ["dep_1"] });
    const metrics = { pageviews: 12 };
    const r = await egg(["observe", "http", "dep_1", "--json"], {
      "GET /api/v1/deployments/dep_1/http-metrics": reply(200, metrics),
    });
    expect(r.code).toBe(0);
    expect(r.calls.map((call) => call.path)).toEqual(["/api/v1/deployments/dep_1/http-metrics"]);
    expect(JSON.parse(r.out)).toEqual(metrics);
  });

  it("parses and reads project anomaly summaries for a deployment", async () => {
    expect(parseCli(["observe", "errors", "dep_1", "--window", "5m", "--json"])).toMatchObject({
      ok: true,
      command: "observe errors",
      flags: { window: "5m", json: true },
    });
    const anomalies = { anomalies: [{ kind: "memory", count: 2 }] };
    const r = await egg(["observe", "errors", "dep_1", "--window", "5m", "--json"], {
      "GET /api/v1/deployments/dep_1": reply(200, { deployment }),
      "GET /api/v1/projects/p_1/anomalies": reply(200, anomalies),
    });
    expect(r.code).toBe(0);
    expect(r.calls.map((call) => call.path)).toEqual(["/api/v1/deployments/dep_1", "/api/v1/projects/p_1/anomalies"]);
    expect(JSON.parse(r.out)).toEqual(anomalies);
  });

  it("parses and filters the activity feed by categories, deployment text, and cursor", async () => {
    expect(parseCli(["observe", "activity", "dep_1", "--kinds", "deploy,error", "--limit", "25", "--cursor", "page-a"])).toMatchObject({
      ok: true,
      command: "observe activity",
      args: ["dep_1"],
      flags: { kinds: "deploy,error", limit: "25", cursor: "page-a" },
    });
    const r = await egg(["observe", "activity", "dep_1", "--kinds", "deploy,error", "--limit", "25", "--cursor", "page-a", "--json"], {
      "GET /api/v1/activity": reply(200, {
        items: [
          { id: 1, kind: "deploy", action: "released", label: "Released dep_1", target: { name: "dep_1", gone: false }, fields: [], at: "2026-11-25T10:00:00Z" },
          { id: 2, kind: "access", action: "login", label: "Signed in", target: null, fields: [], at: "2026-11-25T09:00:00Z" },
        ],
        nextCursor: null,
        total: 2,
      }),
    });
    expect(r.code).toBe(0);
    expect(r.calls).toHaveLength(1);
    const query = new URLSearchParams(r.calls[0].search);
    expect(query.get("limit")).toBe("25");
    expect(query.get("cursor")).toBe("page-a");
    expect(JSON.parse(r.out).items).toHaveLength(1);
    expect(JSON.parse(r.out).items[0].id).toBe(1);
  });

  it("parses an organization event tail and starts replay from the supplied cursor", async () => {
    expect(parseCli(["events", "tail", "--types", "deployments", "--since-id", "cursor-a"])).toMatchObject({
      ok: true,
      command: "events tail",
      flags: { types: "deployments", sinceId: "cursor-a" },
    });
    const r = await egg(["events", "tail", "--types", "deployments", "--since-id", "cursor-a"], {
      "GET /api/v1/projects": reply(200, { projects: [{ id: "p_1", slug: "app" }] }),
      "GET /api/v1/projects/p_1/changes": reply(503, { error: { code: "unavailable", message: "temporary" } }),
    });
    expect(r.code).toBe(7);
    expect(r.calls.map((call) => call.path)).toEqual(["/api/v1/projects", "/api/v1/projects/p_1/changes"]);
    expect(new URLSearchParams(r.calls[1].search).get("cursor")).toBe("cursor-a");
  });

  it("parses audit filters and reads successive pages with --all", async () => {
    expect(parseCli(["audit", "list", "--deployment", "dep_1", "--action", "deploy", "--limit", "2", "--cursor", "page-a", "--all"])).toMatchObject({
      ok: true,
      command: "audit list",
      flags: { deployment: "dep_1", action: "deploy", limit: "2", cursor: "page-a", all: true },
    });
    const r = await egg(["audit", "list", "--deployment", "dep_1", "--action", "deploy", "--limit", "2", "--all", "--json"], {
      "GET /api/v1/audit-log": ({ url }) =>
        url.searchParams.get("cursor") === "next"
          ? reply(200, { items: [{ id: "a2", action: "deploy", actor: "sam" }], nextCursor: null })
          : reply(200, { items: [{ id: "a1", action: "deploy", actor: "sam" }], nextCursor: "next" }),
    });
    expect(r.code).toBe(0);
    expect(r.calls).toHaveLength(2);
    expect(new URLSearchParams(r.calls[0].search).get("deployment")).toBe("dep_1");
    expect(new URLSearchParams(r.calls[0].search).get("action")).toBe("deploy");
    expect(new URLSearchParams(r.calls[1].search).get("cursor")).toBe("next");
    expect(JSON.parse(r.out).items.map((item: { id: string }) => item.id)).toEqual(["a1", "a2"]);
  });

  it("rejects a log tail outside the documented limit as a usage error", async () => {
    const r = await egg(["observe", "logs", "dep_1", "--tail", "20001"]);
    expect(r.code).toBe(2);
    expect(r.calls).toHaveLength(0);
    expect(r.err).toContain("1 to 20000");
  });
});
