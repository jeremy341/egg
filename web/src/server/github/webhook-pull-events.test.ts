import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { handleGithubEvent } from "@/server/github/webhook";
import { upsertUser } from "@/server/auth/session";
import { schema } from "@/server/db";
import { createProject } from "@/server/projects";
import { createServer } from "@/server/servers";
import { useFreshDb } from "@/server/test/db";
import { attachPullRequest, closePullRequestPreviews } from "@/server/github/pulls";

vi.mock("@/server/github/pulls", () => ({
  attachPullRequest: vi.fn(async () => undefined),
  closePullRequestPreviews: vi.fn(async () => ({ canceled: 0, removed: 0 })),
}));

let ctx: Awaited<ReturnType<typeof useFreshDb>>;
let project: Awaited<ReturnType<typeof createProject>>;
let other: Awaited<ReturnType<typeof createProject>>;

const sha = "c".repeat(40);

function pull(action: string, overrides: Record<string, unknown> = {}) {
  return {
    action,
    installation: { id: 777 },
    repository: { full_name: "sample/app" },
    pull_request: {
      number: 7,
      draft: false,
      updated_at: "2026-11-20T10:00:00Z",
      head: { ref: "feature", sha, repo: { full_name: "sample/app" } },
      ...overrides,
    },
  };
}

async function rows(projectId: string) {
  return ctx.db.select().from(schema.pullRequestEvents).where(eq(schema.pullRequestEvents.projectId, projectId));
}

beforeAll(async () => {
  ctx = await useFreshDb();
  const owner = await upsertUser({ id: "pr-events-owner", name: "Owner", email: null, slackId: null });
  const server = await createServer(owner.id, "pr-events-owner");
  const base = { serverId: server.id, repoUrl: "https://github.com/sample/app.git", runtime: "node" as const, port: 3000 };
  project = await createProject(owner.id, { ...base, name: "PR events", slug: "pr-events" });
  other = await createProject(owner.id, { ...base, port: 3001, name: "Other", slug: "pr-other" });
  await ctx.db.update(schema.projects).set({ repoFullName: "sample/app", installationId: 777, autoDeploy: true }).where(eq(schema.projects.id, project.id));
  await ctx.db.update(schema.projects).set({ repoFullName: "sample/app", installationId: 888, autoDeploy: true }).where(eq(schema.projects.id, other.id));
  await ctx.db.insert(schema.githubInstallations).values({ id: 777, userId: owner.id, accountLogin: "sample", accountType: "User", createdAt: new Date() });
});

beforeEach(() => {
  vi.clearAllMocks();
});

afterAll(async () => {
  await ctx.cleanup();
});

describe("pull request events are recorded", () => {
  it("records an opened pull request and still starts its preview", async () => {
    const result = await handleGithubEvent("pull_request", pull("opened"));
    expect(result).toMatchObject({ handled: true });
    expect(result.deployments).toHaveLength(1);
    const recorded = await rows(project.id);
    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toMatchObject({ action: "opened", number: 7, projectId: project.id });
    expect(attachPullRequest).toHaveBeenCalledWith(project.id, "feature", sha, 7);
  });

  it("does not record the same event twice when it is retried", async () => {
    await handleGithubEvent("pull_request", pull("opened"));
    await handleGithubEvent("pull_request", pull("opened"));
    expect(await rows(project.id)).toHaveLength(1);
  });

  it("records a later update of the same pull request as its own event", async () => {
    await handleGithubEvent("pull_request", pull("synchronize", { updated_at: "2026-11-21T09:00:00Z" }));
    const actions = (await rows(project.id)).map((r) => r.action).sort();
    expect(actions).toEqual(["opened", "synchronize"]);
  });

  it("records a closed pull request and keeps the preview cleanup", async () => {
    const result = await handleGithubEvent("pull_request", pull("closed", { updated_at: "2026-11-22T09:00:00Z" }));
    expect(result.note).toBe("pull request closed");
    expect((await rows(project.id)).map((r) => r.action)).toContain("closed");
    expect(closePullRequestPreviews).toHaveBeenCalledWith(project.id, 7);
  });

  it("records a fork pull request without building it", async () => {
    const result = await handleGithubEvent("pull_request", pull("opened", {
      number: 9,
      updated_at: "2026-11-23T09:00:00Z",
      head: { ref: "fork-branch", sha: "d".repeat(40), repo: { full_name: "someone/app" } },
    }));
    expect(result.deployments).toHaveLength(0);
    expect(result.note).toBe("pull request from a fork is not built");
    expect((await rows(project.id)).some((r) => r.number === 9 && r.action === "opened")).toBe(true);
  });

  it("does not record events for an installation the project's owner did not link", async () => {
    await handleGithubEvent("pull_request", pull("opened", { number: 11, updated_at: "2026-11-23T10:00:00Z" }));
    const untrusted = await handleGithubEvent("pull_request", {
      ...pull("opened", { number: 12, updated_at: "2026-11-23T11:00:00Z" }),
      installation: { id: 999 },
    });
    expect(untrusted.handled).toBe(true);
    expect(await rows(project.id)).not.toContainEqual(expect.objectContaining({ number: 12 }));
    expect(await rows(other.id)).toHaveLength(0);
  });
});
