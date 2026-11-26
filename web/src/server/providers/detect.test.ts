import { describe, expect, it } from "vitest";
import { detectProviderRepository } from "./detect";

describe("provider repository detection", () => {
  it("reads only detection files, never committed env values, and reports truncated trees", async () => {
    const read: string[] = [];
    const result = await detectProviderRepository({ readTree: async () => ({ paths: ["web/package.json", "web/.env", "web/.env.example"], truncated: true }), readFile: async (_repo, _branch, path) => { read.push(path); return path.endsWith("package.json") ? '{"scripts":{"start":"node index.js"}}' : 'API_KEY=secret'; } }, { repo: "org/repo", branch: "main", root: "web" });
    expect(result.status).toBe("ok");
    expect(read.sort()).toEqual(["web/.env.example", "web/package.json"]);
    expect(JSON.stringify(result)).not.toContain("secret");
    expect(result.detection?.committedEnvFiles).toContain(".env");
    expect(result.detection?.notes.join(" ")).toContain("large");
  });
  it("rejects root traversal and reports provider errors as unavailable", async () => {
    const api = { readTree: async () => { throw Error("token"); }, readFile: async () => "" };
    expect((await detectProviderRepository(api, { repo: "org/repo", branch: "main", root: "../other" })).status).toBe("unavailable");
    const result = await detectProviderRepository(api, { repo: "org/repo", branch: "main", root: "." });
    expect(result.status).toBe("unavailable"); expect(JSON.stringify(result)).not.toContain("token");
  });
});
