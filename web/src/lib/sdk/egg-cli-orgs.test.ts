import { describe, expect, it } from "vitest";
import type { FetchInit, FetchLike, FetchResponse } from "./egg";
import { parseCli, run } from "../../../scripts/egg-cli.mjs";

const TOKEN = "egg_orgs_test_token_123456";
const URL_BASE = "https://egg.example.com";
const ENV = { EGG_TOKEN: TOKEN, EGG_URL: URL_BASE };

function reply(status: number, body: unknown): FetchResponse {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return { ok: status >= 200 && status < 300, status, headers: { get: () => null }, text: async () => text };
}

type RouteHandler = (call: { url: URL; init: FetchInit }) => FetchResponse | Promise<FetchResponse>;
type Routes = Record<string, FetchResponse | Error | RouteHandler>;

function routes(table: Routes) {
  const calls: { method: string; path: string; body: unknown }[] = [];
  const fetch: FetchLike = async (rawUrl, init) => {
    const url = new URL(rawUrl);
    calls.push({
      method: init.method,
      path: url.pathname,
      body: init.body === undefined ? undefined : JSON.parse(init.body),
    });
    const entry = table[`${init.method} ${url.pathname}`];
    if (!entry) return reply(404, { error: { code: "not_found", message: `No fake route for ${init.method} ${url.pathname}` } });
    if (entry instanceof Error) throw entry;
    return typeof entry === "function" ? entry({ url, init }) : entry;
  };
  return { fetch, calls };
}

async function egg(argv: string[], table: Routes = {}, stdin?: string) {
  const { fetch, calls } = routes(table);
  let out = "";
  let err = "";
  const code: number = await run(argv, {
    env: ENV,
    fetch,
    stdin,
    stdout: { isTTY: true, write: (value: string) => void (out += value) },
    stderr: { write: (value: string) => void (err += value) },
  });
  return { code, out, err, calls };
}

const organization = { id: "org_1", slug: "acme", name: "Acme Org" };
const orgRoute = { "GET /api/v1/organizations/acme": reply(200, { organization }) };
const credentials = {
  credentials: [
    { id: "cred_1", organizationId: "org_1", registry: "registry.example", username: "robot", password: "stored-secret" },
    { id: "cred_2", organizationId: "org_2", registry: "elsewhere.example", username: "other", password: "other-secret" },
  ],
};

describe("org CLI parsing", () => {
  it.each([
    [["orgs", "list"], "orgs list"],
    [["orgs", "get", "--org", "acme"], "orgs get"],
    [["orgs", "registry", "list", "--org", "acme"], "orgs registry list"],
    [["orgs", "registry", "set", "registry.example", "--org", "acme", "--username", "robot", "--password", "secret"], "orgs registry set"],
    [["orgs", "registry", "set", "registry.example", "--org", "acme", "--username", "robot", "--password-stdin"], "orgs registry set"],
    [["orgs", "registry", "remove", "cred_1", "--org", "acme", "--confirm", "registry.example"], "orgs registry remove"],
  ])("parses %j", (argv, command) => {
    expect(parseCli(argv)).toMatchObject({ ok: true, command });
  });
});

describe("org commands", () => {
  it("lists organizations through the SDK endpoint", async () => {
    const r = await egg(["orgs", "list", "--json"], {
      "GET /api/v1/organizations": reply(200, { organizations: [organization] }),
    });
    expect(r.code).toBe(0);
    expect(r.calls).toEqual([{ method: "GET", path: "/api/v1/organizations", body: undefined }]);
    expect(JSON.parse(r.out).organizations[0]).toMatchObject({ id: "org_1", slug: "acme" });
  });

  it("gets the organization selected by --org", async () => {
    const r = await egg(["orgs", "get", "--org", "acme", "--json"], orgRoute);
    expect(r.code).toBe(0);
    expect(r.calls).toEqual([{ method: "GET", path: "/api/v1/organizations/acme", body: undefined }]);
    expect(JSON.parse(r.out)).toMatchObject({ id: "org_1", name: "Acme Org" });
  });
});

describe("organization registry commands", () => {
  it("lists only the selected organization's registry credentials and redacts passwords", async () => {
    const r = await egg(["orgs", "registry", "list", "--org", "acme", "--json", "--show-secrets"], {
      ...orgRoute,
      "GET /api/v1/registry-credentials": reply(200, credentials),
    });
    expect(r.code).toBe(0);
    expect(r.calls.map(({ method, path }) => [method, path])).toEqual([
      ["GET", "/api/v1/organizations/acme"],
      ["GET", "/api/v1/registry-credentials"],
    ]);
    const printed = JSON.parse(r.out) as { id: string; registry: string; password: string }[];
    expect(printed).toHaveLength(1);
    expect(printed[0]).toMatchObject({ id: "cred_1", registry: "registry.example", password: "[redacted]" });
    expect(r.out).not.toContain("elsewhere.example");
    expect(r.out).not.toContain("stored-secret");
  });

  it("sets a registry credential with --password", async () => {
    const secret = "new-password-secret";
    const r = await egg(["orgs", "registry", "set", "registry.example", "--org", "acme", "--username", "robot", "--password", secret, "--json"], {
      ...orgRoute,
      "PUT /api/v1/registry-credentials": reply(200, { credential: { registry: "registry.example", password: secret } }),
    });
    expect(r.code).toBe(0);
    expect(r.calls.at(-1)).toEqual({
      method: "PUT",
      path: "/api/v1/registry-credentials",
      body: { organizationId: "org_1", registry: "registry.example", username: "robot", password: secret },
    });
    expect(r.out).not.toContain(secret);
  });

  it("reads the registry password from stdin and does not print it even when secrets are requested", async () => {
    const secret = "stdin-password-secret";
    const r = await egg(["orgs", "registry", "set", "registry.example", "--org", "acme", "--username", "robot", "--password-stdin", "--show-secrets"], {
      ...orgRoute,
      "PUT /api/v1/registry-credentials": reply(200, { credential: { registry: "registry.example", password: secret } }),
    }, `${secret}\n`);
    expect(r.code).toBe(0);
    expect(r.calls.at(-1)?.body).toMatchObject({ password: secret });
    expect(r.out).not.toContain(secret);
    expect(r.err).not.toContain(secret);
  });

  it("redacts a password echoed in a registry API error", async () => {
    const secret = "rejected-password-secret";
    const r = await egg(["orgs", "registry", "set", "registry.example", "--org", "acme", "--username", "robot", "--password", secret], {
      ...orgRoute,
      "PUT /api/v1/registry-credentials": reply(400, { error: { code: "invalid_registry", message: `Rejected password ${secret}.` } }),
    });
    expect(r.code).toBe(1);
    expect(r.err).not.toContain(secret);
  });

  it("requires the exact registry host confirmation before deleting", async () => {
    const r = await egg(["orgs", "registry", "remove", "cred_1", "--org", "acme"], {
      ...orgRoute,
      "GET /api/v1/registry-credentials": reply(200, credentials),
    });
    expect(r.code).toBe(2);
    expect(r.calls).toHaveLength(0);
    expect(r.err).toContain("--confirm");
  });

  it("rejects a confirmation that does not exactly match the registry host", async () => {
    const r = await egg(["orgs", "registry", "remove", "cred_1", "--org", "acme", "--confirm", "acme"], {
      ...orgRoute,
      "GET /api/v1/registry-credentials": reply(200, credentials),
    });
    expect(r.code).toBe(2);
    expect(r.calls.some(({ method }) => method === "DELETE")).toBe(false);
  });

  it("deletes only after matching the registry host confirmation", async () => {
    const r = await egg(["orgs", "registry", "remove", "cred_1", "--org", "acme", "--confirm", "registry.example", "--json"], {
      ...orgRoute,
      "GET /api/v1/registry-credentials": reply(200, credentials),
      "DELETE /api/v1/registry-credentials/cred_1": reply(200, { deleted: true }),
    });
    expect(r.code).toBe(0);
    expect(r.calls.at(-1)).toEqual({
      method: "DELETE",
      path: "/api/v1/registry-credentials/cred_1",
      body: { organizationId: "org_1", confirmName: "registry.example" },
    });
  });
});
