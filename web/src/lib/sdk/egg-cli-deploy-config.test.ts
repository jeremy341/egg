import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { FetchInit, FetchLike, FetchResponse } from "./egg";
import { parseCli, run } from "../../../scripts/egg-cli.mjs";

const TOKEN = "egg_deploy_config_test_token";
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
    const answer = table[`${init.method} ${url.pathname}`];
    if (!answer) return reply(404, { error: { code: "not_found", message: `No fake route for ${init.method} ${url.pathname}` } });
    const response = typeof answer === "function" ? await answer({ url, init }) : answer;
    if (response instanceof Error) throw response;
    return response;
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

describe("deploy-config CLI commands", () => {
  it.each([
    [["deploy", "env", "get", "dep_1"], "deploy env get"],
    [["deploy", "env", "set", "dep_1", "TOKEN=value", "--secret"], "deploy env set"],
    [["deploy", "env", "unset", "dep_1", "TOKEN", "--confirm-key", "TOKEN"], "deploy env unset"],
    [["deploy", "resources", "set", "dep_1", "--cpu", "500"], "deploy resources set"],
    [["deploy", "volumes", "get", "dep_1"], "deploy volumes get"],
    [["deploy", "volumes", "set", "dep_1", "--volume", "/data=1Gi", "--confirm-deployment", "My app"], "deploy volumes set"],
    [["deploy", "strategy", "set", "dep_1", "--type", "rolling"], "deploy strategy set"],
    [["deploy", "pull-policy", "set", "dep_1", "--policy", "always"], "deploy pull-policy set"],
    [["deploy", "health-check", "set", "dep_1", "--path", "/health"], "deploy health-check set"],
    [["deploy", "build-root", "set", "dep_1", "on"], "deploy build-root set"],
    [["deploy", "build-config", "set", "dep_1", "--start-cmd", "node server.js"], "deploy build-config set"],
  ])("parses %s", (argv, command) => {
    expect(parseCli(argv)).toMatchObject({ ok: true, command });
  });

  it("reads deployment env values and never prints values marked secret", async () => {
    const r = await egg(["deploy", "env", "get", "dep_1", "--json"], {
      "GET /api/v1/projects/dep_1/env/values": reply(200, {
        env: [
          { key: "PUBLIC_URL", target: "all", secret: false, value: "https://example.com" },
          { key: "DATABASE_URL", target: "production", secret: true, value: "private-db-value" },
        ],
      }),
    });
    expect(r.code).toBe(0);
    expect(r.calls).toMatchObject([{ method: "GET", path: "/api/v1/projects/dep_1/env/values" }]);
    expect(JSON.parse(r.out)).toEqual({
      env: [
        { key: "PUBLIC_URL", target: "all", value: "https://example.com" },
        { key: "DATABASE_URL", target: "production", value: "[secret]" },
      ],
    });
    expect(r.out).not.toContain("private-db-value");
  });

  it("sets one environment variable and marks it secret without printing its value", async () => {
    const value = "private-config-value";
    const r = await egg(["deploy", "env", "set", "dep_1", `TOKEN=${value}`, "--secret"], {
      "PUT /api/v1/projects/dep_1/env/TOKEN": reply(200, { env: { key: "TOKEN", target: "all" } }),
      "PATCH /api/v1/projects/dep_1/env/TOKEN/all/secret": reply(200, { env: { key: "TOKEN", target: "all", secret: true } }),
    });
    expect(r.code).toBe(0);
    expect(r.calls).toMatchObject([
      { method: "PUT", path: "/api/v1/projects/dep_1/env/TOKEN", body: { value } },
      { method: "PATCH", path: "/api/v1/projects/dep_1/env/TOKEN/all/secret", body: { secret: true } },
    ]);
    expect(`${r.out}${r.err}`).not.toContain(value);
  });

  it("reads dotenv assignments and keeps their values out of JSON output", async () => {
    const directory = await mkdtemp(join(process.cwd(), ".deploy-config-env-"));
    const file = join(directory, ".env");
    await writeFile(file, 'FILE_KEY="value=with=equals"\n# ignored\nexport FILE_FLAG=enabled\n');
    try {
      const r = await egg(["deploy", "env", "set", "dep_1", "CLI_KEY=cli-value", "--file", file, "--json"], {
        "PUT /api/v1/projects/dep_1/env/CLI_KEY": reply(200, { env: { key: "CLI_KEY", target: "all" } }),
        "PUT /api/v1/projects/dep_1/env/FILE_KEY": reply(200, { env: { key: "FILE_KEY", target: "all" } }),
        "PUT /api/v1/projects/dep_1/env/FILE_FLAG": reply(200, { env: { key: "FILE_FLAG", target: "all" } }),
      });
      expect(r.code).toBe(0);
      expect(r.calls).toMatchObject([
        { path: "/api/v1/projects/dep_1/env/CLI_KEY", body: { value: "cli-value" } },
        { path: "/api/v1/projects/dep_1/env/FILE_KEY", body: { value: "value=with=equals" } },
        { path: "/api/v1/projects/dep_1/env/FILE_FLAG", body: { value: "enabled" } },
      ]);
      expect(JSON.parse(r.out)).toEqual({ updated: ["CLI_KEY", "FILE_KEY", "FILE_FLAG"] });
      expect(r.out).not.toContain("cli-value");
      expect(r.out).not.toContain("value=with=equals");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("requires exact key confirmation before removing an environment variable", async () => {
    const missing = await egg(["deploy", "env", "unset", "dep_1", "TOKEN"]);
    expect(missing.code).toBe(2);
    expect(missing.calls).toHaveLength(0);

    const wrong = await egg(["deploy", "env", "unset", "dep_1", "TOKEN", "--confirm-key", "OTHER"]);
    expect(wrong.code).toBe(2);
    expect(wrong.calls).toHaveLength(0);

    const removed = await egg(["deploy", "env", "unset", "dep_1", "TOKEN", "--confirm-key", "TOKEN"], {
      "DELETE /api/v1/projects/dep_1/env/TOKEN": reply(200, { deleted: [{ key: "TOKEN", target: "all" }] }),
    });
    expect(removed.code).toBe(0);
    expect(removed.calls).toMatchObject([{ method: "DELETE", path: "/api/v1/projects/dep_1/env/TOKEN" }]);
  });

  it("sets deployment resource requests using the supplied values", async () => {
    const r = await egg(["deploy", "resources", "set", "dep_1", "--cpu", "500", "--memory", "1Gi"], {
      "PATCH /api/v1/deployments/dep_1/resources": reply(200, { cpu: 500, memory: 1_073_741_824 }),
    });
    expect(r.code).toBe(0);
    expect(r.calls).toMatchObject([{ method: "PATCH", path: "/api/v1/deployments/dep_1/resources", body: { cpu: 500, memory: 1_073_741_824 } }]);
  });

  it("shows configured deployment volume mounts", async () => {
    const volumes = [{ mountPath: "/data", type: "persistent", size: "10Gi", readOnly: false }];
    const r = await egg(["deploy", "volumes", "get", "dep_1"], {
      "GET /api/v1/deployments/dep_1/deployment-volumes": reply(200, { volumes }),
    });
    expect(r.code).toBe(0);
    expect(r.calls).toMatchObject([{ method: "GET", path: "/api/v1/deployments/dep_1/deployment-volumes" }]);
    expect(r.out).toContain("/data");
    expect(r.out).toContain("10Gi");
  });

  it("requires the deployment name before replacing its volume list", async () => {
    const missing = await egg(["deploy", "volumes", "set", "dep_1", "--volume", "/data=1Gi"]);
    expect(missing.code).toBe(2);
    expect(missing.calls).toHaveLength(0);

    const wrong = await egg(["deploy", "volumes", "set", "dep_1", "--volume", "/data=1Gi", "--confirm-deployment", "Wrong name"], {
      "GET /api/v1/deployments/dep_1": reply(200, { deployment: { id: "dep_1", projectId: "p_1" } }),
      "GET /api/v1/projects/p_1": reply(200, { project: { id: "p_1", name: "My app" } }),
    });
    expect(wrong.code).toBe(2);
    expect(wrong.calls).toHaveLength(2);

    const replaced = await egg(["deploy", "volumes", "set", "dep_1", "--volume", "/data=1Gi", "--confirm-deployment", "My app"], {
      "GET /api/v1/deployments/dep_1": reply(200, { deployment: { id: "dep_1", projectId: "p_1" } }),
      "GET /api/v1/projects/p_1": reply(200, { project: { id: "p_1", name: "My app" } }),
      "PATCH /api/v1/deployments/dep_1/volumes": reply(200, { volumes: [{ mountPath: "/data", size: "1Gi" }] }),
    });
    expect(replaced.code).toBe(0);
    expect(replaced.calls).toMatchObject([
      { method: "GET", path: "/api/v1/deployments/dep_1" },
      { method: "GET", path: "/api/v1/projects/p_1" },
      { method: "PATCH", path: "/api/v1/deployments/dep_1/volumes", body: { volumes: [{ mountPath: "/data", size: "1Gi" }] } },
    ]);
  });

  it("removes every volume when replacing the list with no volume flags", async () => {
    const r = await egg(["deploy", "volumes", "set", "dep_1", "--confirm-deployment", "My app"], {
      "GET /api/v1/deployments/dep_1": reply(200, { deployment: { id: "dep_1", projectId: "p_1" } }),
      "GET /api/v1/projects/p_1": reply(200, { project: { id: "p_1", name: "My app" } }),
      "PATCH /api/v1/deployments/dep_1/volumes": reply(200, { volumes: [] }),
    });
    expect(r.code).toBe(0);
    expect(r.calls[r.calls.length - 1]).toMatchObject({
      method: "PATCH",
      path: "/api/v1/deployments/dep_1/volumes",
      body: { volumes: [] },
    });
  });

  it("sets the deployment update strategy", async () => {
    const r = await egg(["deploy", "strategy", "set", "dep_1", "--type", "rolling"], {
      "PATCH /api/v1/deployments/dep_1/strategy": reply(200, { type: "rolling" }),
    });
    expect(r.code).toBe(0);
    expect(r.calls).toMatchObject([{ method: "PATCH", path: "/api/v1/deployments/dep_1/strategy", body: { type: "rolling" } }]);
  });

  it("sets the deployment image pull policy", async () => {
    const r = await egg(["deploy", "pull-policy", "set", "dep_1", "--policy", "always"], {
      "PATCH /api/v1/deployments/dep_1/pull-policy": reply(200, { policy: "always" }),
    });
    expect(r.code).toBe(0);
    expect(r.calls).toMatchObject([{ method: "PATCH", path: "/api/v1/deployments/dep_1/pull-policy", body: { policy: "always" } }]);
  });

  it("updates the supported health-check path", async () => {
    const r = await egg(["deploy", "health-check", "set", "dep_1", "--path", "/health"], {
      "PATCH /api/v1/deployments/dep_1/health-check": reply(200, { path: "/health" }),
    });
    expect(r.code).toBe(0);
    expect(r.calls).toMatchObject([{ method: "PATCH", path: "/api/v1/deployments/dep_1/health-check", body: { path: "/health" } }]);
  });

  it("sets the supported deployment build-root configuration", async () => {
    const r = await egg(["deploy", "build-root", "set", "dep_1", "on", "--depot", "--persistent-cache"], {
      "PATCH /api/v1/deployments/dep_1/build-config": reply(200, { mode: "on", depot: true, persistentCache: true }),
    });
    expect(r.code).toBe(0);
    expect(r.calls).toMatchObject([
      { method: "PATCH", path: "/api/v1/deployments/dep_1/build-config", body: { mode: "on", depot: true, persistentCache: true } },
    ]);
  });

  it("updates supported build configuration fields", async () => {
    const r = await egg([
      "deploy", "build-config", "set", "dep_1",
      "--start-cmd", "node server.js", "--root", "app", "--install-cmd", "pnpm install",
      "--build-cmd", "pnpm build", "--output-dir", "dist",
    ], {
      "PATCH /api/v1/deployments/dep_1/build-config": reply(200, { updated: true }),
    });
    expect(r.code).toBe(0);
    expect(r.calls).toMatchObject([
      {
        method: "PATCH",
        path: "/api/v1/deployments/dep_1/build-config",
        body: {
          startCommand: "node server.js",
          rootDir: "app",
          installCommand: "pnpm install",
          buildCommand: "pnpm build",
          outputDir: "dist",
        },
      },
    ]);
  });
});
