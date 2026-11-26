import { describe, expect, it } from "vitest";
import type { FetchInit, FetchLike, FetchResponse } from "./egg";
import { parseCli, run } from "../../../scripts/egg-cli.mjs";

const TOKEN = "egg_deploy_core_test_token";
const URL_BASE = "https://egg.example.com";

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
  const code: number = await run(argv, {
    env: { EGG_TOKEN: TOKEN, EGG_URL: URL_BASE },
    fetch,
    stdout: { isTTY: true, write: (value: string) => void (out += value) },
    stderr: { write: (value: string) => void (err += value) },
  });
  return { code, out, err, calls };
}

const deployment = {
  id: "dep_1",
  projectId: "project_1",
  projectSlug: "my-app",
  env: "production",
  state: "ready",
  source: "manual",
  branch: "main",
  sha: "abcdef1234567890",
  commit: "Ship it",
  pr: null,
  author: "sam",
  isCurrent: true,
  cleanedUp: false,
  error: null,
  createdAt: "2026-01-02T03:04:05.000Z",
  durationMs: 42_000,
  startedAt: "2026-01-02T03:04:05.000Z",
  finishedAt: null,
  port: 3000,
};

const DEPLOYMENT_ROUTE = {
  "GET /api/v1/deployments/dep_1": reply(200, { deployment }),
};

describe("deploy-core CLI parsing", () => {
  it("parses delete, pods, metrics, and release-list commands", () => {
    expect(parseCli(["deploy", "delete", "dep_1", "--confirm-name", "my-app"])).toMatchObject({
      ok: true,
      command: "deploy delete",
      args: ["dep_1"],
      flags: { confirmName: "my-app" },
    });
    expect(parseCli(["deploy", "pods", "dep_1", "--live"])).toMatchObject({
      ok: true,
      command: "deploy pods",
      args: ["dep_1"],
      flags: { live: true },
    });
    expect(parseCli(["deploy", "metrics", "dep_1"])).toMatchObject({
      ok: true,
      command: "deploy metrics",
      args: ["dep_1"],
    });
    expect(parseCli(["deploy", "releases", "dep_1", "--limit", "5"])).toMatchObject({
      ok: true,
      command: "deploy releases",
      args: ["dep_1"],
      flags: { limit: "5" },
    });
  });
});

describe("deploy-core CLI commands", () => {
  it("requires confirmation before deleting a deployment", async () => {
    const rejected = await egg(["deploy", "delete", "dep_1"], DEPLOYMENT_ROUTE);
    expect(rejected.code).toBe(2);
    expect(rejected.calls).toHaveLength(0);
    expect(rejected.err).toContain("--confirm-name");
  });

  it("deletes only when confirmation exactly matches the deployment's project slug", async () => {
    const wrong = await egg(["deploy", "delete", "dep_1", "--confirm-name", "wrong"], DEPLOYMENT_ROUTE);
    expect(wrong.code).toBe(2);
    expect(wrong.calls.map((call) => call.method)).toEqual(["GET"]);

    const deleted = await egg(["deploy", "delete", "dep_1", "--confirm-name", "my-app"], {
      ...DEPLOYMENT_ROUTE,
      "DELETE /api/v1/deployments/dep_1": reply(200, { deleted: true, deploymentId: "dep_1" }),
    });
    expect(deleted.code).toBe(0);
    expect(deleted.calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      "GET /api/v1/deployments/dep_1",
      "DELETE /api/v1/deployments/dep_1",
    ]);
  });

  it("lists project containers for the selected deployment", async () => {
    const result = await egg(["deploy", "pods", "dep_1", "--live"], {
      ...DEPLOYMENT_ROUTE,
      "GET /api/v1/projects/project_1/containers": reply(200, {
        projectId: "project_1",
        containers: [{ id: "container_1", name: "my-app", state: "running" }],
      }),
    });
    expect(result.code).toBe(0);
    expect(result.calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      "GET /api/v1/deployments/dep_1",
      "GET /api/v1/projects/project_1/containers",
    ]);
    expect(result.out).toContain("container_1");
  });

  it("reads the selected deployment's metrics", async () => {
    const metrics = {
      deploymentId: "dep_1",
      projectId: "project_1",
      window: 3600,
      bucket: 60,
      samples: [{ at: "2026-01-02T03:04:05.000Z", cpuPercent: 12, memoryMb: 256, restarts: 0 }],
    };
    const result = await egg(["deploy", "metrics", "dep_1"], {
      "GET /api/v1/deployments/dep_1/metrics": reply(200, metrics),
    });
    expect(result.code).toBe(0);
    expect(result.calls).toMatchObject([{ method: "GET", path: "/api/v1/deployments/dep_1/metrics" }]);
    expect(result.out).toContain("CPU %");
    expect(result.out).toContain("12");

    const json = await egg(["deploy", "metrics", "dep_1", "--json"], {
      "GET /api/v1/deployments/dep_1/metrics": reply(200, metrics),
    });
    expect(JSON.parse(json.out)).toEqual(metrics);
  });

  it("lists releases for the selected deployment's project", async () => {
    const result = await egg(["deploy", "releases", "dep_1", "--limit", "1"], {
      ...DEPLOYMENT_ROUTE,
      "GET /api/v1/projects/project_1/releases": reply(200, {
        releases: [
          { id: "release_1", deploymentId: "dep_1", state: "ready", createdAt: "2026-01-02T03:04:05.000Z" },
          { id: "release_2", deploymentId: "dep_2", state: "ready", createdAt: "2026-01-03T03:04:05.000Z" },
        ],
      }),
    });
    expect(result.code).toBe(0);
    expect(result.calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      "GET /api/v1/deployments/dep_1",
      "GET /api/v1/projects/project_1/releases",
    ]);
    expect(result.out).toContain("release_1");
    expect(result.out).not.toContain("release_2");
  });
});
