import { and, desc, eq, inArray } from "drizzle-orm";
import { audit } from "@/server/audit";
import { getDb, schema } from "@/server/db";
import { assertGitRef, assertGitSha } from "@/server/deploy/build";
import { installationToken, headers } from "@/server/github/app";
import { HttpError, notFound } from "@/server/http";
import { enqueueDeployment, getProjectForUser } from "@/server/projects";
import { rateLimiter } from "@/server/rate-limit";

type Fetch = typeof fetch;
export async function inspectRepositoryDrift(userId: string, projectId: string, fetcher: Fetch = fetch) {
  const project = await getProjectForUser(userId, projectId);
  if (project.userId !== userId) throw notFound("Project not found");
  const rate = rateLimiter().check(`repository-reconcile:${userId}`, 20, 60_000);
  if (!rate.allowed) throw new HttpError(429, "Too many repository checks. Try again shortly.", "rate_limited", { "Retry-After": String(rate.retryAfterSeconds) });
  if (!project.repoFullName || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(project.repoFullName)) {
    throw new HttpError(409, "Link this project's GitHub repository before checking for missed pushes.", "repository_required");
  }
  const branch = assertGitRef(project.productionBranch);
  const token = project.installationId ? await installationToken(project.installationId) : null;
  const res = await fetcher(`https://api.github.com/repos/${project.repoFullName}/commits/${encodeURIComponent(branch)}`, {
    headers: token ? headers(token) : { accept: "application/vnd.github+json", "user-agent": "egg" },
    signal: AbortSignal.timeout(10_000), cache: "no-store", redirect: "error",
  });
  if (!res.ok) throw new HttpError(502, `GitHub could not verify the branch (${res.status}). Reconnect repository access if needed.`, "upstream");
  const data = await res.json() as { sha?: unknown };
  if (typeof data.sha !== "string") throw new HttpError(502, "GitHub returned an invalid commit.", "upstream");
  const headSha = assertGitSha(data.sha);
  const db = await getDb();
  const current = await db.select({ sha: schema.deployments.commitSha }).from(schema.deployments)
    .where(and(eq(schema.deployments.projectId, projectId), eq(schema.deployments.env, "production"), eq(schema.deployments.isCurrent, true)))
    .orderBy(desc(schema.deployments.createdAt)).limit(1).get();
  return { projectId, branch, headSha, deployedSha: current?.sha ?? null, needsDeployment: current?.sha !== headSha };
}

/** Explicitly recover a missed push; never silently switch to a newer head. */
export async function reconcileRepository(userId: string, projectId: string, expectedSha: string, fetcher: Fetch = fetch) {
  assertGitSha(expectedSha);
  const drift = await inspectRepositoryDrift(userId, projectId, fetcher);
  if (drift.headSha !== expectedSha) throw new HttpError(409, "The branch changed. Review its new commit before deploying.", "head_changed");
  if (!drift.needsDeployment) return { deploymentId: null, alreadyCurrent: true };
  const db = await getDb();
  const existing = () => db.select({ id: schema.deployments.id }).from(schema.deployments).where(and(
    eq(schema.deployments.projectId, projectId), eq(schema.deployments.branch, drift.branch), eq(schema.deployments.commitSha, expectedSha),
    inArray(schema.deployments.state, ["queued", "building", "deploying"]))).limit(1).get();
  const active = await existing();
  if (active) return { deploymentId: active.id, alreadyCurrent: false };
  const project = await getProjectForUser(userId, projectId);
  let deploymentId: string;
  try {
    // Recover the missing webhook through its unique project/branch/commit guard.
    deploymentId = (await enqueueDeployment(project, { env: "production", source: "webhook", branch: drift.branch,
      commitSha: expectedSha, triggeredBy: userId })).id;
  } catch (err) {
    if (!(err instanceof Error) || !/UNIQUE constraint failed/.test(err.message)) throw err;
    const concurrent = await existing();
    if (!concurrent) throw err;
    deploymentId = concurrent.id;
  }
  await audit(userId, "deploy.reconcile", projectId, { commit: expectedSha, deploymentId });
  return { deploymentId, alreadyCurrent: false };
}
