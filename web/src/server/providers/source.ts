import { existsSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import * as tar from "tar";
import { inspectArchive } from "@/server/builds/archive-check";
import { BuildError, detectFiles, packArchiveWithHash, resolveInside, type BuildRequest, type BuildResult } from "@/server/deploy/build";
import { resolveRuntime } from "@/server/deploy/runtime";

type ArchiveClient = { branchCommit(repo: string, ref: string): Promise<string>; downloadArchive(repo: string, sha: string, destination: string, signal?: AbortSignal): Promise<void> };
export async function buildProviderSource(req: BuildRequest, api: ArchiveClient, repo: string, selection: { sha: string | null; requireBranchMatch: boolean }, workDir: string): Promise<BuildResult> {
  const head = await api.branchCommit(repo, req.source.branch);
  const sha = selection.sha ?? head;
  if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(sha) || (selection.requireBranchMatch && head !== sha.toLowerCase())) throw new BuildError("The requested commit is no longer the branch head.");
  const sourceDir = path.join(workDir, "src");
  try {
    mkdirSync(sourceDir, { recursive: true, mode: 0o700 });
    const incoming = path.join(workDir, "provider.tar.gz");
    await api.downloadArchive(repo, sha, incoming, req.signal);
    if (req.signal?.aborted) throw new BuildError("The build was canceled.");
    await inspectArchive(incoming);
    let root: string | undefined; let invalid = false; let entries = 0;
    await tar.t({ file: incoming, strict: true, onentry(entry) {
      // Git provider archives legitimately contain in-tree symbolic links (and
      // hard links); inspectArchive above is what guards their targets, so they
      // are not re-rejected here. Device, pipe and other special files stay refused.
      const parts = entry.path.split("/").filter(Boolean);
      if (!parts.length || parts.some((p) => p === "." || p === "..") || !["File", "OldFile", "Directory", "SymbolicLink", "Link"].includes(entry.type)) invalid = true;
      if (root === undefined) root = parts[0];
      if (parts[0] !== root) invalid = true;
      entries++;
    } });
    if (invalid || !entries || !root) throw new BuildError("The provider archive contains unsafe entries.");
    await tar.x({ file: incoming, cwd: sourceDir, strip: 1, strict: true, preservePaths: false });
    const appDir = resolveInside(sourceDir, req.rootDir);
    if (!existsSync(appDir)) throw new BuildError("The root directory does not exist in this repository.");
    const files = detectFiles(appDir); const spec = resolveRuntime(req.runtime, files);
    resolveInside(appDir, spec.archiveRoot);
    const archivePath = path.join(workDir, "source.tar.gz");
    const packed = await packArchiveWithHash(appDir, archivePath, spec.excludeNodeModules, "The source", req.log);
    return { archivePath, sha256: packed.sha256, sizeBytes: packed.sizeBytes, commit: { sha, message: "", author: "" }, spec, files, workDir };
  } catch (error) {
    try { rmSync(workDir, { recursive: true, force: true, maxRetries: 5 }); } catch { /* Preserve the original error. */ }
    throw error;
  }
}
