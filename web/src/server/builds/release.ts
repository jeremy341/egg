import type { BuildResult } from "@/server/deploy/build";
import { resolveRuntime, type RuntimeInput } from "@/server/deploy/runtime";
import { ArchiveError, inspectArchive } from "@/server/builds/archive-check";
import { GithubBuildError, discardUpload, waitForUpload } from "@/server/builds/uploads";

/**
 * The GitHub side of a deployment, up to the point where the pipeline holds a checked release file. Nothing
 * from the user's repository is cloned, installed or run on Egg's machine: the deployment waits for the
 * finished release, verifies it again, and reads its headers without unpacking it.
 */

export type GithubRelease = BuildResult & { run: string };

export async function receiveGithubRelease(a: {
  deploymentId: string;
  /** The commit the deployment is for, or null when it takes the next build of its branch. */
  commit: string | null;
  branch: string;
  runtime: RuntimeInput;
  log: { info: (m: string) => void; warn: (m: string) => void };
  signal?: AbortSignal;
  isCanceled?: () => Promise<boolean>;
  wait?: { timeoutMs?: number; pollMs?: number };
}): Promise<GithubRelease> {
  const got = await waitForUpload({
    deploymentId: a.deploymentId,
    commit: a.commit,
    branch: a.branch,
    timeoutMs: a.wait?.timeoutMs,
    pollMs: a.wait?.pollMs,
    signal: a.signal,
    isCanceled: a.isCanceled,
    log: a.log,
  });
  try {
    const info = await inspectArchive(got.archivePath);
    a.log.info(`The release has ${info.entries.toLocaleString("en-US")} entries and passed the path checks.`);
    // The release is already built: no install or build runs. Only the production install may remain.
    const spec = {
      ...resolveRuntime(a.runtime, info.files),
      buildInstall: null,
      buildCommand: null,
      archiveRoot: ".",
      excludeNodeModules: false,
    };
    return {
      archivePath: got.archivePath,
      sha256: got.meta.sha256,
      sizeBytes: got.meta.bytes,
      commit: { sha: got.meta.commit, message: "", author: "" },
      spec,
      files: info.files,
      workDir: "",
      run: got.meta.run,
    };
  } catch (err) {
    discardUpload(a.deploymentId);
    if (err instanceof ArchiveError) throw new GithubBuildError(`The build from GitHub was refused. ${err.message}`);
    throw err;
  }
}
