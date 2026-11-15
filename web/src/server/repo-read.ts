import { GithubError, headers, installationToken } from "@/server/github/app";
import { cleanRootDir } from "@/server/root-detect";
import { detectRepo, READ_FILES, type RepoDetection } from "@/server/repo-detect";

/**
 * Read a repository's file tree from GitHub and run detection on it.
 *
 * One call lists every path (git trees API), then only the handful of files in
 * READ_FILES are downloaded. Environment example files are downloaded so their
 * names can be listed; their values are discarded inside detectRepo and never
 * leave this module. Committed .env files are never downloaded.
 */

type FetchLike = typeof fetch;
const API = "https://api.github.com";
const MAX_FILE_BYTES = 200_000;
/** Keep paths up to this deep under the root: enough for packages/*\/package.json. */
const MAX_DEPTH = 3;

export type RepoSource = {
  /** "owner/name" */
  repo: string;
  branch: string;
  installationId: number | null;
  rootDir: string;
};

export type RepoRead = {
  status: "ok" | "missing" | "unavailable";
  message: string | null;
  detection: RepoDetection | null;
};

const unavailable = (message: string): RepoRead => ({ status: "unavailable", message, detection: null });

async function readInner(source: RepoSource, fetchImpl: FetchLike): Promise<RepoRead> {
  const dir = cleanRootDir(source.rootDir);
  if (dir === null) return unavailable("That root directory is not a valid relative path.");
  const prefix = dir ? `${dir}/` : "";

  let token: string | null = null;
  if (source.installationId) {
    try {
      token = await installationToken(source.installationId, fetchImpl);
    } catch (err) {
      if (!(err instanceof GithubError)) throw err;
    }
  }
  const h = (accept?: string) => {
    const base = headers(token ?? "", accept ? { accept } : {});
    if (!token) delete (base as Partial<typeof base>).authorization;
    return base;
  };

  const treeRes = await fetchImpl(
    `${API}/repos/${source.repo}/git/trees/${encodeURIComponent(source.branch)}?recursive=1`,
    { headers: h(), signal: AbortSignal.timeout(10_000) }
  );
  if (treeRes.status === 404 || treeRes.status === 409) {
    return {
      status: "missing",
      message: token
        ? `Could not find the ${source.branch} branch of ${source.repo}.`
        : "Could not read this repository. If it is private, install the GitHub App so it can be read.",
      detection: null,
    };
  }
  if (!treeRes.ok) return unavailable(`GitHub did not answer (${treeRes.status}). Try again later.`);
  const tree = (await treeRes.json()) as {
    tree?: { path?: unknown; type?: unknown }[];
    truncated?: boolean;
  };

  const paths = (tree.tree ?? [])
    .filter((e): e is { path: string; type: string } => typeof e.path === "string" && e.type === "blob")
    .map((e) => e.path)
    .filter((p) => p.startsWith(prefix))
    .map((p) => p.slice(prefix.length))
    .filter((p) => p.split("/").length <= MAX_DEPTH);

  const files: Record<string, string> = {};
  for (const p of paths) files[p] = "";

  const wanted = READ_FILES.filter((f) => f in files);
  const texts = await Promise.all(
    wanted.map(async (f) => {
      const res = await fetchImpl(
        `${API}/repos/${source.repo}/contents/${(prefix + f).split("/").map(encodeURIComponent).join("/")}?ref=${encodeURIComponent(source.branch)}`,
        { headers: h("application/vnd.github.raw+json"), signal: AbortSignal.timeout(8000) }
      );
      if (!res.ok) return [f, ""] as const;
      const text = await res.text();
      return [f, text.length <= MAX_FILE_BYTES ? text : ""] as const;
    })
  );
  for (const [f, text] of texts) files[f] = text;

  const detection = detectRepo(files);
  if (tree.truncated) {
    detection.notes.push("This repository is very large, so some files may not have been looked at.");
  }
  return { status: "ok", message: null, detection };
}

/** Never throws for network problems: a failed lookup is reported as "unavailable". */
export async function readRepo(source: RepoSource, fetchImpl: FetchLike = fetch): Promise<RepoRead> {
  try {
    return await readInner(source, fetchImpl);
  } catch {
    return unavailable("Could not reach GitHub to look. Try again in a moment.");
  }
}
