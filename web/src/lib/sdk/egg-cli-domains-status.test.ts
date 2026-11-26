import { describe, expect, it } from "vitest";
import type { FetchInit, FetchLike, FetchResponse } from "./egg";
import { parseCli, run } from "../../../scripts/egg-cli.mjs";

const TOKEN = "egg_test_token_123";
const URL_BASE = "https://egg.example.com";
const ENV = { EGG_TOKEN: TOKEN, EGG_URL: URL_BASE };

function reply(status: number, body: unknown): FetchResponse {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return { ok: status >= 200 && status < 300, status, headers: { get: () => null }, text: async () => text };
}

type Call = { method: string; path: string; search: string; body: unknown; auth: string | undefined };
type Handler = (call: { url: URL; init: FetchInit }) => FetchResponse | Error | Promise<FetchResponse>;
type Routes = Record<string, FetchResponse | Handler>;

function routes(table: Routes) {
  const calls: Call[] = [];
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
    stdout: { isTTY: true, write: (value: string) => void (out += value) },
    stderr: { write: (value: string) => void (err += value) },
  });
  return { code, out, err, calls };
}

describe("domains-status CLI commands", () => {
  it("parses domains get and calls getIngress with the domain id", async () => {
    expect(parseCli(["domains", "get", "dom_1"])).toMatchObject({ ok: true, command: "domains get", args: ["dom_1"] });
    const r = await egg(["domains", "get", "dom_1"], {
      "GET /api/v1/domains/dom_1": reply(200, { domain: { id: "dom_1", domain: "app.example.com", port: 3000 } }),
    });
    expect(r.code).toBe(0);
    expect(r.calls.map(({ method, path }) => [method, path])).toEqual([["GET", "/api/v1/domains/dom_1"]]);
  });

  it("parses domains update and sends the destination port", async () => {
    expect(parseCli(["domains", "update", "dom_1", "--service-port", "8080"])).toMatchObject({
      ok: true,
      command: "domains update",
      args: ["dom_1"],
      flags: { servicePort: "8080" },
    });
    const r = await egg(["domains", "update", "dom_1", "--service-port", "8080"], {
      "PATCH /api/v1/domains/dom_1": reply(200, { domain: { id: "dom_1", port: 8080 } }),
    });
    expect(r.code).toBe(0);
    expect(r.calls).toMatchObject([{ method: "PATCH", path: "/api/v1/domains/dom_1", body: { port: 8080 } }]);
  });

  it("parses domains delete and removes only after exact domain-name confirmation", async () => {
    expect(parseCli(["domains", "delete", "dom_1", "--confirm", "app.example.com"])).toMatchObject({
      ok: true,
      command: "domains delete",
      args: ["dom_1"],
      flags: { confirm: "app.example.com" },
    });
    const r = await egg(["domains", "delete", "dom_1", "--confirm", "app.example.com"], {
      "GET /api/v1/domains": reply(200, { domains: [{ id: "dom_1", domain: "app.example.com" }] }),
      "DELETE /api/v1/domains/dom_1": reply(200, { removed: true, domainId: "dom_1" }),
    });
    expect(r.code).toBe(0);
    expect(r.calls.map(({ method, path }) => [method, path])).toEqual([
      ["GET", "/api/v1/domains"],
      ["DELETE", "/api/v1/domains/dom_1"],
    ]);

    const wrong = await egg(["domains", "delete", "dom_1", "--confirm", "app"], {
      "GET /api/v1/domains": reply(200, { domains: [{ id: "dom_1", domain: "app.example.com" }] }),
    });
    expect(wrong.code).toBe(2);
    expect(wrong.err).toContain("exactly match");
    expect(wrong.calls).toHaveLength(1);
  });

  it("rejects domains delete without confirmation before making a request", async () => {
    const r = await egg(["domains", "delete", "dom_1"]);
    expect(r.code).toBe(2);
    expect(r.err).toContain("needs --confirm");
    expect(r.calls).toHaveLength(0);
  });

  it("parses domains protection get and calls getIngressProtection", async () => {
    expect(parseCli(["domains", "protection", "get", "dom_1"])).toMatchObject({ ok: true, command: "domains protection get" });
    const r = await egg(["domains", "protection", "get", "dom_1"], {
      "GET /api/v1/domains/dom_1/protection": reply(200, { mode: "allowlist", excludedPaths: ["/health"] }),
    });
    expect(r.code).toBe(0);
    expect(r.calls.map(({ method, path }) => [method, path])).toEqual([["GET", "/api/v1/domains/dom_1/protection"]]);
  });

  it("parses domains protection set, passes the password and redacts its response", async () => {
    const password = "correct horse battery staple";
    expect(parseCli(["domains", "protection", "set", "dom_1", "--mode", "password", "--password", password])).toMatchObject({
      ok: true,
      command: "domains protection set",
      args: ["dom_1"],
      flags: { mode: "password", password },
    });
    const r = await egg(["domains", "protection", "set", "dom_1", "--mode", "password", "--password", password], {
      "PUT /api/v1/domains/dom_1/protection": reply(200, { mode: "password", password }),
    });
    expect(r.code).toBe(0);
    expect(r.calls).toMatchObject([{ method: "PUT", path: "/api/v1/domains/dom_1/protection", body: { mode: "password", password } }]);
    expect(r.out).not.toContain(password);
    expect(r.out).toContain("[redacted]");
  });

  it("parses status-page show and resolves a project before calling getStatusPage", async () => {
    expect(parseCli(["status-page", "show", "my-app"])).toMatchObject({ ok: true, command: "status-page show", args: ["my-app"] });
    const r = await egg(["status-page", "show", "my-app"], {
      "GET /api/v1/projects": reply(200, { projects: [{ id: "p_1", slug: "my-app" }] }),
      "GET /api/v1/projects/p_1/status-page": reply(200, { statusPage: { published: true, url: "https://status.example.com" } }),
    });
    expect(r.code).toBe(0);
    expect(r.calls.map(({ method, path }) => [method, path])).toEqual([
      ["GET", "/api/v1/projects"],
      ["GET", "/api/v1/projects/p_1/status-page"],
    ]);
  });
});
