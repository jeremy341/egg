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
  const branch = [branchParts[0], ...branchParts.slice(1)].join("/");
  if (!validBranch(branch)) return null;
  return { repoFullName: `${owner}/${repo}`, branch };
}
