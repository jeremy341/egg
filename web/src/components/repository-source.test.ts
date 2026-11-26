import { describe, expect, it } from "vitest";
import { repositoryUrl } from "@/components/repository-source";

describe("repository URL entry", () => {
  it("accepts public GitLab subgroups and self-hosted Forgejo sources", () => {
    expect(repositoryUrl("gitlab", "https://gitlab.com/team/subgroup/app.git")).toBe("https://gitlab.com/team/subgroup/app.git");
    expect(repositoryUrl("forgejo", "https://git.example.org/team/app.git")).toBe("https://git.example.org/team/app.git");
  });
  it("rejects embedded credentials and mismatched hosted providers", () => {
    expect(() => repositoryUrl("gitlab", "https://user:secret@gitlab.com/team/app")).toThrow("credentials");
    expect(() => repositoryUrl("codeberg", "https://github.com/team/app")).toThrow("codeberg.org");
  });
  it("normalizes a GitHub repository URL while keeping generic HTTPS Git usable", () => {
    expect(repositoryUrl("github", " https://github.com/team/app.git ")).toBe("https://github.com/team/app");
    expect(repositoryUrl("generic", "https://git.example.org/repos/app.git")).toBe("https://git.example.org/repos/app.git");
    expect(repositoryUrl("generic", "https://git.example.org/app.git")).toBe("https://git.example.org/app.git");
  });
});
