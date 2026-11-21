import { detectRepo, READ_FILES } from "@/server/repo-detect";
import type { RepoRead } from "@/server/repo-read";
import { cleanRootDir } from "@/server/root-detect";

type Reader = { readTree(repo: string, branch: string): Promise<{ paths: string[]; truncated: boolean }>; readFile(repo: string, branch: string, path: string): Promise<string> };
export async function detectProviderRepository(api: Reader, source: { repo: string; branch: string; root: string }): Promise<RepoRead> {
  const dir = cleanRootDir(source.root);
  if (dir === null) return { status: "unavailable", message: "That root directory is not a valid relative path.", detection: null };
  try {
    const tree = await api.readTree(source.repo, source.branch);
    const prefix = dir ? `${dir}/` : "";
    const paths = tree.paths.filter((p) => p.startsWith(prefix)).map((p) => p.slice(prefix.length)).filter((p) => p.split("/").length <= 3);
    const files: Record<string, string> = Object.create(null);
    for (const path of paths) files[path] = "";
    await Promise.all(READ_FILES.filter((name) => Object.hasOwn(files, name)).map(async (name) => { files[name] = await api.readFile(source.repo, source.branch, prefix + name); }));
    const detection = detectRepo(files);
    if (tree.truncated) detection.notes.push("This repository is very large, so some files may not have been looked at.");
    return { status: "ok", message: null, detection };
  } catch { return { status: "unavailable", message: "Could not read this repository. Check the connection and repository access.", detection: null }; }
}
