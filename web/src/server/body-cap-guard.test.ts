import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Every API route must read a request body through the capped readers in
 * `body-limit.ts` (directly, or through `readJson` in `http.ts`). A route that calls
 * `req.json()`, `req.text()`, `req.formData()` or similar reads an unbounded body, so one
 * large request could use up the server's memory. This test reads the route files, so a new
 * route that forgets the cap fails here.
 */
const API_ROOT = path.join(process.cwd(), "src", "app", "api");
const UNCAPPED = /\b(?:req|request|r)\s*\.\s*(?:json|text|formData|arrayBuffer|blob)\s*\(/;

function routeFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...routeFiles(full));
    else if (/^route\.tsx?$/.test(entry.name)) found.push(full);
  }
  return found;
}

describe("request body cap", () => {
  const files = routeFiles(API_ROOT);

  it("finds the API routes", () => {
    expect(files.length).toBeGreaterThan(100);
  });

  it("has no route that reads a request body without a cap", () => {
    const offenders = files
      .filter((f) => UNCAPPED.test(readFileSync(f, "utf8")))
      .map((f) => path.relative(process.cwd(), f));
    expect(offenders).toEqual([]);
  });

  it("the pattern catches the calls it is meant to catch", () => {
    expect(UNCAPPED.test("const b = await req.json();")).toBe(true);
    expect(UNCAPPED.test("await request.formData()")).toBe(true);
    expect(UNCAPPED.test("await readJson(req, schema)")).toBe(false);
    expect(UNCAPPED.test("await readTextLimited(req, 1024)")).toBe(false);
  });
});
