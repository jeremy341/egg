import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { SCOPES, SCOPE_LABEL } from "@/server/api-tokens";
import { BUILD_RESOURCES, meExample, repoLink, scopeNeeds, sdkExample } from "@/lib/developer";

const repoRoot = resolve(__dirname, "../../..");

function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? filesUnder(p) : [p];
  });
}

describe("Build with it", () => {
  it("lists only things that exist in the repository", () => {
    for (const r of BUILD_RESOURCES) expect(existsSync(join(repoRoot, r.path)), r.path).toBe(true);
  });

  it("names only real permissions, and says what each one needs", () => {
    for (const r of BUILD_RESOURCES) {
      for (const s of r.scopes) expect((SCOPES as readonly string[]).includes(s), `${r.id} ${s}`).toBe(true);
      expect(scopeNeeds(r).length).toBeGreaterThan(5);
    }
    expect(scopeNeeds(BUILD_RESOURCES.find((r) => r.id === "node")!)).toBe("Needs projects:read and deployments:read.");
  });

  it("uses no em or en dashes in visible copy", () => {
    const all = BUILD_RESOURCES.flatMap((r) => [r.title, r.summary, scopeNeeds(r)]);
    for (const line of all) expect(line).not.toMatch(/[–—]/);
    for (const label of Object.values(SCOPE_LABEL)) expect(label).not.toMatch(/[–—]/);
  });

  it("links files and folders to the repository", () => {
    expect(repoLink("examples/node/tail-logs.mjs")).toMatch(/\/blob\/main\/examples\/node\/tail-logs\.mjs$/);
    expect(repoLink("examples/mcp")).toMatch(/\/tree\/main\/examples\/mcp$/);
  });

  it("shows placeholder tokens only", () => {
    expect(meExample("https://x.test/")).toBe('curl -H "Authorization: Bearer ndp_..." https://x.test/api/v1/me');
    expect(sdkExample("https://x.test/")).toContain('baseUrl: "https://x.test"');
    expect(sdkExample("https://x.test")).not.toMatch(/ndp_/);
  });
});

describe("the examples folder", () => {
  const files = filesUnder(join(repoRoot, "examples"));

  it("never contains a real-looking token", () => {
    for (const f of files) {
      expect(readFileSync(f, "utf8"), f).not.toMatch(/ndp_[A-Za-z0-9_-]{8,}/);
      expect(readFileSync(f, "utf8"), f).not.toMatch(/ndh_[A-Za-z0-9_-]{8,}/);
    }
  });

  it("has a README line about permissions in every example folder", () => {
    for (const dir of ["node", "python", "dashboard", "github-actions", "mcp"]) {
      const readme = readFileSync(join(repoRoot, "examples", dir, "README.md"), "utf8");
      expect(readme, dir).toMatch(/scopes:|Token scopes/i);
    }
  });

  it("keeps the dashboard's token in memory only", () => {
    const html = readFileSync(join(repoRoot, "examples/dashboard/index.html"), "utf8");
    expect(html).not.toMatch(/localStorage|sessionStorage|document\.cookie|indexedDB|location\.(hash|search)|history\./);
    expect(html).toMatch(/Content-Security-Policy/);
    expect(html).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(/);
  });

  it("uses no em or en dashes in its text", () => {
    for (const f of files) expect(readFileSync(f, "utf8"), f).not.toMatch(/[–—]/);
  });

  it("only calls endpoints that exist", async () => {
    const { ENDPOINTS } = await import("@/server/api-v1");
    const known = new Set(ENDPOINTS.filter((e) => e.method === "GET").map((e) => e.path.replace(/\{[^}]+\}/g, "*")));
    const shape = (p: string) => p.replace(/\/[A-Za-z0-9_-]{20,}(?=\/|$)/g, "/*");
    const used = ["/me", "/projects", "/projects/*/analytics", "/projects/*/deployments", "/deployments/*/logs", "/deployments/*"];
    for (const u of used) expect(known.has(shape(u)) || known.has(u), u).toBe(true);
  });
});
