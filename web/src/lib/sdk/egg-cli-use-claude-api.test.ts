import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parseCli, run } from "../../../scripts/egg-cli.mjs";
import type { FetchInit, FetchLike, FetchResponse } from "./egg";

const TOKEN = "egg_cli_context_token_must_not_be_saved_or_printed";
const URL = "https://egg.example.com";

const reply = (body: unknown): FetchResponse => ({
  ok: true,
  status: 200,
  headers: { get: () => null },
  text: async () => JSON.stringify(body),
});

describe("egg use and api commands", () => {
  let directory: string | undefined;
  afterEach(() => {
    if (directory) rmSync(directory, { recursive: true, force: true });
    directory = undefined;
  });

  const contextPath = () => {
    directory = mkdtempSync(path.join(tmpdir(), "egg-cli-context-"));
    return path.join(directory, "context.json");
  };

  const invoke = async (argv: string[], env: Record<string, string | undefined> = {}) => {
    let out = "";
    let err = "";
    const code = await run(argv, {
      env,
      stdout: { isTTY: false, write: (text: string) => void (out += text) },
      stderr: { write: (text: string) => void (err += text) },
    });
    return { code, out, err };
  };

  it("parses use, context show and clear, and api commands", () => {
    expect(parseCli(["use", "my-project", "--org", "acme", "--env", "preview"]).ok).toBe(true);
    expect(parseCli(["context", "show", "--json"]).ok).toBe(true);
    expect(parseCli(["context", "clear"]).ok).toBe(true);
    expect(parseCli(["api", "PATCH", "/projects/p_1", "--body", "body.json", "--query", "dryRun=true"]).ok).toBe(true);
  });

  it("saves, shows and clears the local default scope", async () => {
    const file = contextPath();
    const env = { EGG_CONTEXT_FILE: file };
    expect((await invoke(["use", "my-project", "--org", "acme", "--env", "preview"], env)).code).toBe(0);
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({ project: "my-project", organization: "acme", environment: "preview" });

    const shown = await invoke(["context", "show", "--json"], env);
    expect(shown.code).toBe(0);
    expect(JSON.parse(shown.out)).toEqual({ project: "my-project", organization: "acme", environment: "preview" });

    expect((await invoke(["context", "clear"], env)).code).toBe(0);
    expect(await invoke(["context", "show"], env)).toMatchObject({ code: 0, out: expect.stringMatching(/no default|nothing saved/i) });
    expect((await invoke(["context", "clear"], env)).code).toBe(0);
  });

  it("ignores a command-line token for offline context storage and output", async () => {
    const file = contextPath();
    const result = await invoke(["use", "my-project", "--token", TOKEN], { EGG_CONTEXT_FILE: file });
    expect(result.code).toBe(0);
    expect(readFileSync(file, "utf8")).not.toContain(TOKEN);
    expect(`${result.out}${result.err}`).not.toContain(TOKEN);
  });

  it("calls rawRequest with the API method, path, query and JSON body", async () => {
    const file = contextPath();
    const bodyFile = path.join(directory!, "body.json");
    const requestBody = { enabled: false };
    writeFileSync(bodyFile, JSON.stringify(requestBody));
    let call: { url: URL; init: FetchInit } | undefined;
    const fetch: FetchLike = async (rawUrl, init) => {
      call = { url: new globalThis.URL(rawUrl), init };
      return reply({ updated: true });
    };
    let out = "";
    const code = await run(["api", "PATCH", "/projects/p_1", "--confirm", "p_1", "--body", bodyFile, "--query", "dryRun=false", "--token", TOKEN], {
      env: { EGG_TOKEN: TOKEN, EGG_URL: URL, EGG_CONTEXT_FILE: file },
      fetch,
      stdout: { isTTY: false, write: (text: string) => void (out += text) },
      stderr: { write: () => undefined },
    });
    expect(code).toBe(0);
    expect(call?.init.method).toBe("PATCH");
    expect(call?.url.pathname).toBe("/api/v1/projects/p_1");
    expect(call?.url.searchParams.get("dryRun")).toBe("false");
    expect(JSON.parse(String(call?.init.body))).toEqual(requestBody);
    expect(JSON.parse(out)).toEqual({ updated: true });
    expect(out).not.toContain(TOKEN);
  });

  it.each([undefined, "wrong"])("rejects destructive API calls without matching confirmation (%s)", async (confirmation) => {
    const argv = ["api", "DELETE", "/api/v1/projects/p_1", ...(confirmation ? ["--confirm", confirmation] : [])];
    const result = await invoke(argv, { EGG_TOKEN: TOKEN, EGG_URL: URL });
    expect(result.code).toBe(2);
    expect(result.err).toMatch(/--confirm p_1/i);
  });
});
