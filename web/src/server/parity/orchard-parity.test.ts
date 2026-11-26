import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ENDPOINTS } from "@/server/api-v1";
import { COMPACT_TOOLS } from "@/server/mcp-compact";

/**
 * Ratchet for parity with Orchard's MCP tools. The manifest lists every Orchard
 * product tool with our equivalent, and the checklist is generated from it.
 * The test never goes red for something still missing. It goes red when a mapped
 * endpoint disappears, when a mapping points nowhere, or when the recorded counts
 * no longer match the manifest statuses. Update the baselines with status changes.
 */
type Status = "present" | "partial" | "missing" | "not_applicable";
type Row = { name: string; source: string; status: Status; ours: string | null; reason?: string };
type Manifest = { baseline_present: number; baseline_partial: number; baseline_missing: number; baseline_not_applicable: number; tools: Row[]; ours_only: string[] };

const manifest = JSON.parse(readFileSync(path.join(__dirname, "orchard-parity.json"), "utf8")) as Manifest;
const ids = new Set(ENDPOINTS.map((e) => e.id));
// Compact-server tools map as "compact:<name>" because they are not registry endpoints.
const compactNames = new Set(COMPACT_TOOLS.map((t) => t.name));

describe("Orchard MCP parity manifest", () => {
  it("lists each Orchard tool once, with a known status", () => {
    const names = manifest.tools.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
    for (const t of manifest.tools) expect(["present", "partial", "missing", "not_applicable"]).toContain(t.status);
  });

  it("points every present or partial tool at an endpoint that exists", () => {
    for (const t of manifest.tools.filter((x) => x.status === "present" || x.status === "partial")) {
      expect(t.ours, t.name).not.toBeNull();
      if (t.ours?.startsWith("compact:")) {
        expect(compactNames.has(t.ours.slice("compact:".length)), `${t.name} -> ${t.ours} is not a compact tool`).toBe(true);
      } else {
        expect(ids.has(t.ours as string), `${t.name} -> ${t.ours} is missing from ENDPOINTS`).toBe(true);
      }
    }
  });

  it("keeps missing tools unmapped", () => {
    for (const t of manifest.tools.filter((x) => x.status === "missing" || x.status === "not_applicable")) {
      expect(t.ours, t.name).toBeNull();
    }
  });

  it("gives every non-present classification a reason", () => {
    for (const t of manifest.tools.filter((x) => x.status !== "present")) {
      expect(t.reason?.trim(), t.name).toBeTruthy();
    }
  });

  it("lists every endpoint without an Orchard mapping as ours-only", () => {
    const mapped = new Set(
      manifest.tools
        .filter((t) => t.status === "present" || t.status === "partial")
        .map((t) => t.ours as string),
    );
    const expected = [...ids].filter((id) => !mapped.has(id)).sort();
    expect(new Set(manifest.ours_only).size).toBe(manifest.ours_only.length);
    expect([...manifest.ours_only].sort()).toEqual(expected);
  });

  it("keeps recorded baselines equal to the current statuses", () => {
    const present = manifest.tools.filter((t) => t.status === "present").length;
    const partial = manifest.tools.filter((t) => t.status === "partial").length;
    expect(present).toBe(manifest.baseline_present);
    expect(partial).toBe(manifest.baseline_partial);
    const missing = manifest.tools.filter((t) => t.status === "missing").length;
    const notApplicable = manifest.tools.filter((t) => t.status === "not_applicable").length;
    expect(missing).toBe(manifest.baseline_missing);
    expect(notApplicable).toBe(manifest.baseline_not_applicable);
  });
});
