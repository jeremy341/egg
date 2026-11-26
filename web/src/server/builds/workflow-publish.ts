import { audit } from "@/server/audit";
import { config } from "@/server/config";
import { assertInstallationOwned, GithubError, headers, installationToken } from "@/server/github/app";
import { WORKFLOW_PATH, WorkflowError, buildWorkflow } from "@/server/builds/workflow";
import { isSafeBranch } from "@/server/github/webhook";
import { HttpError } from "@/server/http";
import { getProjectForUser } from "@/server/projects";
import { repoFromProject } from "@/server/root-detect";

/**
 * Opens a pull request that adds the Egg build workflow to a project's repository, so the user never writes the YAML
 * and approves the change by merging it. The base (production) branch is only read, and is never written: the file
 * goes on a working branch with a fixed name, and that branch is the pull request's head.
 *
 * The file is exactly what `buildWorkflow` returns, and it holds no secret. The installation token is used as a
 * bearer header and is never put in a URL, an error, a log line or the audit row.
 */

export const WORKFLOW_BRANCH = "egg/add-build-workflow";

export type PublishStatus = "opened" | "updated" | "already";

export type PublishResult = {
  status: PublishStatus;
  /** The working branch, or the base branch when the file is already there. */
  branch: string;
  base: string;
  pullRequestUrl: string | null;
};

export type PublishDeps = {
  /** Replaced in tests. The default is the global fetch, read at call time. */
  fetchImpl?: typeof fetch;
};

type FetchLike = typeof fetch;

const API = "https://api.github.com";
const TIMEOUT_MS = 8000;

const PERMISSION_MESSAGE =
  "Egg's GitHub App is missing a permission it needs. The owner of the GitHub App must grant Contents: Read and write, " +
  "Pull requests: Read and write and Workflows: Read and write, and the repository owner must accept the update. Then try again.";
const REPO_UNAVAILABLE =
  "Egg cannot find the repository or its production branch on GitHub. Check the repository and the production branch, then try again.";
const GITHUB_ERROR = "GitHub did not answer as expected. Try again in a minute.";
const NO_ACCESS =
  "Egg could not get access to this repository through the GitHub App. Check that the Egg GitHub App is still installed on it.";
const NOT_GITHUB =
  "This project is not linked to a GitHub repository through the Egg GitHub App, so Egg cannot open a pull request for it.";

/** Egg's own pull request text. It states that nothing secret is in the file. */
const PR_TITLE = "Add Egg build workflow";
const PR_BODY = [
  "This adds `.github/workflows/egg.yml`. The workflow builds this project on GitHub Actions and sends the finished release to Egg.",
  "",
  "The file contains no secrets. It reads four secrets that you add yourself: the two production ones in the egg-production environment, and the two preview ones in the repository settings. Egg's project settings show their names and where to save them.",
  "",
  "Merging this pull request adds the workflow to the production branch. Nothing else in the repository changes.",
].join("\n");

const ALREADY_EXISTS = /already exists/i;

/** One request to GitHub, always with a timeout. The token travels only in the Authorization header. */
function call(fetchImpl: FetchLike, token: string, method: string, url: string, body?: unknown): Promise<Response> {
  return fetchImpl(url, {
    method,
    headers: headers(token, body === undefined ? {} : { "content-type": "application/json" }),
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
}

/** Each segment of a branch name is encoded on its own, so the slashes stay as path separators. */
const refPath = (branch: string) => branch.split("/").map(encodeURIComponent).join("/");

/**
 * The HTTP error for a failed GitHub answer. It is decided from the JSON `message` alone, never the raw body, and no
 * part of GitHub's text is copied into the error. A permission refusal is recognised first, because GitHub gives it
 * as 403 or 404.
 */
function classify(status: number, message: string): HttpError {
  const permission =
    /Resource not accessible by integration/i.test(message) || (/workflow/i.test(message) && /permission/i.test(message));
  if (permission) return new HttpError(403, PERMISSION_MESSAGE, "permission_missing");
  if (status === 404) return new HttpError(404, REPO_UNAVAILABLE, "repo_unavailable");
  return new HttpError(502, GITHUB_ERROR, "github_error");
}

/** The JSON `message` of a response, read once. Empty when the body is not JSON or has no message. */
async function messageOf(res: Response): Promise<string> {
  const text = await res.text();
  try {
    const parsed = JSON.parse(text) as { message?: unknown };
    return typeof parsed.message === "string" ? parsed.message : "";
  } catch {
    return "";
  }
}

/** A file read from GitHub. `text` is null when GitHub did not return the content (not a file, or over 1 MB). */
type FileState = { exists: false } | { exists: true; sha: string | null; text: string | null };

async function readFile(fetchImpl: FetchLike, token: string, url: string): Promise<FileState> {
  const res = await call(fetchImpl, token, "GET", url);
  if (res.status === 404) {
    const err = classify(404, await messageOf(res));
    if (err.code === "permission_missing") throw err;
    return { exists: false };
  }
  if (!res.ok) throw classify(res.status, await messageOf(res));
  const body = (await res.json()) as { type?: unknown; sha?: unknown; encoding?: unknown; content?: unknown };
  const sha = typeof body.sha === "string" ? body.sha : null;
  const text =
    body.type === "file" && body.encoding === "base64" && typeof body.content === "string"
      ? // GitHub wraps the base64 with newlines; they are stripped before decoding.
        Buffer.from(body.content.replace(/\s/g, ""), "base64").toString("utf8")
      : null;
  return { exists: true, sha, text };
}

/** The open pull request from the working branch into the base, as its URL, or null when there is none. */
async function findOpenPull(fetchImpl: FetchLike, token: string, repo: string, base: string): Promise<string | null> {
  const owner = repo.split("/")[0];
  const query = new URLSearchParams({ state: "open", head: `${owner}:${WORKFLOW_BRANCH}`, base });
  const res = await call(fetchImpl, token, "GET", `${API}/repos/${repo}/pulls?${query.toString()}`);
  if (!res.ok) throw classify(res.status, await messageOf(res));
  const pulls = (await res.json()) as { html_url?: unknown }[];
  const first = pulls[0];
  return first && typeof first.html_url === "string" ? first.html_url : null;
}

/**
 * The GitHub work, in order: read the base, check the file there, make or reuse the working branch, write the file
 * there if it differs, then open or reuse the pull request. Every write goes to the working branch.
 */
async function publishWith(fetchImpl: FetchLike, token: string, repo: string, base: string, workflow: string): Promise<PublishResult> {
  const api = `${API}/repos/${repo}`;
  const fileUrl = (ref: string) => `${api}/contents/${WORKFLOW_PATH}?ref=${encodeURIComponent(ref)}`;

  // a. The base commit. A missing repository or branch is a 404 (repo_unavailable).
  const baseRes = await call(fetchImpl, token, "GET", `${api}/git/ref/heads/${refPath(base)}`);
  if (!baseRes.ok) throw classify(baseRes.status, await messageOf(baseRes));
  const baseRef = (await baseRes.json()) as { object?: { sha?: unknown } };
  if (typeof baseRef.object?.sha !== "string") throw new HttpError(502, GITHUB_ERROR, "github_error");
  const baseSha = baseRef.object.sha;

  // b. The file on the base. Identical content means there is nothing to add, and nothing is written.
  const onBase = await readFile(fetchImpl, token, fileUrl(base));
  if (onBase.exists && onBase.text === workflow) {
    return { status: "already", branch: base, base, pullRequestUrl: null };
  }

  // c. The working branch: reuse it, or make it from the base commit. A racing request may make it first, so the
  //    refusal "already exists" is answered by one re-read, never a loop.
  const branchRes = await call(fetchImpl, token, "GET", `${api}/git/ref/heads/${refPath(WORKFLOW_BRANCH)}`);
  if (branchRes.ok) {
    // The branch is left over from an earlier pull request, merged or closed, so it is behind the base and may hold an
    // older copy of the file. With no pull request open on it nobody is reviewing it, so it is moved to the base
    // commit. Otherwise a second pull request after a squash merge would conflict with the file that was merged.
    if (!(await findOpenPull(fetchImpl, token, repo, base))) {
      const reset = await call(fetchImpl, token, "PATCH", `${api}/git/refs/heads/${refPath(WORKFLOW_BRANCH)}`, {
        sha: baseSha,
        force: true,
      });
      if (!reset.ok) throw classify(reset.status, await messageOf(reset));
    }
  } else {
    if (branchRes.status !== 404) throw classify(branchRes.status, await messageOf(branchRes));
    const missing = classify(404, await messageOf(branchRes));
    if (missing.code === "permission_missing") throw missing;
    const created = await call(fetchImpl, token, "POST", `${api}/git/refs`, {
      ref: `refs/heads/${WORKFLOW_BRANCH}`,
      sha: baseSha,
    });
    if (!created.ok) {
      const message = await messageOf(created);
      if (created.status !== 422 || !ALREADY_EXISTS.test(message)) throw classify(created.status, message);
      const reread = await call(fetchImpl, token, "GET", `${api}/git/ref/heads/${refPath(WORKFLOW_BRANCH)}`);
      if (!reread.ok) throw classify(reread.status, await messageOf(reread));
    }
  }

  // d. The file on the working branch. It is written only when it differs, and its sha is sent only when it exists.
  const onBranch = await readFile(fetchImpl, token, fileUrl(WORKFLOW_BRANCH));
  if (!(onBranch.exists && onBranch.text === workflow)) {
    const put = await call(fetchImpl, token, "PUT", `${api}/contents/${WORKFLOW_PATH}`, {
      message: onBranch.exists ? "Update the Egg build workflow" : "Add the Egg build workflow",
      content: Buffer.from(workflow).toString("base64"),
      branch: WORKFLOW_BRANCH,
      ...(onBranch.exists && onBranch.sha ? { sha: onBranch.sha } : {}),
    });
    if (!put.ok) throw classify(put.status, await messageOf(put));
  }

  // e. The pull request: reuse the open one, or open it. A racing request may open it first, so it is looked for once more.
  const existing = await findOpenPull(fetchImpl, token, repo, base);
  if (existing) return { status: "updated", branch: WORKFLOW_BRANCH, base, pullRequestUrl: existing };

  const opened = await call(fetchImpl, token, "POST", `${api}/pulls`, {
    title: PR_TITLE,
    head: WORKFLOW_BRANCH,
    base,
    body: PR_BODY,
  });
  if (opened.ok) {
    const pr = (await opened.json()) as { html_url?: unknown };
    if (typeof pr.html_url !== "string") throw new HttpError(502, GITHUB_ERROR, "github_error");
    return { status: "opened", branch: WORKFLOW_BRANCH, base, pullRequestUrl: pr.html_url };
  }
  const message = await messageOf(opened);
  if (opened.status !== 422 || !ALREADY_EXISTS.test(message)) throw classify(opened.status, message);
  const raced = await findOpenPull(fetchImpl, token, repo, base);
  if (!raced) throw new HttpError(502, GITHUB_ERROR, "github_error");
  return { status: "updated", branch: WORKFLOW_BRANCH, base, pullRequestUrl: raced };
}

/**
 * Open (or update) the pull request that adds the build workflow to the project's repository. Owner only: a project
 * that is not theirs is "not found". The project must be linked to a GitHub installation and a repository.
 */
export async function publishWorkflow(userId: string, projectId: string, deps: PublishDeps = {}): Promise<PublishResult> {
  const project = await getProjectForUser(userId, projectId);
  const repo = repoFromProject(project);
  if (!project.installationId || !repo) throw new HttpError(400, NOT_GITHUB, "not_a_github_project");
  const installationId = project.installationId;

  // The branch goes into request paths, so it is held to the same rule as every other branch Egg uses: no "..", which a
  // URL would resolve to another path. Checked before any request.
  if (!isSafeBranch(project.productionBranch)) throw new HttpError(422, "The production branch name is not valid.", "workflow_invalid");

  // The file is built before any request, so an invalid setting never reaches a URL or a branch name.
  let workflow: string;
  try {
    workflow = buildWorkflow({
      eggUrl: config().APP_URL,
      productionBranch: project.productionBranch,
      runtime: project.runtime,
      installCommand: project.installCommand,
      buildCommand: project.buildCommand,
      outputDir: project.outputDir,
      rootDir: project.rootDir,
    });
  } catch (err) {
    if (err instanceof WorkflowError) throw new HttpError(422, err.message, "workflow_invalid");
    throw err;
  }

  const fetchImpl: FetchLike = deps.fetchImpl ?? fetch;
  let result: PublishResult;
  try {
    try {
      await assertInstallationOwned(userId, installationId);
    } catch (err) {
      if (err instanceof GithubError) throw new HttpError(400, NOT_GITHUB, "not_a_github_project");
      throw err;
    }
    const token = await installationToken(installationId, fetchImpl);
    result = await publishWith(fetchImpl, token, repo, project.productionBranch, workflow);
  } catch (err) {
    if (err instanceof HttpError) throw err;
    // Anything else (a network error, a timeout, a body that is not JSON, the app not configured) becomes one generic
    // answer. The original error is not copied, so no response text or token reaches the user or a log.
    if (err instanceof GithubError) throw new HttpError(502, NO_ACCESS, "github_error");
    throw new HttpError(502, GITHUB_ERROR, "github_error");
  }

  await audit(userId, "project.workflow.publish", projectId, { status: result.status, branch: result.branch });
  return result;
}
