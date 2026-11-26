import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { COMMANDS, parseCli, run, USAGE } from "../../../scripts/egg-cli.mjs";

const packageJson = JSON.parse(readFileSync(new URL("../../../package.json", import.meta.url), "utf8")) as {
  version: string;
  license?: string;
};

async function execute(argv: string[]) {
  let output = "";
  let error = "";
  const fetch = vi.fn(() => {
    throw new Error("offline command attempted a server request");
  });
  const code = await run(argv, {
    env: {},
    fetch,
    stdout: { isTTY: true, write: (chunk: string) => void (output += chunk) },
    stderr: { write: (chunk: string) => void (error += chunk) },
  });
  return { code, output, error, fetch };
}

describe("offline meta commands", () => {
  it.each([
    { command: "version", text: `Egg CLI ${packageJson.version}\n`, json: { version: packageJson.version } },
    { command: "commands", text: `${COMMANDS.map(({ name }) => name).join("\n")}\n`, json: COMMANDS.map(({ name }) => name) },
    {
      command: "exit-codes",
      text: "0 done\n1 failed\n2 wrong use\n",
      json: [
        { code: 0, meaning: "done" },
        { code: 1, meaning: "failed" },
        { code: 2, meaning: "wrong use" },
      ],
    },
    { command: "licenses", text: `${packageJson.license ?? "no license declared"}\n`, json: { license: packageJson.license ?? "no license declared" } },
    { command: "root", text: USAGE, json: { usage: USAGE } },
  ])("parses and runs $command without token or server in text and JSON modes", async ({ command, text, json }) => {
    expect(parseCli([command])).toMatchObject({ ok: true, command });

    const textResult = await execute([command]);
    expect(textResult.code).toBe(0);
    expect(textResult.output).toBe(text);
    expect(textResult.error).toBe("");
    expect(textResult.fetch).not.toHaveBeenCalled();

    expect(parseCli([command, "--json"])).toMatchObject({ ok: true, command, flags: { json: true } });
    const jsonResult = await execute([command, "--json"]);
    expect(jsonResult.code).toBe(0);
    expect(JSON.parse(jsonResult.output)).toEqual(json);
    expect(jsonResult.error).toBe("");
    expect(jsonResult.fetch).not.toHaveBeenCalled();
  });
});
