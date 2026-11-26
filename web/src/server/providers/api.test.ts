import { mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createProviderApi, type ProviderTransport } from "./api";

function fixture(data: unknown, status = 200): ProviderTransport {
  return async () => ({ status, body: (async function* () { yield Buffer.from(typeof data === "string" ? data : JSON.stringify(data)); })() });
}
const resolve = async () => ["93.184.216.34"];

describe("provider REST clients", () => {
  it("lists and normalizes GitLab projects without putting credentials in URLs", async () => {
    let request = ""; let auth = "";
    const client = createProviderApi({ kind: "gitlab", instance: "https://gitlab.com", headers: { authorization: "Bearer secret" }, resolve, transport: async (req) => { request = req.path; auth = req.headers.authorization; return fixture([{ id: 3, path_with_namespace: "a/b/c", visibility: "private", default_branch: "main", last_activity_at: "2026-01-01", http_url_to_repo: "https://gitlab.com/a/b/c.git" }])(req); } });
    expect(await client.listRepositories(1)).toEqual({ repositories: [{ id: 3, fullName: "a/b/c", private: true, defaultBranch: "main", pushedAt: "2026-01-01", cloneUrl: "https://gitlab.com/a/b/c.git" }], nextPage: null });
    expect(request).toBe("/api/v4/projects?membership=true&per_page=100&page=1");
    expect(auth).toBe("Bearer secret"); expect(request).not.toContain("secret");
  });
  it("reads Forgejo tree and raw file with the configured host, branch and safe encoded path", async () => {
    const paths: string[] = [];
    const client = createProviderApi({ kind: "codeberg", resolve, transport: async (req) => { paths.push(req.path); return fixture(paths.length === 1 ? { tree: [{ path: "package.json", type: "blob" }, { path: "src", type: "tree" }], truncated: false } : '{"name":"demo"}')(req); } });
    expect(await client.readTree("owner/repo", "feature/a")).toEqual({ paths: ["package.json"], truncated: false });
    expect(await client.readFile("owner/repo", "feature/a", "package.json")).toBe('{"name":"demo"}');
    expect(paths).toEqual(["/api/v1/repos/owner/repo/git/trees/feature%2Fa?recursive=true", "/api/v1/repos/owner/repo/raw/package.json?ref=feature%2Fa"]);
  });
  it("rejects unsafe instance URLs, DNS answers, redirects, oversized bodies and malformed paths", async () => {
    for (const instance of ["http://example.com", "https://u:p@example.com", "https://127.0.0.1", "https://example.com/other", "https://localhost"]) expect(() => createProviderApi({ kind: "forgejo", instance, resolve, transport: fixture([]) })).toThrow();
    for (const ip of ["127.0.0.1", "10.0.0.1", "169.254.1.1", "::1", "::ffff:127.0.0.1", "2001:db8::1", "2002:0a00:0001::1", "3ffe::1"]) {
      const client = createProviderApi({ kind: "forgejo", instance: "https://git.example.com", resolve: async () => ["93.184.216.34", ip], transport: fixture([]) });
      await expect(client.listRepositories(1)).rejects.toThrow();
    }
    const redirect = createProviderApi({ kind: "forgejo", instance: "https://git.example.com", resolve, transport: fixture("", 302) });
    await expect(redirect.listRepositories(1)).rejects.toThrow();
    const large = createProviderApi({ kind: "forgejo", instance: "https://git.example.com", resolve, transport: fixture("x".repeat(200_001)) });
    await expect(large.readFile("owner/repo", "main", "package.json")).rejects.toThrow();
    await expect(large.readFile("owner/repo", "main", "../secret")).rejects.toThrow();
  });
  it("does not contact the provider if DNS resolves after the deadline", async () => {
    let release!: (addresses: string[]) => void; let contacted = false;
    const client = createProviderApi({ kind: "forgejo", instance: "https://git.example.com", timeoutMs: 5,
      resolve: () => new Promise((r) => { release = r; }), transport: async (req) => { contacted = true; return fixture([])(req); } });
    await expect(client.listRepositories()).rejects.toThrow();
    release(["93.184.216.34"]);
    await new Promise((r) => setTimeout(r, 10));
    expect(contacted).toBe(false);
  });
  it("normalizes Forgejo repository listings", async () => {
    const client = createProviderApi({ kind: "forgejo", instance: "https://git.example.com", resolve, transport: fixture([{ id: 8, full_name: "owner/repo", private: false, default_branch: "main", pushed_at: null, clone_url: "https://git.example.com/owner/repo.git" }]) });
    const page = await client.listRepositories();
    expect(page.nextPage).toBe(2);
    expect(page.repositories[0]).toEqual({ id: 8, fullName: "owner/repo", private: false, defaultBranch: "main", pushedAt: null, cloneUrl: "https://git.example.com/owner/repo.git" });
  });
  it("resolves an exact branch commit before requesting an archive for that SHA", async () => {
    const paths: string[] = [];
    const sha = "a".repeat(40);
    const client = createProviderApi({ kind: "gitlab", instance: "https://gitlab.com", resolve, transport: async (req) => { paths.push(req.path); return fixture(paths.length === 1 ? { commit: { id: sha } } : "archive")(req); } });
    expect(await client.branchCommit("a/b", "main")).toBe(sha);
    const dir = mkdtempSync(path.join(tmpdir(), "provider-archive-"));
    const file = path.join(dir, "archive.gz");
    try { await client.downloadArchive("a/b", sha, file); expect(readFileSync(file).toString()).toBe("archive"); } finally { rmSync(dir, { recursive: true, force: true }); }
    expect(paths).toEqual(["/api/v4/projects/a%2Fb/repository/branches/main", `/api/v4/projects/a%2Fb/repository/archive.tar.gz?sha=${sha}&include_lfs_blobs=false`]);
    await expect(client.downloadArchive("a/b", "main", "unused")).rejects.toThrow();
  });
  it("binds a repository lookup to the requested identity and configured instance", async () => {
    const client = createProviderApi({ kind: "forgejo", instance: "https://git.example.com", resolve, transport: fixture({ id: 2, full_name: "owner/other", private: true, default_branch: "main", pushed_at: null, clone_url: "https://git.example.com/owner/other.git" }) });
    await expect(client.getRepository("owner/repo")).rejects.toThrow();
  });
  it("removes a partial streamed archive when its byte limit is exceeded", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "provider-limit-")); const file = path.join(dir, "archive.gz");
    try {
      const client = createProviderApi({ kind: "gitlab", resolve, transport: fixture("too-large"), archiveLimitBytes: 3 });
      await expect(client.downloadArchive("a/b", "a".repeat(40), file)).rejects.toThrow();
      expect(existsSync(file)).toBe(false);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  it("removes a partial archive when the stream stalls past its deadline", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "provider-timeout-")); const file = path.join(dir, "archive.gz");
    try {
      const transport: ProviderTransport = async () => ({ status: 200, body: (async function* () { yield Buffer.from("partial"); await new Promise(() => {}); })() });
      const client = createProviderApi({ kind: "gitlab", resolve, transport, timeoutMs: 25 });
      await expect(client.downloadArchive("a/b", "a".repeat(40), file)).rejects.toThrow();
      expect(existsSync(file)).toBe(false);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  it("reads GitLab project paths and files with correct encoding", async () => {
    const paths: string[] = [];
    const client = createProviderApi({ kind: "gitlab", instance: "https://gitlab.com", resolve, transport: async (req) => { paths.push(req.path); return fixture(paths.length === 1 ? [{ type: "blob", path: "web/package.json" }] : "content")(req); } });
    expect(await client.readTree("a/b/c", "main")).toEqual({ paths: ["web/package.json"], truncated: false });
    expect(await client.readFile("a/b/c", "main", "web/package.json")).toBe("content");
    expect(paths[0]).toContain("projects/a%2Fb%2Fc/repository/tree?");
    expect(paths[1]).toBe("/api/v4/projects/a%2Fb%2Fc/repository/files/web%2Fpackage.json/raw?ref=main");
  });
});







