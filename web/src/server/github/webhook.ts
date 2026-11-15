import { and, eq, inArray, sql } from "drizzle-orm";
import { getDb, schema } from "@/server/db";
import { isUniqueViolation } from "@/server/db/errors";
import { assertGitRef, assertGitSha } from "@/server/deploy/build";
import { attachPullRequest, closePullRequestPreviews } from "@/server/github/pulls";
import { enqueueDeployment } from "@/server/projects";
import { maintenanceError, maintenanceState } from "@/server/maintenance";

export type WebhookResult = {
  handled: boolean;
  deployments: string[];
  note?: string;
};

type PushPayload = {
  ref?: string;
  after?: string;
  deleted?: boolean;
  repository?: { full_name?: string };
  head_commit?: { message?: string; author?: { name?: string; username?: string } } | null;
  pusher?: { name?: string };
  installation?: { id?: number };
};

const ZERO_SHA = /^0+$/;

/** Repository names are case-insensitive on GitHub; the project may store them as typed. */
const sameRepo = (fullName: string) =>
  sql`lower(${schema.projects.repoFullName}) = ${fullName.toLowerCase()}`;

/**
 * Whether an event's installation may act on a project. A project tied to an
 * installation accepts only that one. A project without one (a public repository
 * imported by URL) accepts only an installation its owner linked. An event with
 * no installation id is left to the signature check, as before.
 */
async function installationTrusted(
  db: Awaited<ReturnType<typeof getDb>>,
  project: { userId: string; installationId: number | null },
  eventInstallationId: number | undefined
): Promise<boolean> {
  if (!eventInstallationId) return true;
  if (project.installationId) return project.installationId === eventInstallationId;
  const linked = await db
    .select({ id: schema.githubInstallations.id })
    .from(schema.githubInstallations)
    .where(
      and(
        eq(schema.githubInstallations.id, eventInstallationId),
        eq(schema.githubInstallations.userId, project.userId)
      )
    )
    .get();
  return !!linked;
}

/** A branch name that cannot be read by git as an option or as revision syntax (the rule the builder applies). */
export function isSafeBranch(name: unknown): name is string {
  try {
    assertGitRef(name as string);
    return true;
  } catch {
    return false;
  }
}

/** A full commit hash. */
export function isSafeSha(sha: unknown): sha is string {
  try {
    assertGitSha(sha as string);
    return true;
  } catch {
    return false;
  }
}

/**
 * Remember the digest of the authenticated request body in the database.
 * GitHub's delivery header is not covered by the HMAC and cannot be trusted as
 * the idempotency key. The digest survives process restarts and multiple app
 * instances. Only the one-way digest is retained; keeping it indefinitely
 * prevents a captured signed body from becoming valid again after a timeout.
 */
export async function claimDelivery(eventHash: string, now = new Date()): Promise<boolean> {
  const db = await getDb();
  const inserted = await db
    .insert(schema.githubWebhookEvents)
    .values({ eventHash, receivedAt: now })
    .onConflictDoNothing()
    .returning({ eventHash: schema.githubWebhookEvents.eventHash });
  return inserted.length === 1;
}

/** Forget a failed request so GitHub can retry the exact signed body. */
export async function releaseDelivery(eventHash: string) {
  const db = await getDb();
  await db.delete(schema.githubWebhookEvents).where(eq(schema.githubWebhookEvents.eventHash, eventHash));
}

/**
 * GitHub signs the body, not X-GitHub-Event. Require an event-specific payload
 * shape before claiming a digest, so an unrelated/invalid header cannot burn
 * the idempotency key for a later correctly labeled delivery.
 */
export function matchesWebhookEventShape(event: string, payload: unknown): boolean {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return false;
  const p = payload as Record<string, unknown>;
  const repo = p.repository && typeof p.repository === "object" ? (p.repository as Record<string, unknown>) : null;
  const fullName = typeof repo?.full_name === "string" && repo.full_name.includes("/");
  const installation = p.installation && typeof p.installation === "object" ? (p.installation as Record<string, unknown>) : null;
  const pull = p.pull_request && typeof p.pull_request === "object" ? (p.pull_request as Record<string, unknown>) : null;
  const changes = p.changes && typeof p.changes === "object" ? (p.changes as Record<string, unknown>) : null;
  const changedRepo = changes?.repository && typeof changes.repository === "object"
    ? (changes.repository as Record<string, unknown>)
    : null;

  switch (event) {
    case "ping":
      // Ping payloads vary by webhook type; reject clear signatures of other events.
      return !("ref" in p || "after" in p || "pull_request" in p || "installation" in p || "changes" in p);
    case "push":
      return fullName && typeof p.ref === "string" && p.ref.startsWith("refs/") &&
        typeof p.after === "string" && /^[0-9a-f]{40}$/i.test(p.after);
    case "installation":
      // Deletion is the only installation action this app mutates state for.
      return p.action === "deleted" && Number.isSafeInteger(installation?.id) && Number(installation?.id) > 0;
    case "pull_request": {
      const head = pull?.head && typeof pull.head === "object" ? (pull.head as Record<string, unknown>) : null;
      return fullName && ["opened", "reopened", "synchronize", "ready_for_review", "closed"].includes(String(p.action)) &&
        Number.isSafeInteger(pull?.number) &&
        Number(pull?.number) > 0 && typeof head?.ref === "string" && typeof head.sha === "string" &&
        /^[0-9a-f]{40}$/i.test(head.sha);
    }
    case "repository":
      return fullName && p.action === "renamed" && typeof changedRepo?.name === "object" &&
        !!changedRepo.name && typeof (changedRepo.name as Record<string, unknown>).from === "string";
    default:
      return false;
  }
}

/**
 * Turn a GitHub event into deployments. Pushes to a project's production
 * branch deploy to production; pushes to other branches build a preview.
 */
export async function handleGithubEvent(
  event: string,
  payload: unknown
): Promise<WebhookResult> {
  // The route checks before claiming replay state; check again here so a
  // window starting between those steps cannot start event side effects.
  if ((await maintenanceState()).active) throw maintenanceError();
  if (event === "ping") return { handled: true, deployments: [], note: "pong" };
  if (event === "installation") return handleInstallation(payload);
  if (event === "pull_request") return handlePullRequest(payload);
  if (event === "repository") return handleRepository(payload);
  if (event !== "push") return { handled: false, deployments: [], note: `ignored ${event}` };

  const p = payload as PushPayload;
  const fullName = p.repository?.full_name;
  if (!fullName || !p.ref?.startsWith("refs/heads/")) {
    return { handled: false, deployments: [], note: "not a branch push" };
  }
  const branch = p.ref.slice("refs/heads/".length);
  if (p.deleted || !p.after || ZERO_SHA.test(p.after)) {
    return { handled: false, deployments: [], note: "branch deleted" };
  }
  if (!isSafeBranch(branch) || !isSafeSha(p.after)) {
    return { handled: false, deployments: [], note: "unsupported branch name" };
  }

  const db = await getDb();
  const projects = await db
    .select()
    .from(schema.projects)
    .where(and(sameRepo(fullName), eq(schema.projects.autoDeploy, true)));

  const created: string[] = [];
  for (const project of projects) {
    // Only trust events for installations the project's owner can use.
    if (!(await installationTrusted(db, project, p.installation?.id))) continue;

    // A push that is already queued or running for this commit is a retry.
    const dup = await db
      .select({ id: schema.deployments.id })
      .from(schema.deployments)
      .where(
        and(
          eq(schema.deployments.projectId, project.id),
          eq(schema.deployments.branch, branch),
          eq(schema.deployments.commitSha, p.after),
          inArray(schema.deployments.state, ["queued", "building", "deploying"])
        )
      )
      .get();
    if (dup) continue;

    try {
      const dep = await enqueueDeployment(project, {
        env: branch === project.productionBranch ? "production" : "preview",
        source: "webhook",
        branch,
        commitSha: p.after,
        commitMessage: p.head_commit?.message?.split("\n")[0]?.slice(0, 300) ?? null,
        author: p.head_commit?.author?.username ?? p.head_commit?.author?.name ?? p.pusher?.name ?? null,
      });
      created.push(dep.id);
    } catch (err) {
      // The unique index caught a racing duplicate of the same commit.
      if (!isUniqueViolation(err)) throw err;
    }
  }
  return { handled: true, deployments: created };
}

type PullPayload = {
  action?: string;
  repository?: { full_name?: string };
  installation?: { id?: number };
  pull_request?: {
    number?: number;
    draft?: boolean;
    head?: { ref?: string; sha?: string; repo?: { full_name?: string } | null };
  };
};

const BUILD_ACTIONS = new Set(["opened", "reopened", "synchronize", "ready_for_review"]);

/**
 * A pull request opened, updated or closed. Same-repository pull requests get a
 * preview (usually the push already started it, so this only links the two);
 * closing one cleans up after it. Forks are never built.
 */
async function handlePullRequest(payload: unknown): Promise<WebhookResult> {
  const p = payload as PullPayload;
  const fullName = p.repository?.full_name;
  const pr = p.pull_request;
  const number = pr?.number;
  const branch = pr?.head?.ref;
  const sha = pr?.head?.sha;
  if (!fullName || !pr || !number || !branch || !sha) {
    return { handled: false, deployments: [], note: "incomplete pull request event" };
  }
  if (!isSafeBranch(branch) || !isSafeSha(sha)) {
    return { handled: false, deployments: [], note: "unsupported branch name" };
  }
  const action = p.action ?? "";
  if (action !== "closed" && !BUILD_ACTIONS.has(action)) {
    return { handled: false, deployments: [], note: `ignored pull_request ${action}` };
  }

  const db = await getDb();
  const projects = await db
    .select()
    .from(schema.projects)
    .where(sameRepo(fullName));
  const trusted: typeof projects = [];
  for (const x of projects) {
    if (await installationTrusted(db, x, p.installation?.id)) trusted.push(x);
  }

  if (action === "closed") {
    // Not awaited: it talks to the user's server, and GitHub wants a quick answer.
    for (const project of trusted) void closePullRequestPreviews(project.id, number);
    return { handled: true, deployments: [], note: "pull request closed" };
  }

  if (pr.head?.repo?.full_name !== fullName) {
    return { handled: false, deployments: [], note: "pull request from a fork is not built" };
  }
  if (pr.draft) return { handled: false, deployments: [], note: "draft pull request" };

  const created: string[] = [];
  for (const project of trusted) {
    if (!project.autoDeploy || branch === project.productionBranch) continue;
    const existing = await attachPullRequest(project.id, branch, sha, number);
    if (existing) continue;
    try {
      const dep = await enqueueDeployment(project, {
        env: "preview",
        source: "webhook",
        branch,
        commitSha: sha,
        prNumber: number,
      });
      created.push(dep.id);
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
    }
  }
  return { handled: true, deployments: created };
}

/**
 * A repository renamed on GitHub: pushes now arrive under the new name, so the
 * stored name (and the clone URL built from it) follows. Only projects that were
 * under the old name and that the event's installation may act on are changed.
 */
async function handleRepository(payload: unknown): Promise<WebhookResult> {
  const p = payload as {
    action?: string;
    changes?: { repository?: { name?: { from?: string } } };
    repository?: { full_name?: string };
    installation?: { id?: number };
  };
  const newName = p.repository?.full_name;
  const oldRepo = p.changes?.repository?.name?.from;
  if (p.action !== "renamed" || !newName || !oldRepo || !newName.includes("/")) {
    return { handled: false, deployments: [], note: `ignored repository ${p.action}` };
  }
  const owner = newName.split("/")[0];
  const oldName = `${owner}/${oldRepo}`;

  const db = await getDb();
  const projects = await db.select().from(schema.projects).where(sameRepo(oldName));
  let renamed = 0;
  for (const project of projects) {
    if (!(await installationTrusted(db, project, p.installation?.id))) continue;
    // Keep the clone URL pointing at the same host, with the new path.
    let repoUrl = project.repoUrl;
    try {
      const url = new URL(project.repoUrl);
      url.pathname = `/${newName}${/\.git$/i.test(url.pathname) ? ".git" : ""}`;
      repoUrl = url.toString();
    } catch {
      // Leave an unparseable URL as it was.
    }
    await db
      .update(schema.projects)
      .set({ repoFullName: newName, repoUrl })
      .where(eq(schema.projects.id, project.id));
    renamed++;
  }
  return { handled: true, deployments: [], note: `renamed ${renamed} project(s)` };
}

async function handleInstallation(payload: unknown): Promise<WebhookResult> {
  const p = payload as { action?: string; installation?: { id?: number } };
  if (p.action === "deleted" && p.installation?.id) {
    const db = await getDb();
    await db
      .delete(schema.githubInstallations)
      .where(eq(schema.githubInstallations.id, p.installation.id));
    // Projects keep their record but lose private-repo access until relinked.
    await db
      .update(schema.projects)
      .set({ installationId: null })
      .where(eq(schema.projects.installationId, p.installation.id));
    return { handled: true, deployments: [], note: "installation removed" };
  }
  return { handled: false, deployments: [], note: `ignored installation ${p.action}` };
}
