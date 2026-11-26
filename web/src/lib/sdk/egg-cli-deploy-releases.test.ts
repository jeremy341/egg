import { describe, expect, it } from "vitest";
import type { FetchInit, FetchLike, FetchResponse } from "./egg";
import { parseCli, run } from "../../../scripts/egg-cli.mjs";

const TOKEN = "egg_test_token_deploy_releases";
const URL_BASE = "https://egg.example.com";
const ENV = { EGG_TOKEN: TOKEN, EGG_URL: URL_BASE };

function reply(status: number, body: unknown): FetchResponse {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return { ok: status >= 200 && status < 300, status, headers: { get: () => null }, text: async () => text };
}

type Handler = (call: { url: URL; init: FetchInit }) => FetchResponse | Promise<FetchResponse>;
type Routes = Record<string, FetchResponse | Handler>;

function routes(table: Routes) {
  const calls: { method: string; path: string; body: unknown }[] = [];
  const fetch: FetchLike = async (rawUrl, init) => {
    const url = new URL(rawUrl);
    calls.push({
      method: init.method,
      path: url.pathname,
      body: init.body === undefined ? undefined : JSON.parse(init.body),
    });
    const answer = table[`${init.method} ${url.pathname}`];
    if (!answer) return reply(404, { error: { code: "not_found", message: "Unexpected route" } });
    return typeof answer === "function" ? answer({ url, init }) : answer;
  };
  return { fetch, calls };
}

async function egg(argv: string[], table: Routes = {}) {
  const { fetch, calls } = routes(table);
  let out = "";
  let err = "";
  const result = await run(argv, {
    env: ENV,
    fetch,
    stdout: { isTTY: true, write: (text: string) => void (out += text) },
    stderr: { write: (text: string) => void (err += text) },
    sleep: async () => {},
    now: () => 0,
  });
  return { code: result, out, err, calls };
}

describe("deploy release commands", () => {
  it("parses and rolls back a deployment only after exact target confirmation", async () => {
    const argv = ["deploy", "rollback-to", "dep_1", "--confirm-deployment-id", "dep_1", "--json"];
    expect(parseCli(argv)).toMatchObject({ ok: true, command: "deploy rollback-to", args: ["dep_1"] });

    const result = await egg(argv, {
      "POST /api/v1/deployments/dep_1/rollback": reply(202, { deployment: { id: "dep_2", state: "queued" } }),
    });
    expect(result.code).toBe(0);
    expect(result.calls).toEqual([{ method: "POST", path: "/api/v1/deployments/dep_1/rollback", body: undefined }]);
    expect(JSON.parse(result.out)).toEqual({ deployment: { id: "dep_2", state: "queued" } });
  });

  it("rejects rollback without confirmation as a usage error before making a request", async () => {
    expect(parseCli(["deploy", "rollback-to", "dep_1"]).ok).toBe(false);
    const result = await egg(["deploy", "rollback-to", "dep_1"]);
    expect(result.code).toBe(2);
    expect(result.calls).toHaveLength(0);

    const wrong = await egg(["deploy", "rollback-to", "dep_1", "--confirm-deployment-id", "dep_2"]);
    expect(wrong.code).toBe(2);
    expect(wrong.calls).toHaveLength(0);
  });

  it("parses image updates and sends the requested image through the SDK", async () => {
    const argv = ["deploy", "image", "set", "dep_1", "ghcr.io/acme/app:v2", "--wait", "--timeout", "5s", "--json"];
    expect(parseCli(argv)).toMatchObject({ ok: true, command: "deploy image set", args: ["dep_1", "ghcr.io/acme/app:v2"] });

    const result = await egg(argv, {
      "PATCH /api/v1/deployments/dep_1/image": reply(200, { deployment: { id: "dep_1", state: "queued" } }),
      "GET /api/v1/deployments/dep_1": reply(200, { deployment: { id: "dep_1", state: "ready", image: "ghcr.io/acme/app:v2" } }),
    });
    expect(result.code).toBe(0);
    expect(result.calls).toEqual([
      { method: "PATCH", path: "/api/v1/deployments/dep_1/image", body: { image: "ghcr.io/acme/app:v2" } },
      { method: "GET", path: "/api/v1/deployments/dep_1", body: undefined },
    ]);
    expect(JSON.parse(result.out)).toEqual({ deployment: { id: "dep_1", state: "ready", image: "ghcr.io/acme/app:v2" } });
  });

  it("parses history lookup and resolves a deployment to its project's image history", async () => {
    const argv = ["deploy", "history", "dep_1", "--json"];
    expect(parseCli(argv)).toMatchObject({ ok: true, command: "deploy history", args: ["dep_1"] });

    const result = await egg(argv, {
      "GET /api/v1/deployments/dep_1": reply(200, { deployment: { id: "dep_1", projectId: "p_1" } }),
      "GET /api/v1/projects/p_1/image-history": reply(200, { history: [{ id: "img_1", image: "ghcr.io/acme/app:v1" }] }),
    });
    expect(result.code).toBe(0);
    expect(result.calls).toEqual([
      { method: "GET", path: "/api/v1/deployments/dep_1", body: undefined },
      { method: "GET", path: "/api/v1/projects/p_1/image-history", body: undefined },
    ]);
  });

  it("parses auto-deploy status and calls the project's status endpoint", async () => {
    const argv = ["deploy", "auto-deploy", "status", "p_1", "--json"];
    expect(parseCli(argv)).toMatchObject({ ok: true, command: "deploy auto-deploy status", args: ["p_1"] });

    const result = await egg(argv, {
      "GET /api/v1/projects/p_1/auto-deploy": reply(200, { enabled: true, branch: "main" }),
    });
    expect(result.code).toBe(0);
    expect(result.calls).toEqual([{ method: "GET", path: "/api/v1/projects/p_1/auto-deploy", body: undefined }]);
  });

  it("parses auto-deploy disable and calls the project's disable endpoint", async () => {
    const argv = ["deploy", "auto-deploy", "disable", "p_1", "--json"];
    expect(parseCli(argv)).toMatchObject({ ok: true, command: "deploy auto-deploy disable", args: ["p_1"] });

    const result = await egg(argv, {
      "DELETE /api/v1/projects/p_1/auto-deploy": reply(200, { enabled: false }),
    });
    expect(result.code).toBe(0);
    expect(result.calls).toEqual([{ method: "DELETE", path: "/api/v1/projects/p_1/auto-deploy", body: undefined }]);
  });
});
