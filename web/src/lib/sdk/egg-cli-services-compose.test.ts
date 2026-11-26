import { describe, expect, it } from "vitest";
import type { FetchInit, FetchLike, FetchResponse } from "./egg";
import { parseCli, run } from "../../../scripts/egg-cli.mjs";

const TOKEN = "egg_services_compose_test_token";
const ENV = { EGG_TOKEN: TOKEN, EGG_URL: "https://egg.example.com" };

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
    if (!entry) {
      return reply(404, { error: { code: "not_found", message: `No fake route for ${init.method} ${url.pathname}` } });
    }
    return typeof entry === "function" ? entry({ url, init }) : entry;
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
    stdout: { isTTY: true, write: (text: string) => void (out += text) },
    stderr: { write: (text: string) => void (err += text) },
  });
  return { code, out, err, calls };
}

describe("Egg Compose CLI", () => {
  it("parses compose list and calls listComposeStacks", async () => {
    const stacks = [{ id: "stk_1", name: "Store" }];
    expect(parseCli(["compose", "list", "--json"])).toMatchObject({ ok: true, command: "compose list" });

    const r = await egg(["compose", "list", "--json"], {
      "GET /api/v1/compose-stacks": reply(200, { stacks }),
    });

    expect(r.code).toBe(0);
    expect(r.calls).toMatchObject([{ method: "GET", path: "/api/v1/compose-stacks" }]);
    expect(JSON.parse(r.out)).toEqual({ stacks });
  });

  it("parses compose show and calls getComposeStack with the stack id", async () => {
    const stack = { id: "stk_1", name: "Store", deployments: [] };
    expect(parseCli(["compose", "show", "stk_1"])).toMatchObject({
      ok: true,
      command: "compose show",
      args: ["stk_1"],
    });

    const r = await egg(["compose", "show", "stk_1"], {
      "GET /api/v1/compose-stacks/stk_1": reply(200, { stack }),
    });

    expect(r.code).toBe(0);
    expect(r.calls).toMatchObject([{ method: "GET", path: "/api/v1/compose-stacks/stk_1" }]);
    expect(r.out).toContain("Store");
  });

  it("parses compose redeploy and calls redeployComposeStack with the stack id", async () => {
    const result = { deployment: { id: "dep_2", state: "queued" } };
    expect(parseCli(["compose", "redeploy", "stk_1"])).toMatchObject({
      ok: true,
      command: "compose redeploy",
      args: ["stk_1"],
    });

    const r = await egg(["compose", "redeploy", "stk_1"], {
      "POST /api/v1/compose-stacks/stk_1/redeploy": reply(202, result),
    });

    expect(r.code).toBe(0);
    expect(r.calls).toMatchObject([{ method: "POST", path: "/api/v1/compose-stacks/stk_1/redeploy", body: {} }]);
    expect(r.out).toContain("dep_2");
  });

  it("parses compose delete, requires an exact stack name, and removes its deployments", async () => {
    const stack = { id: "stk_1", name: "Store" };
    expect(parseCli(["compose", "delete", "stk_1", "--confirm", "Store"])).toMatchObject({
      ok: true,
      command: "compose delete",
      args: ["stk_1"],
      flags: { confirm: "Store" },
    });

    const missing = await egg(["compose", "delete", "stk_1"]);
    expect(missing.code).toBe(2);
    expect(missing.calls).toHaveLength(0);

    const wrong = await egg(["compose", "delete", "stk_1", "--confirm", "all"], {
      "GET /api/v1/compose-stacks/stk_1": reply(200, { stack }),
    });
    expect(wrong.code).toBe(2);
    expect(wrong.calls).toHaveLength(1);

    const deleted = await egg(["compose", "delete", "stk_1", "--confirm", "Store"], {
      "GET /api/v1/compose-stacks/stk_1": reply(200, { stack }),
      "DELETE /api/v1/projects/stk_1": reply(200, { deleted: true, projectId: "stk_1", removedFromServer: true }),
    });
    expect(deleted.code).toBe(0);
    expect(deleted.calls).toMatchObject([
      { method: "GET", path: "/api/v1/compose-stacks/stk_1" },
      { method: "DELETE", path: "/api/v1/projects/stk_1", search: "?removeFromServer=true" },
    ]);
  });
});
