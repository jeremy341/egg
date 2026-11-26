import { GithubError, headers, installationToken } from "@/server/github/app";
import { commitUrl } from "@/lib/github";

type FetchLike = typeof fetch;

export type RepoVisibility = "public" | "private" | "unknown";

/** The longest GitHub gets to answer. A slow answer counts as unknown. */
const TIMEOUT_MS = 5000;

/** True when `value` is an `owner/name` that is safe to put in a GitHub URL. */
export function isRepoFullName(value: string | null | undefined): value is string {
  return commitUrl(value, "0000000") !== null;
}

/**
 * Whether a repository is public, asked of GitHub with the App's installation token. The answer is
 * "public" only when GitHub says so plainly: the repository exists under the same name, is not
 * private, and is not "internal". Anything else, including a network error, a timeout, a missing
 * installation, a renamed repository or a malformed answer, is "unknown", and callers must treat
 * "unknown" like "private".
 */
export async function repoVisibility(
  installationId: number,
  repoFullName: string,
  fetchImpl: FetchLike = fetch
): Promise<RepoVisibility> {
  if (!isRepoFullName(repoFullName)) return "unknown";
  try {
    const token = await installationToken(installationId, fetchImpl);
    const res = await fetchImpl(`https://api.github.com/repos/${repoFullName}`, {
      headers: headers(token),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return "unknown";
    const body = (await res.json()) as {
      full_name?: unknown;
      private?: unknown;
      visibility?: unknown;
    };
    // A renamed or moved repository answers under its new name: the stored name is stale, so do not trust it.
    if (typeof body.full_name !== "string" || body.full_name.toLowerCase() !== repoFullName.toLowerCase()) {
      return "unknown";
    }
    if (body.private === true || body.visibility === "private" || body.visibility === "internal") return "private";
    if (body.private === false && (body.visibility === undefined || body.visibility === "public")) return "public";
    return "unknown";
  } catch (err) {
    if (!(err instanceof GithubError)) console.warn("repository visibility check failed", err instanceof Error ? err.name : err);
    return "unknown";
  }
}
