import { describe, expect, it } from "vitest";
import { createProjectInput } from "@/server/projects";

describe("project provider input", () => {
  it("retains the canonical nullable listener port", () => {
    const input = { serverId: "s", name: "Worker", repoUrl: "https://github.com/a/b", runtime: "node", workloadKind: "worker", listenPort: null };
    expect(createProjectInput.parse(input)).toMatchObject({ listenPort: null });
  });
  it("retains provider identity and rejects unknown providers", () => {
    const input = { serverId: "s", name: "App", repoUrl: "https://codeberg.org/a/b.git", runtime: "node", port: 3000, sourceProvider: "codeberg", providerConnectionId: "c" };
    expect(createProjectInput.parse(input)).toMatchObject({ sourceProvider: "codeberg", providerConnectionId: "c" });
    expect(() => createProjectInput.parse({ ...input, sourceProvider: "invalid" })).toThrow();
  });
});

