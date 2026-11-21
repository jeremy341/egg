import { z } from "zod";
import { assertInstallationOwned, GithubError } from "@/server/github/app";
import { authed, handle, HttpError, ok, zodToHttp } from "@/server/http";
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
 * What a repository is, and the environment variable NAMES it asks for.
 * Names only: no value from the repository is ever returned.
 */
export const GET = handle(async (req) => {
  const user = await authed();
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
    const client = p.providerConnectionId ? await providerClientForUser(user.id, p.providerConnectionId, p.sourceProvider) : publicProviderClient(p.sourceProvider, p.repo);
    const repo = p.providerConnectionId ? p.repo : repositoryNameFromUrl(p.repo);
    if (!p.providerConnectionId) await validateProviderSource(client, { repoFullName: repo, repoUrl: p.repo, productionBranch: p.branch }, true);
    return ok(await detectProviderRepository(client, { ...p, repo }));
  }
  const parsed = query.safeParse(params);
  if (!parsed.success) throw zodToHttp(parsed.error);
  const q = parsed.data;

  let source: RepoSource;
  if ("projectId" in q) {
    const project = await getProjectForUser(user.id, q.projectId);
    if (project.sourceProvider !== "github") {
      if (project.sourceProvider === "generic" || !project.repoFullName) throw new HttpError(400, "This project cannot be inspected automatically.", "validation");
      const client = project.providerConnectionId ? await providerClientForUser(user.id, project.providerConnectionId, project.sourceProvider) : publicProviderClient(project.sourceProvider, project.repoUrl);
      return ok(await detectProviderRepository(client, { repo: project.repoFullName, branch: project.productionBranch, root: project.rootDir }));
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

  const result = await readRepo(source);
  return ok(result);
});
