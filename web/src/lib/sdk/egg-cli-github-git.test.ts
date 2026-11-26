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
