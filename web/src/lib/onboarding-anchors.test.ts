import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ANCHORS } from "@/lib/onboarding";

/**
 * Every anchor a tour step points at must exist as `data-tour="<name>"` in the UI, so renaming
 * or deleting a control breaks a test and not the tour.
 *
 * All the attributes are in the UI now, so the list is empty. It stays as a place to list an anchor that
 * a later step uses before its control exists; the last test fails if a listed anchor is already in the
 * code, so the list cannot rot.
 */
export const ANCHORS_NOT_YET_ADDED: readonly string[] = [];

const SRC = path.resolve(__dirname, "..");
const ROOTS = [path.join(SRC, "components"), path.join(SRC, "app")];
const SOURCE = /\.(tsx?|jsx?|mdx?)$/;
const TEST_FILE = /\.(test|spec)\.[a-z]+$/;

function sourceFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(full));
    else if (SOURCE.test(entry.name) && !TEST_FILE.test(entry.name)) out.push(full);
  }
  return out;
}

/** The anchor names that appear as data-tour="name" in the components and the app folder. */
function namesInCode(): Set<string> {
  const found = new Set<string>();
  for (const root of ROOTS) {
    for (const file of sourceFiles(root)) {
      const text = fs.readFileSync(file, "utf8");
      // data-tour="name", or data-tour={condition ? "name" : undefined} for an anchor that only exists in some states.
      for (const match of text.matchAll(/data-tour="([^"]+)"/g)) found.add(match[1]!);
      for (const match of text.matchAll(/data-tour={[^}]*?"([a-z-]+)"[^}]*}/g)) found.add(match[1]!);
    }
  }
  return found;
}

describe("tour anchors", () => {
  const inCode = namesInCode();

  it("finds the source folders", () => {
    expect(sourceFiles(path.join(SRC, "components")).length).toBeGreaterThan(10);
    expect(sourceFiles(path.join(SRC, "app")).length).toBeGreaterThan(10);
  });

  it("lists only anchors that a step uses", () => {
    const unknown = ANCHORS_NOT_YET_ADDED.filter((name) => !ANCHORS.includes(name));
    expect(unknown, "remove these from ANCHORS_NOT_YET_ADDED, no step uses them").toEqual([]);
    expect(new Set(ANCHORS_NOT_YET_ADDED).size).toBe(ANCHORS_NOT_YET_ADDED.length);
  });

  it("has data-tour for every anchor, except those listed as not yet added", () => {
    const missing = ANCHORS.filter((name) => !inCode.has(name) && !ANCHORS_NOT_YET_ADDED.includes(name));
    expect(missing, 'add data-tour="<name>" to the UI, or list the name in ANCHORS_NOT_YET_ADDED').toEqual([]);
  });

  it("does not list an anchor that is now in the code", () => {
    const stale = ANCHORS_NOT_YET_ADDED.filter((name) => inCode.has(name));
    expect(stale, "these are in the code now: remove them from ANCHORS_NOT_YET_ADDED").toEqual([]);
  });
});
