import { generateKeyPairSync } from "node:crypto";
import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { upsertUser } from "@/server/auth/session";
import { resetConfigForTests } from "@/server/config";
import { schema } from "@/server/db";
import { clearTokenCacheForTests } from "@/server/github/app";
import { HttpError } from "@/server/http";
import { createProject, type ProjectRow } from "@/server/projects";
import { RATE_LIMITS, rateLimiter } from "@/server/rate-limit";
import { createServer } from "@/server/servers";
import { useFreshDb } from "@/server/test/db";
import { WORKFLOW_PATH, buildWorkflow } from "@/server/builds/workflow";
import { WORKFLOW_BRANCH, publishWorkflow } from "@/server/builds/workflow-publish";

// The route layer, the database and the publish are real. Only sign-in and GitHub are replaced.
vi.mock("@/server/auth/current", () => ({ getCurrentUser: vi.fn(), requireUser: vi.fn() }));
import { getCurrentUser } from "@/server/auth/current";
import { POST as publishRoute } from "@/app/api/projects/[id]/github-workflow/publish/route";

const EGG_URL = "http://localhost:3000";
const INSTALLATION = 4242;
const TOKEN = "ghs_INSTALLATIONTOKEN";
const BASE_SHA = "basecommitsha";
const PR_URL = "https://github.com/sam/app/pull/7";
const SENTINEL = "SECRET_BODY_SENTINEL";

let ctx: Awaited<ReturnType<typeof useFreshDb>>;
let user: Awaited<ReturnType<typeof upsertUser>>;
let stranger: Awaited<ReturnType<typeof upsertUser>>;
let serverId: string;
let port = 5300;

async function makeProject(extra: Record<string, unknown> = {}): Promise<ProjectRow> {
  return createProject(user.id, {
    serverId,
    name: `P${port}`,
    repoUrl: "https://github.com/sam/app",
    repoFullName: "sam/app",
    installationId: INSTALLATION,
    runtime: "node",
    port: port++,
    buildLocation: "container",
    ...extra,
  });
}

const expectedFor = (p: ProjectRow) =>
  buildWorkflow({
    eggUrl: EGG_URL,
    productionBranch: p.productionBranch,
    runtime: p.runtime,
    installCommand: p.installCommand,
    buildCommand: p.buildCommand,
    outputDir: p.outputDir,
    rootDir: p.rootDir,
  });

/** GitHub wraps base64 content with newlines, so the fake does too. */
const b64 = (text: string) => Buffer.from(text).toString("base64").replace(/(.{60})/g, "$1\n");

type Call = {
  method: string;
  path: string;
  search: string;
  body: Record<string, unknown> | undefined;
  signal: unknown;
  auth: string;
};

type World = {
  /** Commit the base branch points at. A number is an HTTP status for the ref read. */
  baseRef?: number | { status: number; message: string; documentation_url?: string };
  /** The workflow file on the base branch, decoded. null means absent. */
  baseFile?: string | null;
  /** The working branch exists. */
  branchExists?: boolean;
  /** The workflow file on the working branch, decoded. null means absent. */
  branchFile?: string | null;
  /** Open pull requests that match the working branch. */
  pulls?: { html_url: string }[];
  /** The POST to git/refs reports "already exists", and the branch appears (a race with another run). */
  refRace?: boolean;
  /** The POST to pulls reports "already exists", and the pull request appears (a race). */
  pullRace?: boolean;
  /** Replace any request. Return undefined to let the default answer it. */
  override?: (c: Call) => Response | undefined | "throw";
};

const json = (body: unknown, status = 200) => Response.json(body, { status });

/**
 * A GitHub that answers only the requests the publish is allowed to make. Anything else fails the test: it is
 * recorded in `unexpected` and thrown.
 */
function github(world: World = {}) {
  const state = {
    branchExists: world.branchExists ?? false,
    branchFile: world.branchFile ?? null,
    pulls: [...(world.pulls ?? [])],
  };
  const calls: Call[] = [];
  const unexpected: string[] = [];
  const fake = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined;
    const call: Call = {
      method,
      path: url.pathname,
      search: url.search,
      body,
      signal: init?.signal,
      auth: (init?.headers as Record<string, string> | undefined)?.authorization ?? "",
    };
    calls.push(call);
    const forced = world.override?.(call);
    if (forced === "throw") throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
    if (forced) return forced;

    const p = url.pathname;
    if (p === `/app/installations/${INSTALLATION}/access_tokens` && method === "POST") {
      return json({ token: TOKEN, expires_at: new Date(Date.now() + 3600_000).toISOString() }, 201);
    }
    if (p === "/repos/sam/app/git/ref/heads/main" && method === "GET") {
      const r = world.baseRef;
      if (typeof r === "object") return json({ message: r.message, documentation_url: r.documentation_url }, r.status);
      if (typeof r === "number") return json({ message: "Not Found" }, r);
      return json({ ref: "refs/heads/main", object: { sha: BASE_SHA, type: "commit" } });
    }
    if (p === `/repos/sam/app/git/ref/heads/${WORKFLOW_BRANCH}` && method === "GET") {
      return state.branchExists
        ? json({ ref: `refs/heads/${WORKFLOW_BRANCH}`, object: { sha: "branchsha", type: "commit" } })
        : json({ message: "Not Found" }, 404);
    }
    if (p === `/repos/sam/app/git/refs/heads/${WORKFLOW_BRANCH}` && method === "PATCH") {
      // A reset to the base commit: the branch now holds whatever the base holds.
      state.branchFile = world.baseFile ?? null;
      return json({ ref: `refs/heads/${WORKFLOW_BRANCH}`, object: { sha: body?.sha } });
    }
    if (p === "/repos/sam/app/git/refs" && method === "POST") {
      if (world.refRace) {
        state.branchExists = true;
        return json({ message: "Reference already exists" }, 422);
      }
      state.branchExists = true;
      return json({ ref: body?.ref }, 201);
    }
    if (p === `/repos/sam/app/contents/${WORKFLOW_PATH}`) {
      if (method === "GET" && url.searchParams.get("ref") === "main") {
        if (world.baseFile == null) return json({ message: "Not Found" }, 404);
        return json({ type: "file", sha: "sha-base", encoding: "base64", content: b64(world.baseFile) });
      }
      if (method === "GET" && url.searchParams.get("ref") === WORKFLOW_BRANCH) {
        if (state.branchFile == null) return json({ message: "Not Found" }, 404);
        return json({ type: "file", sha: "sha-branch", encoding: "base64", content: b64(state.branchFile) });
      }
      if (method === "PUT") {
        state.branchFile = Buffer.from(String(body?.content), "base64").toString("utf8");
        return json({ content: { sha: "sha-new" } }, 201);
      }
    }
    if (p === "/repos/sam/app/pulls" && method === "GET") {
      return json(state.pulls);
    }
    if (p === "/repos/sam/app/pulls" && method === "POST") {
      if (world.pullRace) {
        state.pulls.push({ html_url: PR_URL });
        return json({ message: `A pull request already exists for sam:${WORKFLOW_BRANCH}.` }, 422);
      }
      state.pulls.push({ html_url: PR_URL });
      return json({ html_url: PR_URL }, 201);
    }
    const msg = `The publish made a request it should not make: ${method} ${url.pathname}${url.search}`;
    unexpected.push(msg);
    throw new Error(msg);
  }) as unknown as typeof fetch;
  return { fake, calls, unexpected };
}

/** The GitHub calls the publish made, without the installation token request. */
const apiCalls = (calls: Call[]) => calls.filter((c) => !c.path.startsWith("/app/installations/"));
const line = (c: Call) => `${c.method} ${c.path}${c.search}`;
const writes = (calls: Call[]) => apiCalls(calls).filter((c) => c.method !== "GET");

/** Every write names the working branch, never the base branch. The base is only the pull request's target. */
function expectOnlyWorkingBranchWrites(calls: Call[]) {
  for (const c of writes(calls)) {
    if (c.path === "/repos/sam/app/git/refs") expect(c.body?.ref).toBe(`refs/heads/${WORKFLOW_BRANCH}`);
    else if (c.path === `/repos/sam/app/git/refs/heads/${WORKFLOW_BRANCH}`) {
      expect(c.method).toBe("PATCH");
      expect(c.body).toEqual({ sha: BASE_SHA, force: true });
    }
    else if (c.path === `/repos/sam/app/contents/${WORKFLOW_PATH}`) expect(c.body?.branch).toBe(WORKFLOW_BRANCH);
    else if (c.path === "/repos/sam/app/pulls") {
      expect(c.body?.head).toBe(WORKFLOW_BRANCH);
      expect(c.body?.base).toBe("main");
    } else throw new Error(`An unexpected write: ${line(c)}`);
  }
}

/** Calls the publish and returns the error it threw. Fails the test if it did not throw an HttpError. */
async function failureOf(p: Promise<unknown>): Promise<HttpError> {
  try {
    await p;
  } catch (err) {
    if (err instanceof HttpError) return err;
    throw err;
  }
  throw new Error("The publish was expected to fail");
}

const auditRows = async (projectId: string) =>
  (await ctx.db.select().from(schema.auditLog).all()).filter((r) => r.target === projectId);

beforeAll(async () => {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  process.env.GITHUB_APP_ID = "12345";
  process.env.GITHUB_APP_CLIENT_ID = "Iv1.abc";
  process.env.GITHUB_APP_CLIENT_SECRET = "secret";
  process.env.GITHUB_WEBHOOK_SECRET = "hook-secret";
  process.env.GITHUB_APP_PRIVATE_KEY = privateKey.export({ type: "pkcs1", format: "pem" }).toString().replace(/\n/g, "\\n");
  resetConfigForTests();
  ctx = await useFreshDb();
  user = await upsertUser({ id: "u1", name: "Sam", email: null, slackId: null });
  stranger = await upsertUser({ id: "u2", name: "Kim", email: null, slackId: null });
  serverId = (await createServer(user.id, "sam-wp")).id;
  await ctx.db.insert(schema.githubInstallations).values({
    id: INSTALLATION,
    userId: user.id,
    accountLogin: "sam",
    accountType: "User",
    createdAt: new Date(),
  });
});
afterAll(async () => {
  await ctx.cleanup();
  for (const k of ["GITHUB_APP_ID", "GITHUB_APP_CLIENT_ID", "GITHUB_APP_CLIENT_SECRET", "GITHUB_WEBHOOK_SECRET", "GITHUB_APP_PRIVATE_KEY"]) {
    delete process.env[k];
  }
  resetConfigForTests();
});
beforeEach(() => {
  rateLimiter().clear();
  clearTokenCacheForTests();
  vi.mocked(getCurrentUser).mockResolvedValue(user);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("publishWorkflow: the happy paths", () => {
  it("opens a pull request when nothing exists, with the exact calls, and never writes the base branch", async () => {
    const p = await makeProject();
    const gh = github({ baseFile: null });
    const result = await publishWorkflow(user.id, p.id, { fetchImpl: gh.fake });

    expect(result).toEqual({ status: "opened", branch: WORKFLOW_BRANCH, base: "main", pullRequestUrl: PR_URL });
    expect(gh.unexpected).toEqual([]);
    expect(apiCalls(gh.calls).map(line)).toEqual([
      "GET /repos/sam/app/git/ref/heads/main",
      `GET /repos/sam/app/contents/${WORKFLOW_PATH}?ref=main`,
      `GET /repos/sam/app/git/ref/heads/${WORKFLOW_BRANCH}`,
      "POST /repos/sam/app/git/refs",
      `GET /repos/sam/app/contents/${WORKFLOW_PATH}?ref=${encodeURIComponent(WORKFLOW_BRANCH)}`,
      `PUT /repos/sam/app/contents/${WORKFLOW_PATH}`,
      `GET /repos/sam/app/pulls?state=open&head=sam%3A${encodeURIComponent(WORKFLOW_BRANCH)}&base=main`,
      "POST /repos/sam/app/pulls",
    ]);

    const refPost = apiCalls(gh.calls).find((c) => c.path === "/repos/sam/app/git/refs")!;
    expect(refPost.body).toEqual({ ref: `refs/heads/${WORKFLOW_BRANCH}`, sha: BASE_SHA });

    const expected = expectedFor(p);
    const put = apiCalls(gh.calls).find((c) => c.method === "PUT")!;
    expect(put.body).toEqual({
      message: "Add the Egg build workflow",
      content: Buffer.from(expected).toString("base64"),
      branch: WORKFLOW_BRANCH,
    });
    expect(put.body).not.toHaveProperty("sha");

    const pr = apiCalls(gh.calls).find((c) => c.method === "POST" && c.path === "/repos/sam/app/pulls")!;
    expect(pr.body).toMatchObject({ title: "Add Egg build workflow", head: WORKFLOW_BRANCH, base: "main" });
    const prBody = String(pr.body?.body);
    expect(prBody).toContain("no secrets");
    expect(prBody).not.toMatch(/[–—]/);

    expectOnlyWorkingBranchWrites(gh.calls);
  });

  it("returns already, and changes nothing, when the base branch has the identical file", async () => {
    const p = await makeProject();
    const gh = github({ baseFile: expectedFor(p) });
    const result = await publishWorkflow(user.id, p.id, { fetchImpl: gh.fake });

    expect(result).toEqual({ status: "already", branch: "main", base: "main", pullRequestUrl: null });
    expect(writes(gh.calls)).toEqual([]);
    expect(apiCalls(gh.calls).map((c) => c.method)).toEqual(["GET", "GET"]);
  });

  it("reports updated, and rewrites the file with its sha, when the branch and the pull request already exist", async () => {
    const p = await makeProject();
    const gh = github({
      baseFile: null,
      branchExists: true,
      branchFile: "an older workflow",
      pulls: [{ html_url: PR_URL }],
    });
    const result = await publishWorkflow(user.id, p.id, { fetchImpl: gh.fake });

    expect(result).toEqual({ status: "updated", branch: WORKFLOW_BRANCH, base: "main", pullRequestUrl: PR_URL });
    const put = writes(gh.calls).find((c) => c.method === "PUT")!;
    expect(put.body).toMatchObject({ branch: WORKFLOW_BRANCH, sha: "sha-branch", message: "Update the Egg build workflow" });
    expect(Buffer.from(String(put.body?.content), "base64").toString("utf8")).toBe(expectedFor(p));
    expect(writes(gh.calls).some((c) => c.path === "/repos/sam/app/git/refs")).toBe(false);
    expect(writes(gh.calls).some((c) => c.method === "POST" && c.path === "/repos/sam/app/pulls")).toBe(false);
    expectOnlyWorkingBranchWrites(gh.calls);
  });

  it("skips the PUT when the working branch already has the identical file and a pull request is open", async () => {
    const p = await makeProject();
    const gh = github({ baseFile: null, branchExists: true, branchFile: expectedFor(p), pulls: [{ html_url: PR_URL }] });
    const result = await publishWorkflow(user.id, p.id, { fetchImpl: gh.fake });

    expect(result).toEqual({ status: "updated", branch: WORKFLOW_BRANCH, base: "main", pullRequestUrl: PR_URL });
    expect(writes(gh.calls)).toEqual([]);
  });

  it("moves a leftover branch to the base when no pull request is open on it, then opens a clean one", async () => {
    const p = await makeProject();
    // The branch holds an older copy of the file from a pull request that was squash merged. Nothing is open.
    const gh = github({ baseFile: "the merged copy", branchExists: true, branchFile: "an older copy" });
    const result = await publishWorkflow(user.id, p.id, { fetchImpl: gh.fake });

    expect(result).toEqual({ status: "opened", branch: WORKFLOW_BRANCH, base: "main", pullRequestUrl: PR_URL });
    const order = writes(gh.calls).map((c) => `${c.method} ${c.path}`);
    expect(order).toEqual([
      `PATCH /repos/sam/app/git/refs/heads/${WORKFLOW_BRANCH}`,
      `PUT /repos/sam/app/contents/${WORKFLOW_PATH}`,
      "POST /repos/sam/app/pulls",
    ]);
    // After the reset the branch holds the base's file, so the update carries the sha of that file.
    const put = writes(gh.calls).find((c) => c.method === "PUT")!;
    expect(put.body).toMatchObject({ branch: WORKFLOW_BRANCH, sha: "sha-branch" });
    expect(Buffer.from(String(put.body?.content), "base64").toString("utf8")).toBe(expectedFor(p));
    expectOnlyWorkingBranchWrites(gh.calls);
  });

  it("does not move a branch that has a pull request open on it", async () => {
    const p = await makeProject();
    const gh = github({ baseFile: null, branchExists: true, branchFile: "an older workflow", pulls: [{ html_url: PR_URL }] });
    await publishWorkflow(user.id, p.id, { fetchImpl: gh.fake });
    expect(writes(gh.calls).some((c) => c.method === "PATCH")).toBe(false);
  });

  it("refuses a failed reset as a GitHub error and writes no file", async () => {
    const p = await makeProject();
    const gh = github({
      baseFile: null,
      branchExists: true,
      override: (c) => (c.method === "PATCH" ? json({ message: SENTINEL }, 500) : undefined),
    });
    const err = await failureOf(publishWorkflow(user.id, p.id, { fetchImpl: gh.fake }));
    expect(err).toMatchObject({ status: 502, code: "github_error" });
    expect(err.message).not.toContain(SENTINEL);
    expect(writes(gh.calls).some((c) => c.method === "PUT")).toBe(false);
  });

  it("re-reads once and carries on when the branch was created by a racing request", async () => {
    const p = await makeProject();
    const gh = github({ baseFile: null, refRace: true });
    const result = await publishWorkflow(user.id, p.id, { fetchImpl: gh.fake });

    expect(result.status).toBe("opened");
    expect(apiCalls(gh.calls).filter((c) => c.method === "POST" && c.path === "/repos/sam/app/git/refs")).toHaveLength(1);
    expectOnlyWorkingBranchWrites(gh.calls);
  });

  it("reports updated with the existing pull request when a racing request opened it first", async () => {
    const p = await makeProject();
    const gh = github({ baseFile: null, branchExists: true, pullRace: true, branchFile: "old" });
    const result = await publishWorkflow(user.id, p.id, { fetchImpl: gh.fake });

    expect(result).toEqual({ status: "updated", branch: WORKFLOW_BRANCH, base: "main", pullRequestUrl: PR_URL });
    expect(apiCalls(gh.calls).filter((c) => c.method === "POST" && c.path === "/repos/sam/app/pulls")).toHaveLength(1);
  });

  it("writes an audit row with the status and branch, and no token", async () => {
    const p = await makeProject();
    const gh = github({ baseFile: null });
    await publishWorkflow(user.id, p.id, { fetchImpl: gh.fake });

    const rows = (await auditRows(p.id)).filter((r) => r.action === "project.workflow.publish");
    expect(rows).toHaveLength(1);
    expect(rows[0].userId).toBe(user.id);
    expect(JSON.parse(rows[0].meta ?? "{}")).toEqual({ status: "opened", branch: WORKFLOW_BRANCH });
    expect(rows[0].meta).not.toContain(TOKEN);
  });
});

describe("publishWorkflow: refusals and errors", () => {
  it("refuses a project that is not linked to a GitHub installation", async () => {
    const p = await makeProject({ installationId: null, repoFullName: null });
    const gh = github({});
    const err = await failureOf(publishWorkflow(user.id, p.id, { fetchImpl: gh.fake }));
    expect(err).toMatchObject({ status: 400, code: "not_a_github_project" });
    expect(apiCalls(gh.calls)).toEqual([]);
  });

  it("refuses an installation the signed-in user does not own, as not a GitHub project", async () => {
    const p = await makeProject();
    await ctx.db.update(schema.projects).set({ installationId: 9999 }).where(eq(schema.projects.id, p.id));
    const gh = github({});
    const err = await failureOf(publishWorkflow(user.id, p.id, { fetchImpl: gh.fake }));
    expect(err).toMatchObject({ status: 400, code: "not_a_github_project" });
    expect(gh.calls).toEqual([]);
  });

  it("gives another user's project as not found", async () => {
    const p = await makeProject();
    const gh = github({});
    const err = await failureOf(publishWorkflow(stranger.id, p.id, { fetchImpl: gh.fake }));
    expect(err).toMatchObject({ status: 404, code: "not_found" });
    expect(gh.calls).toEqual([]);
  });

  it("refuses an invalid production branch before any GitHub request", async () => {
    const p = await makeProject();
    await ctx.db.update(schema.projects).set({ productionBranch: "bad branch!" }).where(eq(schema.projects.id, p.id));
    const gh = github({});
    const err = await failureOf(publishWorkflow(user.id, p.id, { fetchImpl: gh.fake }));
    expect(err).toMatchObject({ status: 422, code: "workflow_invalid" });
    expect(gh.calls).toEqual([]);
  });

  it("refuses a production branch with .. segments before any GitHub request", async () => {
    const p = await makeProject();
    await ctx.db.update(schema.projects).set({ productionBranch: "a/../../users/x" }).where(eq(schema.projects.id, p.id));
    const gh = github({});
    const err = await failureOf(publishWorkflow(user.id, p.id, { fetchImpl: gh.fake }));
    expect(err).toMatchObject({ status: 422, code: "workflow_invalid" });
    expect(gh.calls).toEqual([]);
  });

  it("names the three permissions when the app is forbidden for integrations", async () => {
    const p = await makeProject();
    const gh = github({
      override: (c) =>
        c.path === "/repos/sam/app/git/ref/heads/main"
          ? json({ message: "Resource not accessible by integration" }, 403)
          : undefined,
    });
    const err = await failureOf(publishWorkflow(user.id, p.id, { fetchImpl: gh.fake }));
    expect(err.status).toBe(403);
    expect(err.code).toBe("permission_missing");
    expect(err.message).toContain("Contents: Read and write");
    expect(err.message).toContain("Pull requests: Read and write");
    expect(err.message).toContain("Workflows: Read and write");
    expect(err.message).not.toContain(TOKEN);
  });

  it("maps a 404 that says the integration lacks permission the same way", async () => {
    const p = await makeProject();
    const gh = github({ baseRef: { status: 404, message: "Resource not accessible by integration" } });
    const err = await failureOf(publishWorkflow(user.id, p.id, { fetchImpl: gh.fake }));
    expect(err).toMatchObject({ status: 403, code: "permission_missing" });
  });

  it("maps the workflows-permission refusal from the PUT, the real case when the file is written", async () => {
    const p = await makeProject();
    const gh = github({
      baseFile: null,
      override: (c) =>
        c.method === "PUT"
          ? json(
              {
                message:
                  "refusing to allow a GitHub App to create or update workflow `.github/workflows/egg.yml` without `workflows` permission",
                documentation_url: "https://docs.github.com/rest/repos/contents",
              },
              403
            )
          : undefined,
    });
    const err = await failureOf(publishWorkflow(user.id, p.id, { fetchImpl: gh.fake }));
    expect(err).toMatchObject({ status: 403, code: "permission_missing" });
    expect(err.message).toContain("Workflows: Read and write");
  });

  it("does not read a documentation link as a permission failure", async () => {
    const p = await makeProject();
    const gh = github({
      baseRef: {
        status: 404,
        message: "Not Found",
        documentation_url: "https://docs.github.com/rest/actions/workflows#permissions",
      },
    });
    const err = await failureOf(publishWorkflow(user.id, p.id, { fetchImpl: gh.fake }));
    expect(err).toMatchObject({ status: 404, code: "repo_unavailable" });
  });

  it("says the repository or branch is unavailable when the base branch is not found", async () => {
    const p = await makeProject();
    const gh = github({ baseRef: 404 });
    const err = await failureOf(publishWorkflow(user.id, p.id, { fetchImpl: gh.fake }));
    expect(err).toMatchObject({ status: 404, code: "repo_unavailable" });
    expect(gh.calls.filter((c) => c.method !== "GET" && !c.path.startsWith("/app/"))).toEqual([]);
  });

  it("answers a 500 as github_error and leaks neither the token nor the response body", async () => {
    const p = await makeProject();
    const logs: unknown[][] = [];
    for (const k of ["log", "warn", "error"] as const) vi.spyOn(console, k).mockImplementation((...a) => void logs.push(a));
    const gh = github({
      override: (c) => (c.path === "/repos/sam/app/git/ref/heads/main" ? new Response(`${TOKEN} ${SENTINEL}`, { status: 500 }) : undefined),
    });
    const err = await failureOf(publishWorkflow(user.id, p.id, { fetchImpl: gh.fake }));
    expect(err).toMatchObject({ status: 502, code: "github_error" });
    expect(err.message).not.toContain(TOKEN);
    expect(err.message).not.toContain(SENTINEL);
    expect(JSON.stringify(logs)).not.toContain(TOKEN);
    expect(JSON.stringify(logs)).not.toContain(SENTINEL);
  });

  it("answers a timeout as github_error", async () => {
    const p = await makeProject();
    const gh = github({ override: (c) => (c.path === "/repos/sam/app/git/ref/heads/main" ? "throw" : undefined) });
    const err = await failureOf(publishWorkflow(user.id, p.id, { fetchImpl: gh.fake }));
    expect(err).toMatchObject({ status: 502, code: "github_error" });
    expect(err.message).not.toContain(TOKEN);
  });

  it("gives every GitHub request a timeout signal", async () => {
    const p = await makeProject();
    const gh = github({ baseFile: null });
    await publishWorkflow(user.id, p.id, { fetchImpl: gh.fake });
    expect(apiCalls(gh.calls).length).toBeGreaterThan(0);
    for (const c of apiCalls(gh.calls)) expect(c.signal).toBeInstanceOf(AbortSignal);
  });

  it("never puts the token in the audit row or the returned object", async () => {
    const p = await makeProject();
    const gh = github({ baseFile: null });
    const result = await publishWorkflow(user.id, p.id, { fetchImpl: gh.fake });
    expect(JSON.stringify(result)).not.toContain(TOKEN);
    expect(JSON.stringify(await auditRows(p.id))).not.toContain(TOKEN);
  });
});

describe("POST /api/projects/[id]/github-workflow/publish", () => {
  const request = (id: string) =>
    new NextRequest(`http://localhost:3000/api/projects/${id}/github-workflow/publish`, { method: "POST" });

  it("answers 200 with the result and no-store caching", async () => {
    const p = await makeProject();
    const gh = github({ baseFile: expectedFor(p) });
    vi.stubGlobal("fetch", gh.fake);
    const res = await publishRoute(request(p.id), { params: Promise.resolve({ id: p.id }) });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ status: "already", branch: "main", base: "main", pullRequestUrl: null });
  });

  it("answers another user's project with 404 and makes no GitHub request", async () => {
    const p = await makeProject();
    vi.mocked(getCurrentUser).mockResolvedValue(stranger);
    const gh = github({});
    vi.stubGlobal("fetch", gh.fake);
    const res = await publishRoute(request(p.id), { params: Promise.resolve({ id: p.id }) });
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe("not_found");
    expect(gh.calls).toEqual([]);
  });

  it("answers the error JSON shape with the code and message", async () => {
    const p = await makeProject({ installationId: null, repoFullName: null });
    const res = await publishRoute(request(p.id), { params: Promise.resolve({ id: p.id }) });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("not_a_github_project");
    expect(typeof body.error.message).toBe("string");
  });

  it("answers 429 after the limit, without calling GitHub for the refused request", async () => {
    const p = await makeProject();
    const gh = github({ baseFile: expectedFor(p) });
    vi.stubGlobal("fetch", gh.fake);
    for (let i = 0; i < RATE_LIMITS.workflowPublish.limit; i++) {
      const ok = await publishRoute(request(p.id), { params: Promise.resolve({ id: p.id }) });
      expect(ok.status).toBe(200);
    }
    const callsBefore = gh.calls.length;
    const refused = await publishRoute(request(p.id), { params: Promise.resolve({ id: p.id }) });
    expect(refused.status).toBe(429);
    expect(Number(refused.headers.get("retry-after"))).toBeGreaterThan(0);
    expect((await refused.json()).error.code).toBe("rate_limited");
    expect(gh.calls.length).toBe(callsBefore);
  });
});
