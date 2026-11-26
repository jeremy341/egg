import { describe, expect, it } from "vitest";
import type { FetchInit, FetchLike, FetchResponse } from "./egg";
import { parseCli, run } from "../../../scripts/egg-cli.mjs";

const TOKEN = "egg_projects_test_token_123456";
const URL_BASE = "https://egg.example.com";
const ENV = { EGG_TOKEN: TOKEN, EGG_URL: URL_BASE };

function reply(status: number, body: unknown): FetchResponse {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return { ok: status >= 200 && status < 300, status, headers: { get: () => null }, text: async () => text };
}

type Handler = (call: { url: URL; init: FetchInit }) => FetchResponse | Error | Promise<FetchResponse>;
type Routes = Record<string, FetchResponse | Handler>;

function routes(table: Routes) {
  const calls: { method: string; path: string; search: string; body: unknown }[] = [];
  const fetch: FetchLike = async (rawUrl, init) => {
    const url = new URL(rawUrl);
    calls.push({
      method: init.method,
      path: url.pathname,
      search: url.search,
      body: init.body === undefined ? undefined : JSON.parse(init.body),
    });
    const entry = table[`${init.method} ${url.pathname}`];
    if (!entry) return reply(404, { error: { code: "not_found", message: "Unknown fake route" } });
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
  });
  return { code, out, err, calls };
}

const PROJECT = {
  id: "p_1",
  slug: "my-app",
  name: "My app",
  repo: "sam/my-app",
  branch: "main",
  runtime: "node",
  port: 3000,
  startCommand: "npm start",
  healthPath: "/",
  autoDeploy: true,
  buildLocation: "container",
  serverId: "srv_1",
  monitor: "up",
  state: "ready",
  latestDeployment: null,
};

describe("projects purge", () => {
  it("parses a project and exact-name confirmation", () => {
    expect(parseCli(["projects", "purge", "my-app", "--confirm", "My app"])).toMatchObject({
      ok: true,
      command: "projects purge",
      args: ["my-app"],
      flags: { confirm: "My app" },
    });
  });

  it("calls deleteProject for the matching project and removes its server resources", async () => {
    const result = await egg(["projects", "purge", "my-app", "--confirm", "My app"], {
      "GET /api/v1/projects": reply(200, { projects: [PROJECT] }),
      "DELETE /api/v1/projects/p_1": reply(200, { deleted: true, projectId: "p_1", removedFromServer: true }),
    });

    expect(result.code).toBe(0);
    expect(result.err).toBe("");
    expect(result.calls).toEqual([
      { method: "GET", path: "/api/v1/projects", search: "", body: undefined },
      { method: "DELETE", path: "/api/v1/projects/p_1", search: "?removeFromServer=true", body: undefined },
    ]);
    expect(result.out).toContain("Deleted project my-app");
  });

  it("rejects missing or incorrect confirmation before deleting", async () => {
    const missing = await egg(["projects", "purge", "my-app"]);
    expect(missing.code).toBe(2);
    expect(missing.calls).toHaveLength(0);

    const incorrect = await egg(["projects", "purge", "my-app", "--confirm", "my-app"], {
      "GET /api/v1/projects": reply(200, { projects: [PROJECT] }),
    });
    expect(incorrect.code).toBe(2);
    expect(incorrect.calls).toHaveLength(1);
    expect(incorrect.calls[0].method).toBe("GET");
    expect(incorrect.err).toContain("exact project name");
  });
});
