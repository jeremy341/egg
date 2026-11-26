import { GithubError, assertInstallationOwned, headers, installationToken, listInstallationRepos } from "@/server/github/app";
import { buildCredentialInfoForUser, type BuildCredentialInfo } from "@/server/builds/token";
import { PRODUCTION_ENVIRONMENT, WORKFLOW_PATH, WORKFLOW_SECRETS } from "@/server/builds/workflow";
import { readBytesLimited } from "@/server/body-limit";
import { HttpError } from "@/server/http";
import { getProjectForUser } from "@/server/projects";
import { repoFromProject } from "@/server/root-detect";

/**
 * "Test connection" for a project that builds on GitHub. Every check is something Egg can really do with what
 * it has: its own records, and the GitHub app's installation token (repository permissions Contents and Metadata,
 * read only). A check that cannot be done is not in the list of checks; `NOT_CHECKED` says so in plain words, and a
 * check that was skipped because an earlier one failed is "not_checked", never "pass".
 *
 * Nothing here returns or logs a token, a credential or the contents of the workflow file.
 */

export type CheckStatus = "pass" | "fail" | "not_checked";

export type CheckResult = {
  id: "location" | "credentials" | "installation" | "repository" | "workflow_file" | "workflow_matches";
  label: string;
  status: CheckStatus;
  /** One sentence. For a failure it says how to fix it. */
  detail: string;
};

export type ConnectionReport = {
  checks: CheckResult[];
  /** True only when every check ran and passed. It does not prove the secrets in GitHub are set. */
  allPassed: boolean;
  /** What Egg cannot check with the permissions its GitHub app has. */
  notChecked: string[];
};

/** Shown with every report. These are limits of the app's permissions, not results. */
export const NOT_CHECKED = [
  "Whether the secrets exist. The GitHub app cannot read repository secrets or environment secrets.",
  `Whether the ${PRODUCTION_ENVIRONMENT} environment exists, is limited to the production branch, or holds the two production secrets. The app cannot read environment settings.`,
  "Whether the secret values are the ones Egg made. Only a workflow run proves that.",
  "Whether GitHub Actions is turned on, or whether the last workflow run passed. The app has no Actions permission.",
] as const;

const MAX_WORKFLOW_BYTES = 1_000_000;
const API = "https://api.github.com";

type FetchLike = typeof fetch;

export type CheckDeps = {
  /** Egg's own address, as the workflow should contain it. */
  eggUrl: string;
  fetchImpl?: FetchLike;
  now?: Date;
};

const result = (id: CheckResult["id"], label: string, status: CheckStatus, detail: string): CheckResult => ({
  id,
  label,
  status,
  detail,
});

const day = (d: Date) => d.toISOString().slice(0, 10);

function credentialsCheck(info: BuildCredentialInfo[], now: Date): CheckResult {
  const label = "Build credentials";
  const need = ["upload_preview", "upload_production", "env_preview", "env_production"] as const;
  const missing = need.filter((s) => !info.some((c) => c.scope === s));
  if (info.length === 0 || missing.length > 0) {
    return result(
      "credentials",
      label,
      "fail",
      "Egg has no complete set of build credentials. Make them below, then save the values as secrets: the two production ones in the egg-production environment, the two preview ones in the repository."
    );
  }
  const expired = info.filter((c) => c.expired || c.expiresAt.getTime() <= now.getTime());
  if (expired.length > 0) {
    return result("credentials", label, "fail", "The build credentials have expired. Make new ones below and replace all four secrets.");
  }
  const soonest = new Date(Math.min(...info.map((c) => c.expiresAt.getTime())));
  return result("credentials", label, "pass", `Egg has all four build credentials. They work until ${day(soonest)}.`);
}

/**
 * Run the checks for one project of the signed-in user. The project must be theirs (404 otherwise, from
 * getProjectForUser). Network failures become failed checks; this function throws only for a project that is not found.
 */
export async function checkGithubConnection(userId: string, projectId: string, deps: CheckDeps): Promise<ConnectionReport> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const now = deps.now ?? new Date();
  const project = await getProjectForUser(userId, projectId);
  const checks: CheckResult[] = [];

  checks.push(
    project.buildLocation === "github"
      ? result("location", "Build location", "pass", "This project is set to build on GitHub.")
      : result("location", "Build location", "fail", "This project is set to build on your container. Choose GitHub Actions above and save.")
  );

  checks.push(credentialsCheck(await buildCredentialInfoForUser(userId, projectId, now), now));

  // ---- the GitHub app
  const skipped = (id: CheckResult["id"], label: string, why: string) => checks.push(result(id, label, "not_checked", `Not checked. ${why}`));
  const INSTALL = "GitHub app";
  const REPO = "Repository access";
  const FILE = "Workflow file";
  const MATCH = "Workflow settings";

  let token: string | null = null;
  if (!project.installationId) {
    checks.push(
      result("installation", INSTALL, "fail", "This project is not linked to the Egg GitHub app. Open Account, install the app on the repository, then add the project again.")
    );
  } else {
    try {
      await assertInstallationOwned(userId, project.installationId);
      token = await installationToken(project.installationId, fetchImpl);
      checks.push(result("installation", INSTALL, "pass", "The Egg GitHub app is installed and Egg can use it."));
    } catch (err) {
      if (err instanceof HttpError) throw err;
      // A network failure is a failed check, not a 500 (the project-not-found
      // throw above is the only one).
      checks.push(
        result(
          "installation",
          INSTALL,
          "fail",
          err instanceof GithubError ? installationAdvice(err) : "Egg could not reach GitHub to check the app. Try again in a minute."
        )
      );
    }
  }

  const repo = repoFromProject(project);
  let repoVisible = false;
  if (!token) {
    skipped("repository", REPO, "It needs the GitHub app first.");
  } else if (!repo) {
    checks.push(result("repository", REPO, "fail", "Only repositories on github.com can be checked. Use a github.com repository for this project."));
  } else {
    try {
      const repos = await listInstallationRepos(project.installationId as number, fetchImpl);
      repoVisible = repos.some((r) => r.fullName.toLowerCase() === repo.toLowerCase());
      if (repoVisible) {
        checks.push(result("repository", REPO, "pass", `The GitHub app can see ${repo}.`));
      } else if (repos.length >= 500) {
        checks.push(result("repository", REPO, "not_checked", `Not checked. The installation has more repositories than Egg lists, so ${repo} could not be confirmed.`));
      } else {
        checks.push(result("repository", REPO, "fail", `The GitHub app cannot see ${repo}. On GitHub, open the app's settings and add this repository to its access.`));
      }
    } catch (err) {
      if (err instanceof HttpError) throw err;
      checks.push(result("repository", REPO, "fail", "GitHub did not list the app's repositories. Try again in a minute."));
    }
  }

  // ---- the workflow file on the production branch (Contents, read only)
  let text: string | null = null;
  if (!repoVisible || !token || !repo) {
    skipped("workflow_file", FILE, "It needs repository access first.");
  } else {
    const url = `${API}/repos/${repo}/contents/${WORKFLOW_PATH}?ref=${encodeURIComponent(project.productionBranch)}`;
    try {
      const res = await fetchImpl(url, {
        headers: headers(token, { accept: "application/vnd.github.raw+json" }),
        signal: AbortSignal.timeout(8000),
      });
      if (res.status === 404) {
        checks.push(
          result(
            "workflow_file",
            FILE,
            "fail",
            `Egg found no file at ${WORKFLOW_PATH} on the ${project.productionBranch} branch. Copy the workflow above, commit it to ${project.productionBranch}, then test again.`
          )
        );
      } else if (!res.ok) {
        checks.push(result("workflow_file", FILE, "fail", `GitHub answered ${res.status} when Egg looked for the file. Try again in a minute.`));
      } else {
        // Counted as the bytes arrive; the read stops (and the stream is cancelled) once the limit is passed.
        let body: Buffer | null;
        try {
          body = await readBytesLimited(res, MAX_WORKFLOW_BYTES);
        } catch (err) {
          if (!(err instanceof HttpError && err.status === 413)) throw err;
          body = null;
        }
        if (body === null) {
          checks.push(result("workflow_file", FILE, "fail", `The file at ${WORKFLOW_PATH} is too large to be the workflow Egg made. Replace it with the one above.`));
        } else {
          text = body.toString("utf8");
          checks.push(result("workflow_file", FILE, "pass", `${WORKFLOW_PATH} exists on the ${project.productionBranch} branch.`));
        }
      }
    } catch {
      checks.push(result("workflow_file", FILE, "fail", "Egg could not reach GitHub to look for the file. Try again in a minute."));
    }
  }

  // ---- what the file says (the file is read, never stored or returned)
  if (text === null) {
    skipped("workflow_matches", MATCH, "It needs the workflow file first.");
  } else {
    checks.push(compareWorkflow(text, deps.eggUrl, project.productionBranch));
  }

  return {
    checks,
    allPassed: checks.every((c) => c.status === "pass"),
    notChecked: [...NOT_CHECKED],
  };
}

function installationAdvice(err: GithubError): string {
  if (err.status === 404) return "The Egg GitHub app is no longer installed on that account. Install it again from Account.";
  if (err.status === 403 && err.message.includes("not linked")) return "That GitHub installation is not linked to your account. Open Account and link it.";
  if (err.status === undefined) return "The GitHub app is not set up on this Egg, so it cannot read your repository. Ask whoever runs this Egg to configure it.";
  return "GitHub did not give Egg access. Try again in a minute, or install the app again from Account.";
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Looks for the settings that must agree with this Egg. It does not prove the file is the one Egg made. */
export function compareWorkflow(text: string, eggUrl: string, productionBranch: string): CheckResult {
  const label = "Workflow settings";
  let origin: string;
  try {
    origin = new URL(eggUrl).origin;
  } catch {
    origin = eggUrl;
  }
  const hasUrl = new RegExp(`EGG_URL:\\s*["']?${escape(origin)}/?["']?\\s*$`, "m").test(text);
  if (!hasUrl || !text.includes("/api/builds/upload")) {
    return result("workflow_matches", label, "fail", `The workflow does not send builds to ${origin}. Copy the workflow above over it.`);
  }
  const hasBranch = new RegExp(`EGG_PRODUCTION_BRANCH:\\s*["']?${escape(productionBranch)}["']?\\s*$`, "m").test(text);
  if (!hasBranch) {
    return result("workflow_matches", label, "fail", `The workflow does not name ${productionBranch} as the production branch. Copy the workflow above over it.`);
  }
  const missing = Object.values(WORKFLOW_SECRETS).filter((name) => !text.includes(`secrets.${name}`));
  if (missing.length > 0) {
    return result("workflow_matches", label, "fail", `The workflow does not read the ${missing[0]} secret. Copy the workflow above over it.`);
  }
  if (!new RegExp(`^\\s+environment:\\s*["']?${escape(PRODUCTION_ENVIRONMENT)}["']?\\s*$`, "m").test(text)) {
    return result(
      "workflow_matches",
      label,
      "fail",
      `The workflow does not use the ${PRODUCTION_ENVIRONMENT} environment for production builds. Copy the workflow above over it.`
    );
  }
  return result("workflow_matches", label, "pass", `The workflow sends builds to ${origin}, names ${productionBranch} as the production branch, uses the ${PRODUCTION_ENVIRONMENT} environment for production and reads the four secrets.`);
}
