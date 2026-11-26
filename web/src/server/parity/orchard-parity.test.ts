import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ENDPOINTS } from "@/server/api-v1";

/**
 * Ratchet for parity with Orchard's MCP tools. The manifest lists every Orchard
 * product tool with our equivalent, and the checklist is generated from it.
 * The test never goes red for something still missing. It goes red when a mapped
 * endpoint disappears, when a mapping points nowhere, or when the number of
 * ported tools drops below the recorded baseline. Raise the baseline as tools land.
 */
type Row = { name: string; source: string; status: "present" | "partial" | "missing"; ours: string | null };
type Manifest = { baseline_present: number; baseline_partial: number; tools: Row[]; ours_only: string[] };

const manifest = JSON.parse(readFileSync(path.join(__dirname, "orchard-parity.json"), "utf8")) as Manifest;
const ids = new Set(ENDPOINTS.map((e) => e.id));

describe("Orchard MCP parity manifest", () => {
  it("lists each Orchard tool once, with a known status", () => {
    const names = manifest.tools.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
    for (const t of manifest.tools) expect(["present", "partial", "missing"]).toContain(t.status);
  });

  it("points every present or partial tool at an endpoint that exists", () => {
    for (const t of manifest.tools.filter((x) => x.status !== "missing")) {
      expect(t.ours, t.name).not.toBeNull();
      expect(ids.has(t.ours as string), `${t.name} -> ${t.ours} is missing from ENDPOINTS`).toBe(true);
    }
  });

  it("keeps missing tools unmapped", () => {
    for (const t of manifest.tools.filter((x) => x.status === "missing")) expect(t.ours, t.name).toBeNull();
  });

  it("does not drop below the recorded baseline", () => {
    const present = manifest.tools.filter((t) => t.status === "present").length;
    const partial = manifest.tools.filter((t) => t.status === "partial").length;
    expect(present).toBeGreaterThanOrEqual(manifest.baseline_present);
    expect(partial).toBeGreaterThanOrEqual(manifest.baseline_partial);
  });
});
