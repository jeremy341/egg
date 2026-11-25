import { describe, expect, it } from "vitest";
import { parseGithubRepositoryUrl } from "@/server/api-v1-deploy-from-url";

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
