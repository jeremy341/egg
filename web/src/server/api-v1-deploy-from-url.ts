import { z } from "zod";
import { requireScope, type Principal } from "@/server/api-tokens";
import { apiUpdateDeploymentGithubRepository } from "@/server/api-v1-deployments";
import { endpoint, NOT_FOUND_NOTE, projectIdInput, type Endpoint } from "@/server/api-v1-kit";
import { deploymentSchema, projectSchema } from "@/server/api-v1-models";
import { getGithubRepositoryDefaultBranch, GithubError } from "@/server/github/app";
import { HttpError } from "@/server/http";
import { getProjectForUser } from "@/server/projects";

export type ParsedGithubRepositoryUrl = {
  repoFullName: string;
  branch?: string;
};

const OWNER = /^[A-Za-z0-9_.-]+$/;
const REPOSITORY = /^[A-Za-z0-9_.-]+$/;
const BRANCH = /^[A-Za-z0-9._/-]+$/;

function validBranch(value: string): boolean {
  return value.length > 0 && value.length <= 200 && BRANCH.test(value) && !value.startsWith("-") && !value.includes("..");
}

/** Parse the GitHub repository URL forms accepted by deploy_from_github_url. */
export function parseGithubRepositoryUrl(raw: string): ParsedGithubRepositoryUrl | null {
  if (raw.startsWith("git@")) {
    const match = /^git@github\.com:([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\.git$/.exec(raw);
    if (!match || !OWNER.test(match[1]) || !REPOSITORY.test(match[2])) return null;
    return { repoFullName: `${match[1]}/${match[2]}` };
  }

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (
    url.protocol !== "https:" ||
    url.hostname !== "github.com" ||
    url.username !== "" ||
    url.password !== "" ||
    url.port !== "" ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    return null;
  }

  let parts: string[];
  try {
    parts = url.pathname.slice(1).split("/").map(decodeURIComponent);
  } catch {
    return null;
  }
  if (parts.some((part) => part.length === 0)) return null;

  const [owner, rawRepo, suffix, ...branchParts] = parts;
  if (!owner || !rawRepo || !OWNER.test(owner)) return null;
  const repo = rawRepo.endsWith(".git") ? rawRepo.slice(0, -4) : rawRepo;
  if (!repo || !REPOSITORY.test(repo)) return null;

  if (suffix === undefined) return { repoFullName: `${owner}/${repo}` };
  if (suffix !== "tree" || branchParts.length === 0) return null;
  const branch = branchParts.join("/");
  if (!validBranch(branch)) return null;
  return { repoFullName: `${owner}/${repo}`, branch };
}

function defaultBranchError(error: GithubError): HttpError {
  if (error.status === 403) return new HttpError(403, "GitHub denied access to that repository.", "forbidden");
  if (error.status === 404) return new HttpError(400, "That repository is not available through the project's GitHub connection.", "validation");
  return new HttpError(502, "Could not read the repository's default branch from GitHub.", "github");
}

/** Change the source to the URL's repository, then queue its production branch. */
export async function apiDeployFromGithubUrl(p: Principal, projectId: string, githubUrl: string) {
  requireScope(p, "projects:write");
  requireScope(p, "deployments:write");

  const parsed = parseGithubRepositoryUrl(githubUrl);
  if (!parsed) {
    throw new HttpError(400, "Use a GitHub HTTPS repository URL or git@github.com URL, optionally ending in /tree/<branch>.", "validation");
  }

  const project = await getProjectForUser(p.userId, projectId);
  let productionBranch = parsed.branch;
  if (!productionBranch) {
    try {
      productionBranch = await getGithubRepositoryDefaultBranch(project.installationId, parsed.repoFullName);
    } catch (error) {
      if (error instanceof GithubError) throw defaultBranchError(error);
      throw error;
    }
  }

  const updated = await apiUpdateDeploymentGithubRepository(p, projectId, {
    repoFullName: parsed.repoFullName,
    productionBranch,
  });
  const { apiDeployBranch } = await import("@/server/api-v1");
  const queued = await apiDeployBranch(p, projectId, undefined, "deploy.from_github_url");
  return { project: updated.project, deployment: queued.deployment };
}

export const DEPLOY_FROM_URL_ENDPOINTS: Endpoint[] = [
  endpoint({
    id: "deploy_from_github_url",
    method: "POST",
    path: "/projects/{projectId}/deploy-from-github-url",
    scope: "deployments:write",
    bucket: "write",
    status: 202,
    sensitive: true,
    tag: "Deployments",
    summary: "Deploy from a GitHub URL",
    description: `Set the project's GitHub repository from a supported GitHub URL, choose the URL's branch or the repository's default branch, and queue a production deployment. Requires projects:write and deployments:write. The URL is never stored in the audit log. ${NOT_FOUND_NOTE}`,
    pathParams: { projectId: projectIdInput },
    body: {
      githubUrl: z.string().trim().min(1).max(1000).describe("GitHub repository URL: https://github.com/owner/repo, its .git form, git@github.com:owner/repo.git, or a URL ending in /tree/<branch>."),
    },
    response: z.object({ project: projectSchema, deployment: deploymentSchema }),
    errors: [400, 403, 404, 409, 502],
    run: (p, i) => apiDeployFromGithubUrl(p, i.projectId, i.githubUrl),
  }),
];
