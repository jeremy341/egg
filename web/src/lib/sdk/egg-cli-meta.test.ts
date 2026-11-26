import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { COMMANDS, parseCli } from "../../../scripts/egg-cli.mjs";
import { commands, optionTypes, runners } from "../../../scripts/egg-cli-groups/meta.mjs";

type ChecklistEntry = {
  orchard: string;
  status: string;
  reason: string | null;
};

const checklist = JSON.parse(
  readFileSync(new URL("../../server/parity/cli/meta.json", import.meta.url), "utf8")
) as ChecklistEntry[];

describe("meta CLI parity", () => {
  it("keeps commands without an Egg SDK method marked missing and unregistered", () => {
    expect(checklist.every((entry) => entry.status === "missing")).toBe(true);
    expect(checklist.every((entry) => entry.reason?.startsWith("needs SDK method "))).toBe(true);
    expect(commands).toEqual([]);
    expect(runners).toEqual({});
    expect(optionTypes).toEqual({});
  });

  it.each(["version", "root", "commands", "exit-codes", "licenses"])(
    "does not advertise %s before the SDK can support it",
    (name) => {
      expect(COMMANDS.some((command) => command.name === name)).toBe(false);
      expect(parseCli([name]).ok).toBe(false);
    }
  );
});
