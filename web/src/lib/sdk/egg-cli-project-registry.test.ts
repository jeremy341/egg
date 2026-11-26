import { describe, expect, it } from "vitest";
import { parseCli, run } from "../../../scripts/egg-cli.mjs";

const unsupportedCommands = [
  ["quota show", ["quota", "show", "--org", "org_1"]],
  ["quota me", ["quota", "me", "--org", "org_1"]],
  ["quota members", ["quota", "members", "--org", "org_1"]],
  ["quota projects", ["quota", "projects", "--org", "org_1"]],
  ["import", ["import", "sam/example"]],
] as const;

describe("project-registry CLI capability boundaries", () => {
  it.each(unsupportedCommands)("keeps %s unavailable while its SDK cannot meet the checklist spec", async (_name, commandArgs) => {
    const argv = [...commandArgs];
    expect(parseCli(argv)).toMatchObject({ ok: false });

    let requests = 0;
    let out = "";
    let err = "";
    const code = await run(argv, {
      env: { EGG_TOKEN: "test-token", EGG_URL: "https://egg.example.com" },
      fetch: async () => {
        requests += 1;
        return { ok: true, status: 200, headers: { get: () => null }, text: async () => "{}" };
      },
      stdout: { isTTY: true, write: (text: string) => void (out += text) },
      stderr: { write: (text: string) => void (err += text) },
    });

    expect(code).toBe(2);
    expect(out).toBe("");
    expect(err).toContain("Error:");
    expect(requests).toBe(0);
  });
});
