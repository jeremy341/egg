import { describe, expect, it } from "vitest";
import { genericGitEnvironment, validateGitVersion } from "./generic";

describe("generic public Git transport", () => {
  it("pins the verified host, disables redirects and credentials, and rejects private DNS", async () => {
    const result = await genericGitEnvironment("https://git.example.com/org/repo.git", async () => ["93.184.216.34"]);
    const config = Array.from({ length: Number(result.GIT_CONFIG_COUNT) }, (_, i) => [result[`GIT_CONFIG_KEY_${i}`], result[`GIT_CONFIG_VALUE_${i}`]]);
    expect(config).toContainEqual(["http.curloptResolve", "git.example.com:443:93.184.216.34"]);
    expect(config).toContainEqual(["http.followRedirects", "false"]);
    expect(config).toContainEqual(["credential.helper", ""]);
    expect(result.GIT_ALLOW_PROTOCOL).toBe("https");
    await expect(genericGitEnvironment("https://git.example.com/org/repo.git", async () => ["127.0.0.1"])).rejects.toThrow();
    await expect(genericGitEnvironment("https://u:secret@git.example.com/org/repo.git", async () => ["93.184.216.34"])).rejects.toThrow();
  });
  it("requires a Git version with curl address pinning support", () => {
    expect(() => validateGitVersion("git version 2.36.2")).toThrow();
    expect(() => validateGitVersion("git version 2.37.0")).not.toThrow();
  });
});
