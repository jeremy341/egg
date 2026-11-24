import { authed, handle, HttpError, ok } from "@/server/http";
import { assertInstallationOwned, installationToken, headers as githubHeaders } from "@/server/github/app";
import { getProjectForUser } from "@/server/projects";
import { providerClientForUser, publicProviderClient, repositoryNameFromUrl } from "@/server/providers/connections";
import { parseScore, previewScore } from "@/server/score";

type Ctx = { params: Promise<{ id: string }> };

/** Read score.yaml from the configured repository and return a preview. This route never applies it. */
export const GET = handle<Ctx>(async (_req, { params }) => {
  const user = await authed();
  const { id } = await params;
  const project = await getProjectForUser(user.id, id);
  const path = [project.rootDir === "." ? "" : project.rootDir.replace(/^\/|\/$/g, ""), "score.yaml"].filter(Boolean).join("/");
  let source: string;
  try {
    if (project.sourceProvider === "github") {
      const repo = project.repoFullName ?? repositoryNameFromUrl(project.repoUrl);
      if (project.installationId) await assertInstallationOwned(user.id, project.installationId);
      const token = project.installationId ? await installationToken(project.installationId) : "";
      const requestHeaders = githubHeaders(token, { accept: "application/vnd.github.raw+json" });
      if (!token) delete (requestHeaders as Partial<typeof requestHeaders>).authorization;
      const response = await fetch(`https://api.github.com/repos/${repo.split("/").map(encodeURIComponent).join("/")}/contents/${path.split("/").map(encodeURIComponent).join("/")}?ref=${encodeURIComponent(project.productionBranch)}`, { headers: requestHeaders, signal: AbortSignal.timeout(10_000) });
      if (response.status === 404) throw new HttpError(404, "score.yaml was not found in the repository branch.", "not_found");
      if (!response.ok) throw new HttpError(502, "Could not read score.yaml from GitHub.", "upstream");
      source = await response.text();
    } else if (["gitlab", "forgejo", "codeberg"].includes(project.sourceProvider)) {
      const provider = project.sourceProvider as "gitlab" | "forgejo" | "codeberg";
      const client = project.providerConnectionId
        ? await providerClientForUser(user.id, project.providerConnectionId, provider)
        : publicProviderClient(provider, project.repoUrl);
      try { source = await client.readFile(project.repoFullName ?? repositoryNameFromUrl(project.repoUrl), project.productionBranch, path); }
      catch { throw new HttpError(404, "score.yaml was not found or could not be read from the repository branch.", "not_found"); }
    } else {
      throw new HttpError(400, "Score files are not available for this repository provider.", "validation");
    }
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(502, "Could not read score.yaml from the repository.", "upstream");
  }
  const score = parseScore(source);
  return ok({ file: "score.yaml", branch: project.productionBranch, score, preview: previewScore(score) });
});
