import { lookup as dnsLookup } from "node:dns/promises";
import { request as httpsRequest } from "node:https";
import { BlockList, isIP } from "node:net";
import { open as openFile, unlink } from "node:fs/promises";
import type { RepoSummary } from "../github/app";

type Kind = "gitlab" | "forgejo" | "codeberg";
type TransportRequest = { hostname: string; port: number; address: string; path: string; headers: Record<string, string>; signal: AbortSignal };
export type ProviderTransport = (request: TransportRequest) => Promise<{ status: number; body: AsyncIterable<Uint8Array> }>;
export type ProviderResolver = (hostname: string) => Promise<string[]>;
type Options = { kind: Kind; instance?: string; headers?: Record<string, string>; resolve?: ProviderResolver; transport?: ProviderTransport; timeoutMs?: number; archiveLimitBytes?: number };
type RepoPage = { repositories: RepoSummary[]; nextPage: number | null };
type Tree = { paths: string[]; truncated: boolean };

const blocked = new BlockList();
for (const [address, bits] of [["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.88.99.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4]] as const) blocked.addSubnet(address, bits, "ipv4");
// Public IPv6 global unicast only. Reject special-purpose 2001::/23 and documentation ranges.
const v6global = new BlockList(); v6global.addSubnet("2000::", 3, "ipv6");
const v6blocked = new BlockList(); v6blocked.addSubnet("2001::", 23, "ipv6"); v6blocked.addSubnet("2001:db8::", 32, "ipv6"); v6blocked.addSubnet("3fff::", 20, "ipv6"); v6blocked.addSubnet("2002::", 16, "ipv6"); v6blocked.addSubnet("3ffe::", 16, "ipv6");
function publicIp(address: string): boolean {
  const family = isIP(address);
  return family === 4 ? !blocked.check(address, "ipv4") : family === 6 && v6global.check(address, "ipv6") && !v6blocked.check(address, "ipv6");
}
const defaultResolver: ProviderResolver = async (host) => (await dnsLookup(host, { all: true, verbatim: true })).map((item) => item.address);
export async function resolvePublicHost(host: string, resolver: ProviderResolver = defaultResolver): Promise<string[]> {
  const addresses = await resolver(host);
  if (!addresses.length || addresses.some((address) => !publicIp(address))) throw new Error("Provider host does not resolve to public addresses");
  return addresses;
}
/** The TLS certificate is verified against the configured hostname while the socket is pinned to the validated address. Node HTTPS does not follow redirects. */
export const nodeHttpsTransport: ProviderTransport = ({ hostname, port, address, path, headers, signal }) => new Promise((resolve, reject) => {
  const req = httpsRequest({ hostname, port, path, method: "GET", headers, signal, servername: hostname, family: isIP(address),
    lookup: (_host, _options, callback) => callback(null, address, isIP(address) as 4 | 6),
  }, (res) => resolve({ status: res.statusCode ?? 0, body: res }));
  req.on("error", reject); req.end();
});
function fail(): never { throw new Error("Invalid provider API response or request"); }
function object(v: unknown): Record<string, unknown> { if (!v || typeof v !== "object" || Array.isArray(v)) return fail(); return v as Record<string, unknown>; }
function string(v: unknown): string { if (typeof v !== "string" || !v) return fail(); return v; }
function validPath(value: string): boolean { return value.length > 0 && value.length <= 1024 && !/[\u0000-\u001f\u007f\\]/.test(value) && value.split("/").every((p) => !!p && p !== "." && p !== ".."); }
function repoPath(repo: string, kind: Kind): string {
  if (!validPath(repo) || repo.split("/").length < 2 || (kind !== "gitlab" && repo.split("/").length !== 2)) return fail();
  return kind === "gitlab" ? encodeURIComponent(repo) : repo.split("/").map(encodeURIComponent).join("/");
}
function refValue(ref: string): string { if (!validPath(ref) || ref.length > 255) return fail(); return encodeURIComponent(ref); }
function baseUrl(options: Options): URL {
  const input = options.instance ?? (options.kind === "codeberg" ? "https://codeberg.org" : options.kind === "gitlab" ? "https://gitlab.com" : "");
  let url: URL; try { url = new URL(input); } catch { return fail(); }
  const host = url.hostname.toLowerCase();
  if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash || isIP(host.replace(/^\[|\]$/g, "")) || !host.includes(".") || host.endsWith(".local") || host.endsWith(".localhost") || (options.kind === "codeberg" && (host !== "codeberg.org" || !!url.port))) return fail();
  return url;
}
function summary(value: unknown, kind: Kind, origin: string): RepoSummary {
  const r = object(value); const gitlab = kind === "gitlab";
  const id = r.id; const fullName = string(gitlab ? r.path_with_namespace : r.full_name);
  const cloneUrl = string(gitlab ? r.http_url_to_repo : r.clone_url);
  const clone = new URL(cloneUrl);
  if (!Number.isSafeInteger(id) || (id as number) <= 0 || !validPath(fullName) || clone.protocol !== "https:" || clone.origin !== origin || clone.username || clone.password || clone.search || clone.hash || clone.pathname !== `/${fullName}.git`) return fail();
  const visibility = gitlab ? r.visibility : r.private;
  if (gitlab ? !["private", "internal", "public"].includes(String(visibility)) : typeof visibility !== "boolean") return fail();
  const pushed = gitlab ? r.last_activity_at : r.pushed_at;
  return { id: id as number, fullName, private: gitlab ? visibility !== "public" : visibility as boolean, defaultBranch: string(r.default_branch), pushedAt: typeof pushed === "string" ? pushed : null, cloneUrl };
}
export function createProviderApi(options: Options) {
  const instance = baseUrl(options); const host = instance.hostname; const port = Number(instance.port || 443);
  const resolve = options.resolve ?? defaultResolver; const transport = options.transport ?? nodeHttpsTransport;
  const headers = { ...options.headers, accept: "application/json" };
  // Header override of routing and connection semantics could bypass instance binding.
  if (Object.keys(headers).some((key) => /^(host|connection|proxy-authorization|transfer-encoding|content-length)$/i.test(key))) return fail();
  const timeoutMs = options.timeoutMs ?? 10_000;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000) return fail();
  async function withResponse<T>(path: string, consume: (body: AsyncIterable<Uint8Array>, signal: AbortSignal) => Promise<T>, requestTimeout = timeoutMs, externalSignal?: AbortSignal): Promise<T> {
    const controller = new AbortController();
    if (externalSignal?.aborted) throw new Error("Provider request canceled");
    const operation = async () => {
      const addresses = await resolve(host);
      if (controller.signal.aborted || !addresses.length || addresses.some((a) => !publicIp(a))) return fail();
      const response = await transport({ hostname: host, port, address: addresses[0], path, headers, signal: controller.signal });
      if (response.status < 200 || response.status >= 300) return fail();
      return consume(response.body, controller.signal);
    };
    let timer: ReturnType<typeof setTimeout> | undefined;
    let onAbort: (() => void) | undefined;
    const canceled = new Promise<never>((_, reject) => { onAbort = () => { controller.abort(); reject(new Error("Provider request canceled")); }; externalSignal?.addEventListener("abort", onAbort, { once: true }); });
    try { return await Promise.race([operation(), canceled, new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error("Provider request timed out")); }, requestTimeout); })]); }
    finally { if (timer) clearTimeout(timer); if (onAbort) externalSignal?.removeEventListener("abort", onAbort); controller.abort(); }
  }
  async function get(path: string, limit: number): Promise<Buffer> {
    return withResponse(path, async (body, signal) => {
      const chunks: Buffer[] = []; let size = 0;
      for await (const chunk of body) { if (signal.aborted) return fail(); size += chunk.byteLength; if (size > limit) return fail(); chunks.push(Buffer.from(chunk)); }
      return Buffer.concat(chunks);
    });
  }
  async function json(path: string, limit = 2_000_000): Promise<unknown> { try { return JSON.parse((await get(path, limit)).toString("utf8")); } catch { return fail(); } }
  const prefix = options.kind === "gitlab" ? "/api/v4" : "/api/v1";
  return {
    async getRepository(repo: string): Promise<RepoSummary> {
      const id = repoPath(repo, options.kind);
      const path = options.kind === "gitlab" ? `${prefix}/projects/${id}` : `${prefix}/repos/${id}`;
      const result = summary(await json(path), options.kind, instance.origin);
      if (result.fullName !== repo) return fail();
      return result;
    },
    async branchCommit(repo: string, ref: string): Promise<string> {
      const id = repoPath(repo, options.kind); const branch = refValue(ref);
      const path = options.kind === "gitlab" ? `${prefix}/projects/${id}/repository/branches/${branch}` : `${prefix}/repos/${id}/branches/${branch}`;
      const data = object(await json(path)); const commit = object(data.commit);
      const sha = string(commit.id);
      if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(sha)) return fail();
      return sha.toLowerCase();
    },
    async downloadArchive(repo: string, sha: string, destination: string, signal?: AbortSignal): Promise<void> {
      const id = repoPath(repo, options.kind);
      if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(sha)) return fail();
      const path = options.kind === "gitlab" ? `${prefix}/projects/${id}/repository/archive.tar.gz?sha=${sha}&include_lfs_blobs=false` : `${prefix}/repos/${id}/archive/${sha}.tar.gz`;
      const limit = options.archiveLimitBytes ?? 500 * 1024 * 1024;
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500 * 1024 * 1024) return fail();
      let created = false;
      let activeFile: Awaited<ReturnType<typeof openFile>> | undefined;
      try {
        await withResponse(path, async (body, signal) => {
          if (signal.aborted) return fail();
          const file = await openFile(destination, "wx", 0o600);
          activeFile = file;
          created = true;
          try {
            if (signal.aborted) return fail();
            let size = 0;
            for await (const chunk of body) {
              if (signal.aborted) return fail();
              size += chunk.byteLength;
              if (size > limit) return fail();
              await file.writeFile(chunk);
            }
          } finally {
            await file.close().catch(() => {});
            if (signal.aborted) await unlink(destination).catch(() => {});
          }
        }, options.timeoutMs ?? 300_000, signal);
      } catch (error) {
        await activeFile?.close().catch(() => {});
        if (created) await unlink(destination).catch(() => {});
        throw error;
      }
    },
    async listRepositories(page = 1): Promise<RepoPage> {
      if (!Number.isSafeInteger(page) || page < 1 || page > 1000) return fail();
      const path = options.kind === "gitlab" ? `${prefix}/projects?membership=true&per_page=100&page=${page}` : `${prefix}/user/repos?limit=100&page=${page}`;
      const raw = await json(path); if (!Array.isArray(raw) || raw.length > 100) return fail();
      return { repositories: raw.map((r) => summary(r, options.kind, instance.origin)), nextPage: (options.kind === "gitlab" ? raw.length === 100 : raw.length > 0) && page < 1000 ? page + 1 : null };
    },
    async readTree(repo: string, ref: string): Promise<Tree> {
      const id = repoPath(repo, options.kind); const branch = refValue(ref);
      if (options.kind === "gitlab") {
        const paths: string[] = [];
        for (let page = 1; page <= 20; page++) {
          const raw = await json(`${prefix}/projects/${id}/repository/tree?recursive=true&per_page=100&page=${page}&ref=${branch}`, 10_000_000);
          if (!Array.isArray(raw) || raw.length > 100) return fail();
          for (const item of raw) { const entry = object(item); if (entry.type === "blob") paths.push(string(entry.path)); }
          if (raw.length < 100) return { paths, truncated: false };
        }
        return { paths, truncated: true };
      }
      const data = object(await json(`${prefix}/repos/${id}/git/trees/${branch}?recursive=true`, 10_000_000));
      if (!Array.isArray(data.tree) || typeof data.truncated !== "boolean") return fail();
      return { paths: data.tree.map(object).filter((entry) => entry.type === "blob").map((entry) => string(entry.path)), truncated: data.truncated };
    },
    async readFile(repo: string, ref: string, path: string): Promise<string> {
      const id = repoPath(repo, options.kind); const branch = refValue(ref);
      if (!validPath(path)) return fail();
      const file = options.kind === "gitlab" ? `${prefix}/projects/${id}/repository/files/${encodeURIComponent(path)}/raw` : `${prefix}/repos/${id}/raw/${path.split("/").map(encodeURIComponent).join("/")}`;
      return (await get(`${file}?ref=${branch}`, 200_000)).toString("utf8");
    },
  };
}



