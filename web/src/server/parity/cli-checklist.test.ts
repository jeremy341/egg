import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { COMMANDS } from "../../../scripts/egg-cli.mjs";

/**
 * Ratchet for the Orchard CLI checklist. Each file under ./cli lists Orchard CLI
 * commands for one group, with the Egg command that covers them. A present or
 * partial entry must name a real Egg command. Every other entry needs a reason.
 * The done gate (no missing entries) is added once the port is finished.
 */
type Status = "present" | "partial" | "missing" | "not_applicable";
type Entry = { orchard: string; status: Status; egg: string | null; reason?: string };

const dir = path.join(__dirname, "cli");
const files = readdirSync(dir).filter((f) => f.endsWith(".json")).sort();
const eggNames = new Set((COMMANDS as { name: string }[]).map((c) => c.name));
const STATUSES: Status[] = ["present", "partial", "missing", "not_applicable"];

const entriesOf = (file: string) => JSON.parse(readFileSync(path.join(dir, file), "utf8")) as Entry[];

describe("Orchard CLI checklist", () => {
  it("has one checklist file per port group", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it("gives each entry a known status and an Orchard name", () => {
    for (const file of files) {
      for (const e of entriesOf(file)) {
        expect(STATUSES, `${file}: ${e.orchard}`).toContain(e.status);
        expect(e.orchard.trim(), file).toBeTruthy();
      }
    }
  });

  it("points present and partial entries at a real Egg command", () => {
    for (const file of files) {
      for (const e of entriesOf(file).filter((x) => x.status === "present" || x.status === "partial")) {
        expect(e.egg, `${file}: ${e.orchard}`).toBeTruthy();
        expect(eggNames.has(e.egg as string), `${file}: ${e.orchard} -> ${e.egg} is not an egg command`).toBe(true);
      }
    }
  });

  it("gives every non-present entry a reason and no Egg command", () => {
    for (const file of files) {
      for (const e of entriesOf(file).filter((x) => x.status !== "present" && x.status !== "partial")) {
        expect(e.reason?.trim(), `${file}: ${e.orchard}`).toBeTruthy();
        if (e.status === "not_applicable") expect(e.egg, `${file}: ${e.orchard}`).toBeNull();
      }
    }
  });
});
