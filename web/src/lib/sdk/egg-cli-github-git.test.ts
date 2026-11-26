import { describe, expect, it } from "vitest";
import type { FetchInit, FetchLike, FetchResponse } from "./egg";
import { parseCli, run } from "../../../scripts/egg-cli.mjs";

const TOKEN = "egg_githubgroupsecrettoken123";
const ENV = { EGG_TOKEN: TOKEN, EGG_URL: "https://egg.example.com" };

function reply(status: number, body: unknown): FetchResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    text: async () => JSON.stringify(body),
  };
}

type Routes = Record<string, FetchResponse>;

function routes(table: Routes) {
  const calls: { method: string; path: string; search: string; auth: string | undefined }[] = [];
  const fetch: FetchLike = async (rawUrl, init: FetchInit) => {
    const url = new URL(rawUrl);
    calls.push({
      method: init.method,
      path: url.pathname,
      search: url.search,
      auth: init.headers.Authorization,
    });
    return table[`${init.method} ${url.pathname}`] ?? reply(404, { error: { code: "not_found", message: "No fake route." } });
  };
  return { fetch, calls };
}

async function egg(argv: string[], table: Routes) {
  const { fetch, calls } = routes(table);
  let out = "";
  let err = "";
  const code = await run(argv, {
    env: ENV,
    fetch,
    isTTY: true,
    stdout: { isTTY: true, write: (text: string) => void (out += text) },
    stderr: { write: (text: string) => void (err += text) },
  });
  return { code, out, err, calls };
}

describe("github-git CLI group", () => {
  it("parses GitHub status and prints linked installations as redacted JSON", async () => {
    expect(parseCli(["github", "status", "--json"])).toMatchObject({
      ok: true,
      command: "github status",
      args: [],
    });

    const result = await egg(["github", "status", "--json"], {
      "GET /api/v1/github/status": reply(200, {
        connected: true,
        installations: [{ id: 123, accountLogin: "acme", accountType: "Organization", createdAt: "2026-01-01T00:00:00.000Z", token: "ghs_never_print_this" }],
      }),
    });

    expect(result.code).toBe(0);
    expect(result.calls).toMatchObject([{ method: "GET", path: "/api/v1/github/status", search: "" }]);
    expect(JSON.parse(result.out)).toEqual({
      connected: true,
      installations: [{ id: 123, accountLogin: "acme", accountType: "Organization", createdAt: "2026-01-01T00:00:00.000Z", token: "[redacted]" }],
    });
    expect(result.out).not.toContain("ghs_never_print_this");
  });

  it("lists installation ids and account names through GitHub status", async () => {
    expect(parseCli(["github", "installations"])).toMatchObject({
      ok: true,
      command: "github installations",
      args: [],
    });

    const result = await egg(["github", "installations"], {
      "GET /api/v1/github/status": reply(200, {
        connected: true,
        installations: [{ id: 123, accountLogin: "acme", accountType: "Organization", createdAt: "2026-01-01T00:00:00.000Z" }],
      }),
    });

    expect(result.code).toBe(0);
    expect(result.calls).toMatchObject([{ method: "GET", path: "/api/v1/github/status", search: "" }]);
    expect(result.out).toContain("123");
    expect(result.out).toContain("acme");
    expect(result.err).toBe("");
  });

  it("lists repository branches with the required installation and optional limit", async () => {
    expect(parseCli(["github", "branches", "sam/app", "--installation", "42", "--limit", "10"])).toMatchObject({
      ok: true,
      command: "github branches",
      args: ["sam/app"],
      flags: { installation: "42", limit: "10" },
    });

    const result = await egg(["github", "branches", "sam/app", "--installation", "42", "--limit", "10"], {
      "GET /api/v1/github/branches": reply(200, { branches: [{ name: "main" }, { name: "stable" }] }),
    });

    expect(result.code).toBe(0);
    expect(result.calls).toMatchObject([
      { method: "GET", path: "/api/v1/github/branches", search: "?installation=42&repo=sam%2Fapp&limit=10" },
    ]);
    expect(result.out).toContain("main");
    expect(result.err).toBe("");
  });

  it("treats a missing branch installation as incorrect usage", async () => {
    const result = await egg(["github", "branches", "sam/app"], {});

    expect(result.code).toBe(2);
    expect(result.err).toContain("needs --installation");
    expect(result.calls).toEqual([]);
  });

  it("finds repository Dockerfiles with the required installation and optional ref", async () => {
    expect(parseCli(["github", "dockerfiles", "sam/app", "--installation", "42", "--ref", "stable"])).toMatchObject({
      ok: true,
      command: "github dockerfiles",
      args: ["sam/app"],
      flags: { installation: "42", ref: "stable" },
    });

    const result = await egg(["github", "dockerfiles", "sam/app", "--installation", "42", "--ref", "stable"], {
      "GET /api/v1/github/dockerfiles": reply(200, { dockerfiles: ["Dockerfile", "services/api/Dockerfile"] }),
    });

    expect(result.code).toBe(0);
    expect(result.calls).toMatchObject([
      { method: "GET", path: "/api/v1/github/dockerfiles", search: "?installation=42&repo=sam%2Fapp&ref=stable" },
    ]);
    expect(result.out).toContain("Dockerfile");
    expect(result.err).toBe("");
  });

  it("treats a missing Dockerfile installation as incorrect usage", async () => {
    const result = await egg(["github", "dockerfiles", "sam/app"], {});

    expect(result.code).toBe(2);
    expect(result.err).toContain("needs --installation");
    expect(result.calls).toEqual([]);
  });

  it("parses and lists repositories through the typed GitHub repository endpoint", async () => {
    expect(parseCli(["github", "repos"])).toMatchObject({ ok: true, command: "github repos", args: [] });

    const response = { repos: [{ fullName: "sam/app", defaultBranch: "main" }] };
    const result = await egg(["github", "repos"], { "GET /api/v1/github/repos": reply(200, response) });

    expect(result.code).toBe(0);
    expect(result.calls).toMatchObject([{ method: "GET", path: "/api/v1/github/repos", search: "" }]);
    expect(result.out).toContain("sam/app");
    expect(result.err).toBe("");
  });

  it("parses repository contents, passes repo/path/branch, and redacts secret fields", async () => {
    expect(parseCli(["github", "contents", "sam/app", "src", "--branch", "stable"])).toMatchObject({
      ok: true,
      command: "github contents",
      args: ["sam/app", "src"],
      flags: { branch: "stable" },
    });

    const result = await egg(["github", "contents", "sam/app", "src", "--branch", "stable", "--json"], {
      "GET /api/v1/github/contents": reply(200, {
        entries: [{ path: "src/server.ts", type: "file", token: "ghp_do_not_print_this" }],
      }),
    });

    expect(result.code).toBe(0);
    expect(result.calls).toMatchObject([
      { method: "GET", path: "/api/v1/github/contents", search: "?repo=sam%2Fapp&path=src&branch=stable" },
    ]);
    expect(JSON.parse(result.out)).toEqual({ entries: [{ path: "src/server.ts", type: "file", token: "[redacted]" }] });
    expect(result.out).not.toContain("ghp_do_not_print_this");
  });

  it("reports Dockerfile build metadata without printing raw build argument values", async () => {
    expect(parseCli(["github", "dockerfile-info", "sam/app", "Dockerfile", "--branch", "stable"])).toMatchObject({
      ok: true,
      command: "github dockerfile-info",
      args: ["sam/app", "Dockerfile"],
      flags: { branch: "stable" },
    });

    const result = await egg(["github", "dockerfile-info", "sam/app", "Dockerfile", "--branch", "stable"], {
      "GET /api/v1/github/contents": reply(200, {
        content: [
          "FROM node:22-alpine",
          "WORKDIR /app",
          "ARG PRIVATE_TOKEN=do-not-print-this",
          "ENV API_KEY=also-do-not-print-this",
          "RUN npm ci",
          "EXPOSE 3000",
          'CMD ["node", "server.js"]',
        ].join("\n"),
      }),
    });

    expect(result.code).toBe(0);
    expect(result.calls).toMatchObject([
      { method: "GET", path: "/api/v1/github/contents", search: "?repo=sam%2Fapp&path=Dockerfile&branch=stable" },
    ]);
    expect(result.out).toContain("Stages 1");
    expect(result.out).toContain("Run steps 1");
    expect(result.out).toContain("Exposed ports 3000");
    expect(result.out).not.toContain("do-not-print-this");
    expect(result.out).not.toContain("also-do-not-print-this");
  });
});
