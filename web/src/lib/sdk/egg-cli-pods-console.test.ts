import { describe, expect, it } from "vitest";
import type { FetchInit, FetchLike, FetchResponse } from "./egg";
import { parseCli, run } from "../../../scripts/egg-cli.mjs";

const URL_BASE = "https://egg.example.com";
const ENV = { EGG_TOKEN: "egg_test_token", EGG_URL: URL_BASE };

function reply(status: number, body: unknown): FetchResponse {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return { ok: status >= 200 && status < 300, status, headers: { get: () => null }, text: async () => text };
}

type RouteTable = Record<string, FetchResponse>;

async function egg(argv: string[], table: RouteTable = {}) {
  const calls: { method: string; path: string }[] = [];
  const fetch: FetchLike = async (rawUrl, init: FetchInit) => {
    const url = new URL(rawUrl);
    calls.push({ method: init.method, path: url.pathname });
    return table[`${init.method} ${url.pathname}`] ?? reply(404, { error: { code: "not_found", message: "Unexpected fake route" } });
  };
  let out = "";
  let err = "";
  const code = await run(argv, {
    env: ENV,
    fetch,
    stdout: { isTTY: true, write: (text: string) => void (out += text) },
    stderr: { write: (text: string) => void (err += text) },
  });
  return { code, out, err, calls };
}

const project = { id: "p_1", slug: "my-app", name: "My app" };
const projectsRoute = { "GET /api/v1/projects": reply(200, { projects: [project] }) };
const container = {
  id: "ctr_1",
  name: "web-abc",
  service: "web",
  state: "running",
  restartCount: 2,
  startedAt: "2026-11-25T10:00:00.000Z",
};
const containersRoute = {
  "GET /api/v1/projects/p_1/containers": reply(200, { projectId: "p_1", containers: [container] }),
};

describe("pods and console CLI group", () => {
  it("parses pod list and calls the project container list method", async () => {
    expect(parseCli(["pod", "list"])).toMatchObject({ ok: true, command: "pod list", args: [], flags: {} });

    const r = await egg(["pod", "list"], { ...projectsRoute, ...containersRoute });
    expect(r.code).toBe(0);
    expect(r.calls).toEqual([
      { method: "GET", path: "/api/v1/projects" },
      { method: "GET", path: "/api/v1/projects/p_1/containers" },
    ]);
    expect(r.out).toContain("web-abc");
  });

  it("parses pod get and resolves the name to the full container id", async () => {
    expect(parseCli(["pod", "get", "web-abc"])).toMatchObject({ ok: true, command: "pod get", args: ["web-abc"] });

    const r = await egg(["pod", "get", "web-abc"], {
      ...projectsRoute,
      ...containersRoute,
      "GET /api/v1/projects/p_1/containers/ctr_1": reply(200, {
        projectId: "p_1",
        container: { ...container, image: "app:latest", createdAt: "2026-11-25T09:00:00.000Z" },
      }),
    });
    expect(r.code).toBe(0);
    expect(r.calls).toEqual([
      { method: "GET", path: "/api/v1/projects" },
      { method: "GET", path: "/api/v1/projects/p_1/containers" },
      { method: "GET", path: "/api/v1/projects/p_1/containers/ctr_1" },
    ]);
    expect(r.out).toContain("app:latest");
    expect(r.out).toContain("2");
  });

  it("parses top snapshots and calls the project health method with the project id", async () => {
    expect(parseCli(["top", "my-app", "--once"])).toMatchObject({
      ok: true,
      command: "top",
      args: ["my-app"],
      flags: { once: true },
    });

    const r = await egg(["top", "my-app", "--once"], {
      ...projectsRoute,
      "GET /api/v1/projects/p_1/health": reply(200, {
        projectId: "p_1",
        status: {
          state: "running",
          detail: "healthy",
          pid: 123,
          uptimeSeconds: 300,
          memoryMb: 96,
          cpuNs: 2000,
          restarts: 0,
          result: "ok",
          invocationId: null,
          http: { code: 200, ms: 12 },
          checkedAt: "2026-11-25T10:05:00.000Z",
        },
        cached: false,
      }),
    });
    expect(r.code).toBe(0);
    expect(r.calls).toEqual([
      { method: "GET", path: "/api/v1/projects" },
      { method: "GET", path: "/api/v1/projects/p_1/health" },
    ]);
    expect(r.out).toContain("running");
    expect(r.out).toContain("healthy");
  });

  it("rejects unsupported namespace and database monitoring options as usage errors", async () => {
    expect(parseCli(["pod", "list", "--namespace", "default"])).toMatchObject({
      ok: true,
      command: "pod list",
      flags: { namespace: "default" },
    });

    const namespace = await egg(["pod", "list", "--namespace", "default"]);
    expect(namespace.code).toBe(2);
    expect(namespace.calls).toHaveLength(0);
    expect(namespace.err).toContain("namespace");

    const database = await egg(["top", "my-app", "--db", "--once"]);
    expect(database.code).toBe(2);
    expect(database.calls).toHaveLength(0);
    expect(database.err).toContain("database");
  });
});
