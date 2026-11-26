import { z } from "zod";
import { assertInstallationOwned, GithubError } from "@/server/github/app";
import { authed, handle, HttpError, ok, zodToHttp } from "@/server/http";
import { enforceRateLimit } from "@/server/rate-limit";
import { getProjectForUser } from "@/server/projects";
import { readRepo, type RepoSource } from "@/server/repo-read";
import { repoFromProject } from "@/server/root-detect";
import { providerClientForUser, publicProviderClient, repositoryNameFromUrl, validateProviderSource } from "@/server/providers/connections";
import { detectProviderRepository } from "@/server/providers/detect";

const REPO = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

const query = z.union([
  // An existing project: everything comes from the stored project.
  z.object({ projectId: z.string().min(1).max(64) }),
  // A repository chosen in the new project flow.
  z.object({
    repo: z.string().regex(REPO, "repo must look like owner/name").max(200),
    branch: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .regex(/^[A-Za-z0-9._/-]+$/, "Invalid branch name")
      .refine((v) => !v.startsWith("-") && !v.includes(".."), "Invalid branch name")
      .default("main"),
    installation: z.coerce.number().int().positive().optional(),
    root: z.string().trim().max(200).default("."),
  }),
]);

/**
 * A short, per-user cache for the expensive provider reads. Detection is triggered on every keystroke while a
 * repository/branch/root is being typed, and each read costs calls against the shared unauthenticated GitHub API
 * (60 requests/hour/IP). Repeating the same query a few seconds later is served from memory instead. The user id is
 * part of the key so one user's connection-backed result is never served to another.
 */
const DETECT_CACHE_MS = 15_000;
const DETECT_CACHE_MAX_KEYS = 500;
const detectCache = new Map<string, { at: number; value: unknown }>();

async function cachedDetect<T>(key: string, load: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const hit = detectCache.get(key);
  if (hit && now - hit.at < DETECT_CACHE_MS) return hit.value as T;
  const value = await load();
  detectCache.delete(key);
  if (detectCache.size >= DETECT_CACHE_MAX_KEYS) {
    const oldest = detectCache.keys().next();
    if (!oldest.done) detectCache.delete(oldest.value);
  }
  detectCache.set(key, { at: Date.now(), value });
  return value;
}

/**
 * What a repository is, and the environment variable NAMES it asks for.
 * Names only: no value from the repository is ever returned.
 */
export const GET = handle(async (req) => {
  const user = await authed();
  // Keystroke-triggered detection would otherwise burn the shared unauthenticated GitHub API quota.
  enforceRateLimit("repoDetect", user.id);
  const params = Object.fromEntries(
    [...req.nextUrl.searchParams.entries()].filter(([, v]) => v !== "")
  );
  if (params.sourceProvider && params.sourceProvider !== "github") {
    const providerQuery = z.object({
      sourceProvider: z.enum(["gitlab", "forgejo", "codeberg"]),
      providerConnectionId: z.string().min(1).max(64).optional(),
      repo: z.string().min(3).max(200),
      branch: z.string().min(1).max(200),
      root: z.string().max(200).default("."),
    }).safeParse(params);
    if (!providerQuery.success) throw zodToHttp(providerQuery.error);
    const p = providerQuery.data;
    const repo = p.providerConnectionId ? p.repo : repositoryNameFromUrl(p.repo);
    const key = `detect:${user.id}:provider:${p.sourceProvider}:${p.providerConnectionId ?? "public"}:${repo}:${p.branch}:${p.root}`;
    return ok(await cachedDetect(key, async () => {
      const client = p.providerConnectionId ? await providerClientForUser(user.id, p.providerConnectionId, p.sourceProvider) : publicProviderClient(p.sourceProvider, p.repo);
      if (!p.providerConnectionId) await validateProviderSource(client, { repoFullName: repo, repoUrl: p.repo, productionBranch: p.branch }, true);
      return detectProviderRepository(client, { ...p, repo });
    }));
  }
  const parsed = query.safeParse(params);
  if (!parsed.success) throw zodToHttp(parsed.error);
  const q = parsed.data;

  let source: RepoSource;
  if ("projectId" in q) {
    const project = await getProjectForUser(user.id, q.projectId);
    if (project.sourceProvider !== "github") {
      if (project.sourceProvider === "generic" || !project.repoFullName) throw new HttpError(400, "This project cannot be inspected automatically.", "validation");
      // Capture the narrowed type before the async closure, which would otherwise widen it back to the full union.
      const provider = project.sourceProvider;
      const repoFullName = project.repoFullName;
      const key = `detect:${user.id}:provider:${provider}:${project.providerConnectionId ?? "public"}:${repoFullName}:${project.productionBranch}:${project.rootDir}`;
      return ok(await cachedDetect(key, async () => {
        const client = project.providerConnectionId ? await providerClientForUser(user.id, project.providerConnectionId, provider) : publicProviderClient(provider, project.repoUrl);
        return detectProviderRepository(client, { repo: repoFullName, branch: project.productionBranch, root: project.rootDir });
      }));
    }
    const repo = repoFromProject(project);
    if (!repo) throw new HttpError(400, "Only GitHub repositories can be inspected here.", "validation");
    source = {
      repo,
      branch: project.productionBranch,
      installationId: project.installationId,
      rootDir: project.rootDir,
    };
  } else {
    if (q.installation) {
      try {
        await assertInstallationOwned(user.id, q.installation);
      } catch (err) {
        if (err instanceof GithubError) throw new HttpError(403, err.message, "forbidden");
        throw err;
      }
    }
    source = {
      repo: q.repo,
      branch: q.branch,
      installationId: q.installation ?? null,
      rootDir: q.root,
    };
  }

  const key = `detect:${user.id}:github:${source.repo}:${source.branch}:${source.rootDir}:${source.installationId ?? "public"}`;
  const result = await cachedDetect(key, () => readRepo(source));
  return ok(result);
});
