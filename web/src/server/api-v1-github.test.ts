import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Principal, Scope } from "@/server/api-tokens";
import { callEndpoint, ENDPOINTS } from "@/server/api-v1";
import { GITHUB_ENDPOINTS } from "@/server/api-v1-github";
import { upsertUser } from "@/server/auth/session";
import { schema } from "@/server/db";
import { installationToken, listInstallationRepos, type RepoSummary } from "@/server/github/app";
import { useFreshDb } from "@/server/test/db";

vi.mock("@/server/github/app", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/github/app")>();
  return { ...actual, listInstallationRepos: vi.fn(), installationToken: vi.fn() };
});

let ctx: Awaited<ReturnType<typeof useFreshDb>>;
let me: { id: string };
let other: { id: string };
const principal = (userId: string, scopes: Scope[]): Principal => ({ userId, tokenId: "token", scopes });
const endpoint = () => ENDPOINTS.find((item) => item.id === "list_github_repos");

beforeAll(async () => {
  ctx = await useFreshDb();
  me = await upsertUser({ id: "repos-owner", name: "Sam", email: null, slackId: null });
  other = await upsertUser({ id: "repos-other", name: "Kim", email: null, slackId: null });
  await ctx.db.insert(schema.githubInstallations).values([
    { id: 1701, userId: me.id, accountLogin: "Acme", accountType: "Organization", createdAt: new Date() },
    { id: 1702, userId: me.id, accountLogin: "Sam", accountType: "User", createdAt: new Date() },
    { id: 2701, userId: other.id, accountLogin: "Other", accountType: "Organization", createdAt: new Date() },
  ]);
});
afterAll(async () => ctx.cleanup());
beforeEach(() => vi.mocked(listInstallationRepos).mockReset());

describe("list_github_repos MCP endpoint", () => {
  it("is a read tool scoped to the token owner's GitHub installations", () => {
    expect(endpoint()).toMatchObject({
      method: "GET",
      path: "/github/repos",
      scope: "projects:read",
      bucket: "read",
    });
  });

  it("returns repository metadata without clone credentials or token fields", async () => {
    const repos: Record<number, RepoSummary[]> = {
      1701: [
        {
          id: 81,
          fullName: "acme/site",
          private: true,
          defaultBranch: "main",
          pushedAt: "2026-11-23T10:00:00.000Z",
          cloneUrl: "https://ghs_hidden@github.com/acme/site.git",
        },
      ],
      1702: [
        {
          id: 92,
          fullName: "sam/tool",
          private: false,
          defaultBranch: "trunk",
          pushedAt: "2026-11-24T10:00:00.000Z",
          cloneUrl: "https://github.com/sam/tool.git",
        },
      ],
    };
    vi.mocked(listInstallationRepos).mockImplementation(async (id) => repos[id as keyof typeof repos] ?? []);
    const ep = endpoint();
    expect(ep).toBeDefined();
    if (!ep) return;

    const result = await callEndpoint(principal(me.id, ["projects:read"]), ep, {});
    expect(result).toEqual({
      repos: [
        {
          id: 92,
          installationId: 1702,
          account: "Sam",
          accountType: "User",
          fullName: "sam/tool",
          private: false,
          defaultBranch: "trunk",
          pushedAt: "2026-11-24T10:00:00.000Z",
        },
        {
          id: 81,
          installationId: 1701,
          account: "Acme",
          accountType: "Organization",
          fullName: "acme/site",
          private: true,
          defaultBranch: "main",
          pushedAt: "2026-11-23T10:00:00.000Z",
        },
      ],
    });
    expect(JSON.stringify(result)).not.toContain("ghs_hidden");
    expect(listInstallationRepos).toHaveBeenNthCalledWith(1, 1701);
    expect(listInstallationRepos).toHaveBeenNthCalledWith(2, 1702);
  });

  it("can limit results to an owned installation and refuses another owner's installation", async () => {
    vi.mocked(listInstallationRepos).mockResolvedValue([]);
    const ep = endpoint();
    expect(ep).toBeDefined();
    if (!ep) return;

    await callEndpoint(principal(me.id, ["projects:read"]), ep, { installation: "1702" });
    expect(listInstallationRepos).toHaveBeenCalledTimes(1);
    expect(listInstallationRepos).toHaveBeenCalledWith(1702);

    await expect(callEndpoint(principal(me.id, ["projects:read"]), ep, { installation: "2701" })).rejects.toMatchObject({ status: 404 });
    expect(listInstallationRepos).toHaveBeenCalledTimes(1);
  });

  it("checks projects:read before calling GitHub", async () => {
    const ep = endpoint();
    expect(ep).toBeDefined();
    if (!ep) return;

    await expect(callEndpoint(principal(me.id, ["projects:write"]), ep, {})).rejects.toMatchObject({ status: 403 });
    expect(listInstallationRepos).not.toHaveBeenCalled();
  });
});

describe("GITHUB_ENDPOINTS", () => {
  const githubEndpoint = (id: string) => {
    const found = GITHUB_ENDPOINTS.find((e) => e.id === id);
    expect(found, `endpoint ${id} exists`).toBeDefined();
    if (!found) throw new Error(`Missing endpoint ${id}`);
    return found;
  };
  const callGithub = (id: string, input: Record<string, unknown> = {}) =>
    callEndpoint(principal(me.id, ["projects:read"]), githubEndpoint(id), input);
  const stubFetch = (payload: unknown) => {
    const fn = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => payload });
    vi.stubGlobal("fetch", fn);
    return fn;
  };

  beforeEach(() => {
    vi.mocked(installationToken).mockReset();
    vi.mocked(installationToken).mockResolvedValue("ghs_hidden");
  });
  afterEach(() => vi.unstubAllGlobals());

  it("exports all seven GitHub endpoints as read tools", () => {
    expect(GITHUB_ENDPOINTS.map((e) => e.id)).toEqual([
      "list_github_repos",
      "get_repo_branches",
      "get_repo_contents",
      "get_repo_dockerfiles",
      "detect_repo_config",
      "get_github_status",
      "list_github_deploy_targets",
    ]);
    expect(GITHUB_ENDPOINTS.every((e) => e.method === "GET" && e.scope === "projects:read" && e.bucket === "read" && e.readOnly)).toBe(true);
  });

  it("lists branches for an owned installation without leaking the token", async () => {
    const fetchMock = stubFetch([
      { name: "main", commit: { sha: "aaa" }, protected: true },
      { name: "dev", commit: { sha: "bbb" }, protected: false },
    ]);
    const result = await callGithub("get_repo_branches", { installation: 1701, repo: "acme/site", limit: 10 });
    expect(result).toEqual({
      repo: "acme/site",
      branches: [
        { name: "main", sha: "aaa", protected: true },
        { name: "dev", sha: "bbb", protected: false },
      ],
    });
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.github.com/repos/acme/site/branches?per_page=10");
    expect(JSON.stringify(result)).not.toContain("ghs_hidden");

    await expect(callGithub("get_repo_branches", { installation: 2701, repo: "acme/site" })).rejects.toMatchObject({ status: 404 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("reads a text file, dropping download URLs and refusing path traversal", async () => {
    stubFetch({
      name: "README.md",
      path: "README.md",
      type: "file",
      size: 5,
      sha: "s",
      encoding: "base64",
      content: Buffer.from("hello").toString("base64"),
      download_url: "https://github.com/acme/site/raw/README.md",
    });
    const result = await callGithub("get_repo_contents", { installation: 1701, repo: "acme/site", path: "README.md" });
    expect(result).toMatchObject({ path: "README.md", type: "file", name: "README.md", content: "hello", truncated: false });
    expect(JSON.stringify(result)).not.toContain("download_url");
    expect(JSON.stringify(result)).not.toContain("ghs_hidden");

    await expect(
      callGithub("get_repo_contents", { installation: 1701, repo: "acme/site", path: "../secret" })
    ).rejects.toMatchObject({ status: 400 });
  });

  it("finds Dockerfiles and Compose files in a repository tree", async () => {
    stubFetch({
      tree: [
        { path: "Dockerfile", type: "blob" },
        { path: "web/Dockerfile.prod", type: "blob" },
        { path: "docker-compose.yml", type: "blob" },
        { path: "README.md", type: "blob" },
        { path: "docs", type: "tree" },
      ],
      truncated: false,
    });
    expect(await callGithub("get_repo_dockerfiles", { installation: 1701, repo: "acme/site", ref: "main" })).toEqual({
      repo: "acme/site",
      branch: "main",
      dockerfiles: ["Dockerfile", "web/Dockerfile.prod"],
      composeFiles: ["docker-compose.yml"],
      truncated: false,
    });
  });

  it("suggests a runtime and commands from a repository's root files", async () => {
    stubFetch([
      {
        name: "package.json",
        path: "package.json",
        type: "file",
        encoding: "base64",
        content: Buffer.from(JSON.stringify({ scripts: { build: "tsc", start: "node dist/index.js" } })).toString("base64"),
      },
      { name: "README.md", path: "README.md", type: "file" },
    ]);
    const result = await callGithub("detect_repo_config", { installation: 1701, repo: "acme/site", ref: "main" });
    expect(result).toMatchObject({
      runtime: "node",
      signals: ["package.json"],
      scripts: { build: "tsc", start: "node dist/index.js" },
      suggestion: { installCommand: "npm install", buildCommand: "npm run build", startCommand: "npm run start" },
    });
    expect(JSON.stringify(result)).not.toContain("ghs_hidden");
  });

  it("reports status and deploy targets without secrets", async () => {
    const status = await callGithub("get_github_status");
    expect(status).toMatchObject({
      connected: true,
      installations: [
        { id: 1701, accountLogin: "Acme", accountType: "Organization" },
        { id: 1702, accountLogin: "Sam", accountType: "User" },
      ],
    });
    expect(JSON.stringify(status)).not.toContain("ghs_hidden");
    expect(await callGithub("list_github_deploy_targets", {})).toEqual({ targets: [] });
  });

  it("checks projects:read before calling GitHub", async () => {
    const fetchMock = stubFetch([]);
    await expect(
      callEndpoint(principal(me.id, ["projects:write"]), githubEndpoint("get_repo_dockerfiles"), { installation: 1701, repo: "acme/site" })
    ).rejects.toMatchObject({ status: 403 });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
