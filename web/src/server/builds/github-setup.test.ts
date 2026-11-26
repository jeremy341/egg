import { generateKeyPairSync } from "node:crypto";
import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { upsertUser } from "@/server/auth/session";
import { resetConfigForTests } from "@/server/config";
import { schema } from "@/server/db";
import { NOT_CHECKED, checkGithubConnection, type CheckResult } from "@/server/builds/connection-check";
import { createBuildCredentials } from "@/server/builds/token";
import { WORKFLOW_PATH, buildWorkflow } from "@/server/builds/workflow";
import { clearTokenCacheForTests } from "@/server/github/app";
import { createProject, type ProjectRow } from "@/server/projects";
import { RATE_LIMITS, rateLimiter } from "@/server/rate-limit";
import { createServer } from "@/server/servers";
import { useFreshDb } from "@/server/test/db";

// The route layer, the database and the check are real. Only sign-in and GitHub are replaced.
vi.mock("@/server/auth/current", () => ({ getCurrentUser: vi.fn(), requireUser: vi.fn() }));
import { getCurrentUser } from "@/server/auth/current";
import { GET as workflowRoute } from "@/app/api/projects/[id]/github-workflow/route";
import { POST as checkRoute } from "@/app/api/projects/[id]/github-check/route";

const EGG_URL = "http://localhost:3000";
const INSTALLATION = 4242;
const TOKEN = "ghs_INSTALLATIONTOKEN";

let ctx: Awaited<ReturnType<typeof useFreshDb>>;
let user: Awaited<ReturnType<typeof upsertUser>>;
let stranger: Awaited<ReturnType<typeof upsertUser>>;
let serverId: string;
let port = 5100;

async function makeProject(extra: Record<string, unknown> = {}): Promise<ProjectRow> {
  return createProject(user.id, {
    serverId,
    name: `P${port}`,
    repoUrl: "https://github.com/sam/app",
    repoFullName: "sam/app",
    installationId: INSTALLATION,
    runtime: "node",
    port: port++,
    buildLocation: "github",
    ...extra,
  });
}

type GithubWorld = {
  repos?: string[];
  /** The workflow file's text, or null for 404, or a number for another status, or a ready response (for a streamed body). */
  file?: string | null | number | Response;
  tokenStatus?: number;
};

/** A GitHub that answers only the three read-only requests the check is allowed to make; anything else fails the test. */
function github(world: GithubWorld = {}) {
  const calls: { url: string; method: string; auth: string }[] = [];
  const fake = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const auth = (init?.headers as Record<string, string> | undefined)?.authorization ?? "";
    calls.push({ url, method, auth });
    if (url === `https://api.github.com/app/installations/${INSTALLATION}/access_tokens` && method === "POST") {
      if (world.tokenStatus && world.tokenStatus !== 201) return new Response("{}", { status: world.tokenStatus });
      return Response.json({ token: TOKEN, expires_at: new Date(Date.now() + 3600_000).toISOString() });
    }
    if (url.startsWith("https://api.github.com/installation/repositories") && method === "GET") {
      return Response.json({
        repositories: (world.repos ?? ["sam/app"]).map((n, i) => ({
          id: i, full_name: n, private: true, default_branch: "main", pushed_at: null, clone_url: `https://github.com/${n}.git`,
        })),
      });
    }
    if (url.startsWith(`https://api.github.com/repos/sam/app/contents/${WORKFLOW_PATH}?ref=`) && method === "GET") {
      if (world.file === null || world.file === undefined) return new Response("{}", { status: 404 });
      if (typeof world.file === "number") return new Response("{}", { status: world.file });
      if (world.file instanceof Response) return world.file;
      return new Response(world.file, { status: 200 });
    }
    throw new Error(`The check made a request it should not make: ${method} ${url}`);
  }) as unknown as typeof fetch;
  return { fake, calls };
}

const goodFile = (over: Partial<Parameters<typeof buildWorkflow>[0]> = {}) =>
  buildWorkflow({
    eggUrl: EGG_URL,
    productionBranch: "main",
    runtime: "node",
    installCommand: null,
    buildCommand: null,
    outputDir: null,
    rootDir: ".",
    ...over,
  });

const byId = (checks: CheckResult[], id: CheckResult["id"]) => checks.find((c) => c.id === id)!;
const statuses = (checks: CheckResult[]) => Object.fromEntries(checks.map((c) => [c.id, c.status]));

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
  serverId = (await createServer(user.id, "sam-r")).id;
  await ctx.db.insert(schema.githubInstallations).values({ id: INSTALLATION, userId: user.id, accountLogin: "sam", accountType: "User", createdAt: new Date() });
});
afterAll(async () => {
  await ctx.cleanup();
  for (const k of ["GITHUB_APP_ID", "GITHUB_APP_CLIENT_ID", "GITHUB_APP_CLIENT_SECRET", "GITHUB_WEBHOOK_SECRET", "GITHUB_APP_PRIVATE_KEY"]) delete process.env[k];
  resetConfigForTests();
});
beforeEach(() => {
  rateLimiter().clear();
  clearTokenCacheForTests();
  vi.mocked(getCurrentUser).mockResolvedValue(user);
});
afterEach(() => vi.unstubAllGlobals());

describe("Test connection", () => {
  it("passes every check when everything is in place, with read-only GitHub requests only", async () => {
    const p = await makeProject();
    await createBuildCredentials(p.id);
    const gh = github({ file: goodFile() });
    const report = await checkGithubConnection(user.id, p.id, { eggUrl: EGG_URL, fetchImpl: gh.fake });
    expect(statuses(report.checks)).toEqual({
      location: "pass",
      credentials: "pass",
      installation: "pass",
      repository: "pass",
      workflow_file: "pass",
      workflow_matches: "pass",
    });
    expect(report.allPassed).toBe(true);
    // Only reads, and the installation token is used as a bearer, never in a URL.
    expect(gh.calls.filter((c) => c.method !== "GET").map((c) => c.url)).toEqual([`https://api.github.com/app/installations/${INSTALLATION}/access_tokens`]);
    expect(gh.calls.some((c) => c.url.includes(TOKEN))).toBe(false);
    expect(gh.calls.find((c) => c.url.includes("/contents/"))?.url).toBe(`https://api.github.com/repos/sam/app/contents/${WORKFLOW_PATH}?ref=main`);
    // The report says what it did not check, and holds no token or file text.
    expect(report.notChecked).toEqual([...NOT_CHECKED]);
    expect(report.notChecked.join(" ")).toMatch(/secrets/);
    const text = JSON.stringify(report);
    expect(text).not.toContain(TOKEN);
    expect(text).not.toContain("EGG_UPLOAD_TOKEN: ");
    expect(text).not.toContain("EGG_UPLOAD_PRODUCTION_TOKEN: ");
    expect(text).not.toMatch(/egg_build_/);
    expect(text).not.toMatch(/[–—]/);
  });

  it("fails the build location and credentials with a fix, and skips nothing that can still be checked", async () => {
    const p = await makeProject({ buildLocation: "container" });
    const gh = github({ file: goodFile() });
    const report = await checkGithubConnection(user.id, p.id, { eggUrl: EGG_URL, fetchImpl: gh.fake });
    expect(byId(report.checks, "location")).toMatchObject({ status: "fail" });
    expect(byId(report.checks, "location").detail).toMatch(/Choose GitHub Actions/);
    expect(byId(report.checks, "credentials")).toMatchObject({ status: "fail" });
    expect(byId(report.checks, "credentials").detail).toMatch(/Make them below/);
    expect(byId(report.checks, "workflow_file").status).toBe("pass");
    expect(report.allPassed).toBe(false);
  });

  it("fails expired credentials, and an incomplete set", async () => {
    const p = await makeProject();
    await createBuildCredentials(p.id, new Date(Date.now() - 100 * 24 * 60 * 60 * 1000));
    const gh = github({ file: goodFile() });
    const expired = await checkGithubConnection(user.id, p.id, { eggUrl: EGG_URL, fetchImpl: gh.fake });
    expect(byId(expired.checks, "credentials")).toMatchObject({ status: "fail" });
    expect(byId(expired.checks, "credentials").detail).toMatch(/expired/);

    await createBuildCredentials(p.id);
    await ctx.db.delete(schema.buildCredentials).where(eq(schema.buildCredentials.scope, "env_preview"));
    const partial = await checkGithubConnection(user.id, p.id, { eggUrl: EGG_URL, fetchImpl: gh.fake });
    expect(byId(partial.checks, "credentials").status).toBe("fail");
  });

  it("does not pass what it did not check: no app link means the GitHub checks are not checked", async () => {
    const p = await makeProject({ installationId: null });
    await createBuildCredentials(p.id);
    const gh = github();
    const report = await checkGithubConnection(user.id, p.id, { eggUrl: EGG_URL, fetchImpl: gh.fake });
    expect(statuses(report.checks)).toMatchObject({
      installation: "fail",
      repository: "not_checked",
      workflow_file: "not_checked",
      workflow_matches: "not_checked",
    });
    expect(byId(report.checks, "installation").detail).toMatch(/install the app/);
    expect(byId(report.checks, "workflow_file").detail).toMatch(/^Not checked\./);
    expect(gh.calls).toHaveLength(0);
    expect(report.allPassed).toBe(false);
  });

  it("explains an app that was removed from the account", async () => {
    const p = await makeProject();
    await createBuildCredentials(p.id);
    const report = await checkGithubConnection(user.id, p.id, { eggUrl: EGG_URL, fetchImpl: github({ tokenStatus: 404 }).fake });
    expect(byId(report.checks, "installation")).toMatchObject({ status: "fail" });
    expect(byId(report.checks, "installation").detail).toMatch(/no longer installed.*Install it again/);
    expect(byId(report.checks, "repository").status).toBe("not_checked");
  });

  it("fails when the app cannot see the repository, and does not look for the file", async () => {
    const p = await makeProject();
    await createBuildCredentials(p.id);
    const gh = github({ repos: ["sam/other"], file: goodFile() });
    const report = await checkGithubConnection(user.id, p.id, { eggUrl: EGG_URL, fetchImpl: gh.fake });
    expect(byId(report.checks, "repository")).toMatchObject({ status: "fail" });
    expect(byId(report.checks, "repository").detail).toMatch(/sam\/app.*add this repository/);
    expect(byId(report.checks, "workflow_file").status).toBe("not_checked");
    expect(gh.calls.some((c) => c.url.includes("/contents/"))).toBe(false);
  });

  it("fails a missing workflow file with where to put it, and another GitHub status without calling it missing", async () => {
    const p = await makeProject();
    await createBuildCredentials(p.id);
    const missing = await checkGithubConnection(user.id, p.id, { eggUrl: EGG_URL, fetchImpl: github({ file: null }).fake });
    expect(byId(missing.checks, "workflow_file")).toMatchObject({ status: "fail" });
    expect(byId(missing.checks, "workflow_file").detail).toContain(`${WORKFLOW_PATH} on the main branch`);
    expect(byId(missing.checks, "workflow_matches").status).toBe("not_checked");
    const down = await checkGithubConnection(user.id, p.id, { eggUrl: EGG_URL, fetchImpl: github({ file: 502 }).fake });
    expect(byId(down.checks, "workflow_file").detail).toMatch(/GitHub answered 502/);
  });

  it("reads the file from the saved production branch", async () => {
    const p = await makeProject({ productionBranch: "release/1.x" });
    await createBuildCredentials(p.id);
    const gh = github({ file: goodFile({ productionBranch: "release/1.x" }) });
    const report = await checkGithubConnection(user.id, p.id, { eggUrl: EGG_URL, fetchImpl: gh.fake });
    expect(gh.calls.find((c) => c.url.includes("/contents/"))?.url).toContain("?ref=release%2F1.x");
    expect(byId(report.checks, "workflow_matches").status).toBe("pass");
  });

  it("stops reading a file that is over the limit, cancels the stream, and says it is too large", async () => {
    const p = await makeProject();
    await createBuildCredentials(p.id);
    // An endless body with no Content-Length: the check must stop after about the limit, not buffer it all.
    const chunk = 64 * 1024;
    const pulled = { bytes: 0, cancelled: false };
    const endless = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled.bytes += chunk;
        controller.enqueue(new Uint8Array(chunk).fill(35));
      },
      cancel() {
        pulled.cancelled = true;
      },
    });
    const report = await checkGithubConnection(user.id, p.id, {
      eggUrl: EGG_URL,
      fetchImpl: github({ file: new Response(endless, { status: 200 }) }).fake,
    });
    const file = byId(report.checks, "workflow_file");
    expect(file.status).toBe("fail");
    expect(file.detail).toMatch(/too large/);
    expect(byId(report.checks, "workflow_matches").status).toBe("not_checked");
    expect(pulled.cancelled).toBe(true);
    // The limit is 1,000,000 bytes. Reading stops within a chunk or two of it, never near the stream's full length.
    expect(pulled.bytes).toBeGreaterThanOrEqual(1_000_000);
    expect(pulled.bytes).toBeLessThanOrEqual(1_000_000 + 3 * chunk);
  });

  it("reads a file streamed in pieces in full, and checks it as text", async () => {
    const p = await makeProject();
    await createBuildCredentials(p.id);
    const bytes = new TextEncoder().encode(goodFile());
    const third = Math.ceil(bytes.length / 3);
    const pieces = [bytes.slice(0, third), bytes.slice(third, 2 * third), bytes.slice(2 * third)];
    const streamed = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const piece of pieces) controller.enqueue(piece);
        controller.close();
      },
    });
    const report = await checkGithubConnection(user.id, p.id, {
      eggUrl: EGG_URL,
      fetchImpl: github({ file: new Response(streamed, { status: 200 }) }).fake,
    });
    expect(byId(report.checks, "workflow_file").status).toBe("pass");
    expect(byId(report.checks, "workflow_matches").status).toBe("pass");
  });

  it("fails a workflow that belongs to another Egg, another branch, or lacks a secret", async () => {
    const p = await makeProject();
    await createBuildCredentials(p.id);
    const run = async (file: string) =>
      byId((await checkGithubConnection(user.id, p.id, { eggUrl: EGG_URL, fetchImpl: github({ file }).fake })).checks, "workflow_matches");

    const otherEgg = await run(goodFile({ eggUrl: "https://other.example.com" }));
    expect(otherEgg.status).toBe("fail");
    expect(otherEgg.detail).toMatch(/does not send builds to http:\/\/localhost:3000/);

    const otherBranch = await run(goodFile({ productionBranch: "trunk" }));
    expect(otherBranch.status).toBe("fail");
    expect(otherBranch.detail).toMatch(/main as the production branch/);

    const noSecret = await run(goodFile().replaceAll("secrets.EGG_ENV_PREVIEW_TOKEN", "secrets.SOMETHING"));
    expect(noSecret.status).toBe("fail");
    expect(noSecret.detail).toMatch(/EGG_ENV_PREVIEW_TOKEN/);

    // A workflow from before the environment split (or one with the environment line removed) is not the file Egg made.
    const noEnvironment = await run(goodFile().replace(/ +environment: egg-production\n/, ""));
    expect(noEnvironment.status).toBe("fail");
    expect(noEnvironment.detail).toMatch(/egg-production environment/);

    expect((await run("name: unrelated\n")).status).toBe("fail");
    // The same file with Windows line endings and single quotes is still the file.
    expect((await run(goodFile().replace(/"/g, "'").replace(/\n/g, "\r\n"))).status).toBe("pass");
  });

  it("is owner only: another user gets 404 and GitHub is not called", async () => {
    const p = await makeProject();
    const gh = github();
    await expect(checkGithubConnection(stranger.id, p.id, { eggUrl: EGG_URL, fetchImpl: gh.fake })).rejects.toMatchObject({ status: 404 });
    expect(gh.calls).toHaveLength(0);
  });
});

const params = (id: string) => ({ params: Promise.resolve({ id }) });
const post = (id: string) => checkRoute(new NextRequest(`${EGG_URL}/api/projects/${id}/github-check`, { method: "POST" }), params(id));
const getWorkflow = (id: string) => workflowRoute(new NextRequest(`${EGG_URL}/api/projects/${id}/github-workflow`), params(id));

describe("POST /api/projects/[id]/github-check", () => {
  it("returns the report for the owner, never cached, with no token anywhere in it", async () => {
    const p = await makeProject();
    const creds = await createBuildCredentials(p.id);
    vi.stubGlobal("fetch", github({ file: goodFile() }).fake);
    const res = await post(p.id);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = await res.json();
    expect(body.allPassed).toBe(true);
    expect(body.checks).toHaveLength(6);
    const text = JSON.stringify(body);
    for (const secret of [TOKEN, creds.previewUploadToken, creds.productionUploadToken, creds.previewEnvToken, creds.productionEnvToken]) expect(text).not.toContain(secret);
  });

  it("needs a signed-in user, and hides other people's projects", async () => {
    const p = await makeProject();
    vi.stubGlobal("fetch", github().fake);
    vi.mocked(getCurrentUser).mockResolvedValue(null);
    expect((await post(p.id)).status).toBe(401);
    vi.mocked(getCurrentUser).mockResolvedValue(stranger);
    expect((await post(p.id)).status).toBe(404);
  });

  it("refuses a request from another site", async () => {
    const p = await makeProject();
    vi.stubGlobal("fetch", github().fake);
    const res = await checkRoute(
      new NextRequest(`${EGG_URL}/api/projects/${p.id}/github-check`, { method: "POST", headers: { origin: "https://evil.example" } }),
      params(p.id)
    );
    expect(res.status).toBe(403);
  });

  it("is limited per user, with Retry-After, and the limit is the one in RATE_LIMITS", async () => {
    const p = await makeProject();
    vi.stubGlobal("fetch", github({ file: goodFile() }).fake);
    for (let i = 0; i < RATE_LIMITS.githubCheck.limit; i++) expect((await post(p.id)).status).toBe(200);
    const res = await post(p.id);
    expect(res.status).toBe(429);
    expect(Number(res.headers.get("retry-after"))).toBeGreaterThan(0);
    // Another user is not slowed down by it.
    vi.mocked(getCurrentUser).mockResolvedValue(stranger);
    expect((await post(p.id)).status).toBe(404);
  });
});

describe("GET /api/projects/[id]/github-workflow", () => {
  it("returns the workflow made from the saved settings and the secret names, no values", async () => {
    const p = await makeProject({ rootDir: "apps/web", installCommand: "npm ci", buildCommand: "npm run build" });
    const creds = await createBuildCredentials(p.id);
    const res = await getWorkflow(p.id);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = await res.json();
    expect(body.path).toBe(".github/workflows/egg.yml");
    expect(body.workflow).toBe(
      buildWorkflow({ eggUrl: EGG_URL, productionBranch: "main", runtime: "node", installCommand: "npm ci", buildCommand: "npm run build", outputDir: null, rootDir: "apps/web" })
    );
    expect(body.workflow).toContain('working-directory: "apps/web"');
    expect(body.limits).toEqual({ waitMinutes: 60, maxArchiveMb: 500, credentialDays: 90 });
    expect(body.secrets.map((s: { name: string }) => s.name)).toEqual([
      "EGG_UPLOAD_PRODUCTION_TOKEN",
      "EGG_ENV_PRODUCTION_TOKEN",
      "EGG_UPLOAD_PREVIEW_TOKEN",
      "EGG_ENV_PREVIEW_TOKEN",
    ]);
    const text = JSON.stringify(body);
    for (const secret of [creds.previewUploadToken, creds.productionUploadToken, creds.previewEnvToken, creds.productionEnvToken]) expect(text).not.toContain(secret);
  });

  it("is owner only", async () => {
    const p = await makeProject();
    vi.mocked(getCurrentUser).mockResolvedValue(null);
    expect((await getWorkflow(p.id)).status).toBe(401);
    vi.mocked(getCurrentUser).mockResolvedValue(stranger);
    expect((await getWorkflow(p.id)).status).toBe(404);
  });

  it("answers 422 with the reason when a saved setting cannot be put in a file", async () => {
    const p = await makeProject({ runtime: "static" });
    await ctx.db.update(schema.projects).set({ outputDir: "../outside" }).where(eq(schema.projects.id, p.id));
    const res = await getWorkflow(p.id);
    expect(res.status).toBe(422);
    expect((await res.json()).error).toMatchObject({ code: "workflow_invalid", message: "The output directory is not a valid relative path." });
  });
});
