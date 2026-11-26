import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { FetchInit, FetchLike, FetchResponse } from "./egg";
import { parseCli, run } from "../../../scripts/egg-cli.mjs";

const TOKEN = "egg_bindings_env_test_token";
const ENV = { EGG_TOKEN: TOKEN, EGG_URL: "https://egg.example.com" };
const environments = [
  { id: "env_1", name: "Staging", isDefault: false },
  { id: "env_2", name: "Production", isDefault: true },
];

function reply(status: number, body: unknown): FetchResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    text: async () => JSON.stringify(body),
  };
}

type Handler = (call: { url: URL; init: FetchInit }) => FetchResponse | Promise<FetchResponse>;
type Routes = Record<string, FetchResponse | Handler>;

async function egg(argv: string[], routes: Routes = {}) {
  const calls: { method: string; path: string; body: unknown }[] = [];
  const fetch: FetchLike = async (rawUrl, init) => {
    const url = new URL(rawUrl);
    calls.push({
      method: init.method,
      path: url.pathname,
      body: init.body === undefined ? undefined : JSON.parse(init.body),
    });
    const route = routes[`${init.method} ${url.pathname}`];
    if (!route) return reply(404, { error: { code: "not_found", message: "No fake route." } });
    return typeof route === "function" ? route({ url, init }) : route;
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

const LIST = { "GET /api/v1/environments": reply(200, { environments }) };

describe("bindings-env CLI commands", () => {
  it("parses each implemented command and its group options", () => {
    const cases: [string[], string][] = [
      [["env", "get", "Staging"], "env get"],
      [["env", "get-default"], "env get-default"],
      [["env", "create", "--name", "Preview", "--slug", "preview"], "env create"],
      [["env", "sets", "remove", "Staging", "--confirm", "Staging"], "env sets remove"],
      [["env", "set-default", "Staging"], "env set-default"],
      [["env", "vars", "get", "Staging", "--show-values"], "env vars get"],
      [["env", "vars", "set", "Staging", "API_URL=https://api.example", "--file", ".env"], "env vars set"],
      [["env", "vars", "unset", "Staging", "API_URL", "--confirm", "Staging"], "env vars unset"],
    ];

    for (const [argv, command] of cases) {
      expect(parseCli(argv), command).toMatchObject({ ok: true, command });
    }
  });

  it("gets a named shared environment through listEnvironments", async () => {
    const result = await egg(["env", "get", "Staging", "--json"], LIST);

    expect(result.code).toBe(0);
    expect(result.calls).toEqual([{ method: "GET", path: "/api/v1/environments", body: undefined }]);
    expect(JSON.parse(result.out)).toEqual({ environment: environments[0] });
  });

  it("gets the default shared environment when requested", async () => {
    const result = await egg(["env", "get-default", "--json"], LIST);

    expect(result.code).toBe(0);
    expect(result.calls).toHaveLength(1);
    expect(JSON.parse(result.out)).toEqual({ environment: environments[1] });
  });

  it("creates a shared environment by name", async () => {
    const created = { id: "env_3", name: "Preview", isDefault: false };
    const result = await egg(["env", "create", "--name", "Preview"], {
      "POST /api/v1/environments": reply(201, { environment: created }),
    });

    expect(result.code).toBe(0);
    expect(result.calls).toEqual([{ method: "POST", path: "/api/v1/environments", body: { name: "Preview" } }]);
    expect(result.out).toContain("Preview");
  });

  it("deletes a shared environment only with its exact name", async () => {
    const result = await egg(["env", "sets", "remove", "Staging", "--confirm", "Staging"], {
      ...LIST,
      "DELETE /api/v1/environments/env_1": reply(200, { deleted: { id: "env_1", name: "Staging" } }),
    });

    expect(result.code).toBe(0);
    expect(result.calls).toEqual([
      { method: "GET", path: "/api/v1/environments", body: undefined },
      { method: "DELETE", path: "/api/v1/environments/env_1", body: { confirmName: "Staging" } },
    ]);
  });

  it("rejects a destructive delete without confirmation with exit 2", async () => {
    const result = await egg(["env", "sets", "remove", "Staging"], LIST);

    expect(result.code).toBe(2);
    expect(result.calls).toEqual([]);
  });

  it("rejects a destructive delete when the confirmation is not the exact name", async () => {
    const result = await egg(["env", "sets", "remove", "Staging", "--confirm", "staging"], LIST);

    expect(result.code).toBe(2);
    expect(result.calls).toEqual([{ method: "GET", path: "/api/v1/environments", body: undefined }]);
  });

  it("sets the default shared environment by name", async () => {
    const result = await egg(["env", "set-default", "Staging"], {
      ...LIST,
      "PUT /api/v1/environments/env_1/default": reply(200, { environment: environments[0] }),
    });

    expect(result.code).toBe(0);
    expect(result.calls).toEqual([
      { method: "GET", path: "/api/v1/environments", body: undefined },
      { method: "PUT", path: "/api/v1/environments/env_1/default", body: undefined },
    ]);
  });

  it("lists shared variable names and targets without requesting values", async () => {
    const env = [{ key: "API_URL", target: "all" }];
    const result = await egg(["env", "vars", "get", "Staging", "--json"], {
      ...LIST,
      "GET /api/v1/environments/env_1/variables": reply(200, { env }),
    });

    expect(result.code).toBe(0);
    expect(result.calls).toEqual([
      { method: "GET", path: "/api/v1/environments", body: undefined },
      { method: "GET", path: "/api/v1/environments/env_1/variables", body: undefined },
    ]);
    expect(JSON.parse(result.out)).toEqual({ env });
  });

  it("rejects --show-values because this endpoint never returns values", async () => {
    const result = await egg(["env", "vars", "get", "Staging", "--show-values"], LIST);

    expect(result.code).toBe(2);
    expect(result.calls).toEqual([]);
  });

  it("merges inline assignments without printing submitted values", async () => {
    const value = "postgres://secret-user:secret-password@db.example/private";
    const result = await egg(["env", "vars", "set", "Staging", `DATABASE_URL=${value}`], {
      ...LIST,
      "POST /api/v1/environments/env_1/variables": reply(200, { env: [{ key: "DATABASE_URL", target: "all" }] }),
    });

    expect(result.code).toBe(0);
    expect(result.calls.at(-1)).toEqual({
      method: "POST",
      path: "/api/v1/environments/env_1/variables",
      body: { envVars: [{ key: "DATABASE_URL", value, target: "all" }] },
    });
    expect(`${result.out}${result.err}`).not.toContain(value);
    expect(`${result.out}${result.err}`).not.toContain("secret-password");
  });

  it("merges dotenv entries alongside the inline assignment", async () => {
    const directory = mkdtempSync(join(tmpdir(), "egg-cli-bindings-env-"));
    const file = join(directory, ".env");
    writeFileSync(file, "FIRST=one\nSECOND='two words'\n# ignored\n");
    try {
      const result = await egg(["env", "vars", "set", "Staging", "THIRD=three", "--file", file], {
        ...LIST,
        "POST /api/v1/environments/env_1/variables": reply(200, {
          env: ["FIRST", "SECOND", "THIRD"].map((key) => ({ key, target: "all" })),
        }),
      });

      expect(result.code).toBe(0);
      expect(result.calls.at(-1)?.body).toEqual({
        envVars: [
          { key: "FIRST", value: "one", target: "all" },
          { key: "SECOND", value: "two words", target: "all" },
          { key: "THIRD", value: "three", target: "all" },
        ],
      });
      expect(`${result.out}${result.err}`).not.toContain("two words");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("rejects --secret because shared-variable writes have no secret marker", async () => {
    const value = "must-not-appear-in-output";
    const result = await egg(["env", "vars", "set", "Staging", `API_KEY=${value}`, "--secret"], LIST);

    expect(result.code).toBe(2);
    expect(result.calls).toEqual([]);
    expect(`${result.out}${result.err}`).not.toContain(value);
  });

  it("removes a named variable with exact environment confirmation", async () => {
    const result = await egg(["env", "vars", "unset", "Staging", "API_URL", "--confirm", "Staging"], {
      ...LIST,
      "DELETE /api/v1/environments/env_1/variables": reply(200, { deleted: [{ key: "API_URL", target: "all" }] }),
    });

    expect(result.code).toBe(0);
    expect(result.calls.at(-1)).toEqual({
      method: "DELETE",
      path: "/api/v1/environments/env_1/variables",
      body: { keys: ["API_URL"], confirmName: "Staging" },
    });
  });
});
