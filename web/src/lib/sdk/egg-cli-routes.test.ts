import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ENDPOINTS } from "@/server/api-v1";

/**
 * The CLI calls API operations by id through callRegisteredOperation. Each id it
 * names must be a real endpoint, and each must have a route in the CLI's OPERATIONS
 * table, so a renamed endpoint breaks the test instead of a command at run time.
 */
const cliSource = readFileSync(path.resolve(__dirname, "../../../scripts/egg-cli.mjs"), "utf8");

describe("egg CLI operation routes", () => {
  const called = [...cliSource.matchAll(/callRegisteredOperation\(nest, "([a-z_]+)"/g)].map((m) => m[1]);
  const endpointIds = new Set(ENDPOINTS.map((e) => e.id));

  it("finds the operations the CLI calls", () => {
    expect(called.length).toBeGreaterThan(0);
  });

  it("names only real endpoints", () => {
    for (const id of new Set(called)) expect(endpointIds.has(id), id).toBe(true);
  });

  it("routes every called operation through the typed SDK table", () => {
    const table = cliSource.slice(cliSource.indexOf("const OPERATIONS = {"));
    for (const id of new Set(called)) expect(table.includes(`${id}: (`), id).toBe(true);
  });

  it("never posts to the compact gateway or sends a blanket confirm", () => {
    expect(cliSource.includes("/../mcp/compact")).toBe(false);
    expect(cliSource.includes("confirm: operationId")).toBe(false);
  });
});
