import { and, desc, eq, inArray, isNotNull, ne } from "drizzle-orm";
import { audit } from "@/server/audit";
import { getDb, schema } from "@/server/db";
import { assertInstallationOwned } from "@/server/github/app";
import { isRepoFullName, repoVisibility, type RepoVisibility } from "@/server/github/visibility";
import { HttpError } from "@/server/http";
import { getProjectForUser } from "@/server/projects";
import { invalidatePublicFeed } from "@/server/public-feed-tags";
import { uiState } from "@/lib/status";
import { PUBLIC_FALLBACK_NAME } from "@/lib/preferences";
import { publicNamesFor } from "@/server/preferences";

/**
 * The deployments feed on the public Egg homepage.
 *
 * What is public, and nothing more: the first line of the commit message, the short commit, the
 * branch, the state, the environment, the time, the repository's public `owner/name`, and the owner's
 * public name (their display name, or "Someone" when they have turned the switch off or have no display
 * name; never their Hack Club name). No project id, server, port, user id, email, environment variable,
 * error text or log ever enters this module's output.
 *
 * A project is listed only when ALL of these hold, checked again every time the feed is built:
 *  - its owner switched `homepageFeed` on (off by default, owner only);
 *  - it was imported through the GitHub App, so Egg can ask GitHub about the repository;
 *  - GitHub says the repository is public right now. A private, internal, renamed, unreachable or
 *    unknown repository is never listed, so making a repository private removes it within the
 *    feed's cache time (60 seconds).
 */

/** How many rows the homepage feed holds. */
export const FEED_SIZE = 8;
/** At most this many opted-in projects are looked at, so a feed build is a bounded number of GitHub calls. */
const MAX_PROJECTS = 20;
const MESSAGE_MAX = 100;
const BRANCH_MAX = 60;
const SHA_LEN = 10;

/** The exact public shape of one feed row. A test pins these keys. */
export type FeedRow = {
  /** First line of the commit message, cleaned and capped. */
  message: string;
  /** The first 10 characters of the commit. */
  sha: string;
  branch: string;
  state: "ready" | "building" | "queued" | "error";
  env: "production" | "preview";
  /** When the deployment was created, ISO 8601. */
  at: string;
  /** `owner/name` of the public GitHub repository. */
  repo: string;
  /** The project owner's public name: their display name, or "Someone". See publicName(). */
  by: string;
};

// Control characters and the invisible bidi marks that can reorder text on a page.
const INVISIBLE = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069\ufeff]/g;

/** One line of plain text, at most `max` characters (the last is an ellipsis when it was cut). */
export function oneLine(value: string, max: number): string {
  const first = value.split(/\r\n|\r|\n/)[0] ?? "";
  const clean = first.replace(INVISIBLE, " ").replace(/\s+/g, " ").trim();
  const chars = Array.from(clean);
  return chars.length > max ? chars.slice(0, max - 1).join("").trimEnd() + "…" : clean;
}

const FULL_SHA = /^[0-9a-f]{7,40}$/i;

type Candidate = {
  message: string | null;
  sha: string | null;
  branch: string;
  state: string;
  env: "production" | "preview";
  at: Date;
};

/** Turn a stored deployment into a public row, or null when it cannot be shown honestly. */
export function toFeedRow(d: Candidate, repo: string, by: string = PUBLIC_FALLBACK_NAME): FeedRow | null {
  if (!d.sha || !FULL_SHA.test(d.sha) || !d.message) return null;
  if (!isRepoFullName(repo)) return null;
  const message = oneLine(d.message, MESSAGE_MAX);
  const branch = oneLine(d.branch, BRANCH_MAX);
  if (!message || !branch) return null;
  const ui = uiState(d.state);
  if (ui === "canceled") return null;
  return {
    message,
    sha: d.sha.toLowerCase().slice(0, SHA_LEN),
    branch,
    state: ui,
    env: d.env,
    at: d.at.toISOString(),
    repo,
    by: oneLine(by, 40) || PUBLIC_FALLBACK_NAME,
  };
}

type Checker = (installationId: number, repoFullName: string) => Promise<RepoVisibility>;

/**
 * The latest deployments of the opted-in projects whose repository GitHub confirms is public.
 * `visibility` is replaceable for tests.
 */
export async function buildPublicFeed(
  options: { limit?: number; visibility?: Checker } = {}
): Promise<FeedRow[]> {
  const limit = options.limit ?? FEED_SIZE;
  const check = options.visibility ?? repoVisibility;
  const db = await getDb();

  const optedIn = await db
    .select({
      id: schema.projects.id,
      repo: schema.projects.repoFullName,
      installationId: schema.projects.installationId,
      userId: schema.projects.userId,
    })
    .from(schema.projects)
    .where(
      and(
        eq(schema.projects.homepageFeed, true),
        isNotNull(schema.projects.repoFullName),
        isNotNull(schema.projects.installationId)
      )
    )
    .orderBy(desc(schema.projects.updatedAt), schema.projects.id)
    .limit(MAX_PROJECTS);

  // One question to GitHub per repository, however many projects point at it.
  const answers = new Map<string, Promise<RepoVisibility>>();
  const publicRepoOf = new Map<string, string>();
  await Promise.all(
    optedIn.map(async (p) => {
      if (!p.repo || p.installationId === null || !isRepoFullName(p.repo)) return;
      const key = `${p.installationId}:${p.repo.toLowerCase()}`;
      let answer = answers.get(key);
      if (!answer) {
        answer = check(p.installationId, p.repo).catch((): RepoVisibility => "unknown");
        answers.set(key, answer);
      }
      if ((await answer) === "public") publicRepoOf.set(p.id, p.repo);
    })
  );
  if (publicRepoOf.size === 0) return [];

  // Each project's owner's public name, read once for all of them.
  const ownerOf = new Map(optedIn.map((p) => [p.id, p.userId] as const));
  const names = await publicNamesFor([...publicRepoOf.keys()].map((id) => ownerOf.get(id) ?? ""));

  const rows = await db
    .select({
      projectId: schema.deployments.projectId,
      message: schema.deployments.commitMessage,
      sha: schema.deployments.commitSha,
      branch: schema.deployments.branch,
      state: schema.deployments.state,
      env: schema.deployments.env,
      at: schema.deployments.createdAt,
    })
    .from(schema.deployments)
    .where(
      and(
        inArray(schema.deployments.projectId, [...publicRepoOf.keys()]),
        isNotNull(schema.deployments.commitSha),
        isNotNull(schema.deployments.commitMessage),
        ne(schema.deployments.state, "canceled")
      )
    )
    .orderBy(desc(schema.deployments.createdAt), desc(schema.deployments.id))
    // Some rows are dropped by toFeedRow (an empty message), so read a few more than are shown.
    .limit(limit * 3);

  const out: FeedRow[] = [];
  for (const r of rows) {
    const repo = publicRepoOf.get(r.projectId);
    const owner = ownerOf.get(r.projectId) ?? "";
    const row = repo ? toFeedRow(r, repo, names.get(owner) ?? PUBLIC_FALLBACK_NAME) : null;
    if (row) out.push(row);
    if (out.length >= limit) break;
  }
  return out;
}

/** Say why a repository cannot be listed, in words the owner can act on. */
function refusal(repo: string, v: RepoVisibility): HttpError {
  if (v === "private") {
    return new HttpError(409, `${repo} is private. Only public repositories can be shown on the homepage.`, "repo_not_public");
  }
  return new HttpError(
    409,
    `Egg could not confirm that ${repo} is public on GitHub, so it was not switched on. Try again in a moment.`,
    "repo_visibility_unknown"
  );
}

/**
 * Switch the homepage listing on or off. Owner only (anyone else, a collaborator included, gets the
 * same "not found" as for any project they do not own). Switching on needs a GitHub App
 * repository that GitHub confirms is public right now; switching off always works.
 */
export async function setHomepageFeed(
  userId: string,
  projectId: string,
  enabled: boolean,
  options: { visibility?: Checker } = {}
): Promise<{ enabled: boolean }> {
  const project = await getProjectForUser(userId, projectId);
  const db = await getDb();

  if (enabled) {
    if (!project.repoFullName || project.installationId === null || !isRepoFullName(project.repoFullName)) {
      throw new HttpError(
        409,
        "Only a project imported through the GitHub App can be shown on the homepage, because Egg has to confirm with GitHub that the repository is public.",
        "repo_not_checkable"
      );
    }
    try {
      await assertInstallationOwned(userId, project.installationId);
    } catch {
      throw new HttpError(403, "That GitHub installation is not linked to your account.", "forbidden");
    }
    const v = await (options.visibility ?? repoVisibility)(project.installationId, project.repoFullName).catch(
      (): RepoVisibility => "unknown"
    );
    if (v !== "public") throw refusal(project.repoFullName, v);
  }

  await db
    .update(schema.projects)
    .set({ homepageFeed: enabled, updatedAt: new Date() })
    .where(and(eq(schema.projects.id, project.id), eq(schema.projects.userId, userId)));
  await audit(userId, enabled ? "homepage_feed.enable" : "homepage_feed.disable", project.id);
  // Take the project off (or put it on) now, not after the minute the feed may be kept.
  await invalidatePublicFeed();
  return { enabled };
}
