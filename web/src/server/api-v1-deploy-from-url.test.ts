import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiDeployBranch } from "@/server/api-v1";
import { apiUpdateDeploymentGithubRepository } from "@/server/api-v1-deployments";
import { GithubError, getGithubRepositoryDefaultBranch } from "@/server/github/app";
import { getProjectForUser } from "@/server/projects";
import type { Principal } from "@/server/api-tokens";
import { apiDeployFromGithubUrl, parseGithubRepositoryUrl } from "@/server/api-v1-deploy-from-url";

vi.mock("@/server/api-v1", () => ({ apiDeployBranch: vi.fn() }));
vi.mock("@/server/api-v1-deployments", () => ({ apiUpdateDeploymentGithubRepository: vi.fn() }));
vi.mock("@/server/projects", () => ({ getProjectForUser: vi.fn() }));
vi.mock("@/server/github/app", () => ({
  GithubError: class extends Error {
    constructor(message: string, readonly status?: number) { super(message); }
  },
  getGithubRepositoryDefaultBranch: vi.fn(),
}));

describe("parseGithubRepositoryUrl", () => {
  it.each([
    ["HTTPS repository URL", "https://github.com/octo-cat/demo", { repoFullName: "octo-cat/demo" }],
    ["HTTPS .git URL", "https://github.com/octo-cat/demo.git", { repoFullName: "octo-cat/demo" }],
    ["SSH .git URL", "git@github.com:octo-cat/demo.git", { repoFullName: "octo-cat/demo" }],
    ["tree branch URL", "https://github.com/octo-cat/demo/tree/main", { repoFullName: "octo-cat/demo", branch: "main" }],
    ["tree branch with slashes", "https://github.com/octo-cat/demo/tree/feature/cache", { repoFullName: "octo-cat/demo", branch: "feature/cache" }],
    ["encoded slash in branch", "https://github.com/octo-cat/demo/tree/feature%2Fcache", { repoFullName: "octo-cat/demo", branch: "feature/cache" }],
    [".git URL with tree branch", "https://github.com/octo-cat/demo.git/tree/release/next", { repoFullName: "octo-cat/demo", branch: "release/next" }],
  ])("accepts %s", (_label, value, expected) => {
    expect(parseGithubRepositoryUrl(value)).toEqual(expected);
  });

  it.each([
    "",
    "not a URL",
    "http://github.com/octo-cat/demo",
    "https://github.com.evil.test/octo-cat/demo",
    "https://evil.test/octo-cat/demo",
    "ssh://git@github.com/octo-cat/demo.git",
    "git@evil.test:octo-cat/demo.git",
    "git@github.com:octo-cat",
    "https://github.com/octo-cat",
    "https://github.com/octo-cat/demo/issues",
    "https://github.com/octo-cat/demo/tree/",
    "https://github.com/octo-cat/demo?tab=readme",
    "https://github.com/octo-cat/demo#readme",
    "https://user:secret@github.com/octo-cat/demo",
    "https://github.com/octo-cat/demo/tree/%2E%2E",
    "https://github.com/octo-cat/demo/tree/feature%2F..",
  ])("rejects invalid URL %s", (value) => {
    expect(parseGithubRepositoryUrl(value)).toBeNull();
  });
});

describe("apiDeployFromGithubUrl", () => {
  const principal = (scopes: Principal["scopes"]): Principal => ({
    userId: "user-1",
    tokenId: "token-1",
    scopes,
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getProjectForUser).mockResolvedValue({ installationId: 44 } as never);
    vi.mocked(getGithubRepositoryDefaultBranch).mockResolvedValue("main");
    vi.mocked(apiUpdateDeploymentGithubRepository).mockResolvedValue({ project: { id: "project-1" } } as never);
    vi.mocked(apiDeployBranch).mockResolvedValue({ deployment: { id: "deployment-1" } } as never);
  });

  it("updates to the repository default branch before queueing production", async () => {
    const p = principal(["projects:write", "deployments:write"]);
    const result = await apiDeployFromGithubUrl(p, "project-1", "https://github.com/octo-cat/demo");

    expect(getProjectForUser).toHaveBeenCalledWith("user-1", "project-1");
    expect(getGithubRepositoryDefaultBranch).toHaveBeenCalledWith(44, "octo-cat/demo");
    expect(apiUpdateDeploymentGithubRepository).toHaveBeenCalledWith(p, "project-1", {
      repoFullName: "octo-cat/demo",
      productionBranch: "main",
    });
    expect(apiDeployBranch).toHaveBeenCalledWith(p, "project-1", undefined, "deploy.from_github_url");
    expect(result).toEqual({ project: { id: "project-1" }, deployment: { id: "deployment-1" } });
  });

  it("uses the URL branch without looking up the default", async () => {
    const p = principal(["projects:write", "deployments:write"]);
    await apiDeployFromGithubUrl(p, "project-1", "https://github.com/octo-cat/demo/tree/feature/cache");

    expect(getGithubRepositoryDefaultBranch).not.toHaveBeenCalled();
    expect(apiUpdateDeploymentGithubRepository).toHaveBeenCalledWith(p, "project-1", {
      repoFullName: "octo-cat/demo",
      productionBranch: "feature/cache",
    });
  });

  it("checks both write scopes before reading GitHub", async () => {
    await expect(apiDeployFromGithubUrl(principal(["deployments:write"]), "project-1", "https://github.com/octo-cat/demo"))
      .rejects.toMatchObject({ status: 403 });
    await expect(apiDeployFromGithubUrl(principal(["projects:write"]), "project-1", "https://github.com/octo-cat/demo"))
      .rejects.toMatchObject({ status: 403 });
    expect(getProjectForUser).not.toHaveBeenCalled();
    expect(getGithubRepositoryDefaultBranch).not.toHaveBeenCalled();
  });

  it("returns a credential-free 400 for a malformed URL", async () => {
    const secret = "should-never-appear";
    await expect(apiDeployFromGithubUrl(
      principal(["projects:write", "deployments:write"]),
      "project-1",
      `https://user:${secret}@github.com/octo-cat/demo`,
    )).rejects.toMatchObject({ status: 400, message: expect.not.stringContaining(secret) });
    expect(getProjectForUser).not.toHaveBeenCalled();
  });

  it("maps GitHub default branch failures without echoing the URL", async () => {
    vi.mocked(getGithubRepositoryDefaultBranch).mockRejectedValue(new GithubError("private details", 404));
    await expect(apiDeployFromGithubUrl(
      principal(["projects:write", "deployments:write"]),
      "project-1",
      "https://github.com/octo-cat/demo",
    )).rejects.toMatchObject({ status: 400, message: expect.not.stringContaining("private details") });
    expect(apiUpdateDeploymentGithubRepository).not.toHaveBeenCalled();
  });
});
