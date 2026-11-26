import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Principal, Scope } from "@/server/api-tokens";
import { callEndpoint, ENDPOINTS } from "@/server/api-v1";
import { upsertUser } from "@/server/auth/session";
import { schema } from "@/server/db";
import { listInstallationRepos, type RepoSummary } from "@/server/github/app";
import { useFreshDb } from "@/server/test/db";

vi.mock("@/server/github/app", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/github/app")>();
  return { ...actual, listInstallationRepos: vi.fn() };
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
