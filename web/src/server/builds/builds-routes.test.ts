import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { upsertUser } from "@/server/auth/session";
import { resetConfigForTests } from "@/server/config";
import { schema } from "@/server/db";
import { sha256Hex } from "@/server/crypto";
import {
  BUILD_CREDENTIAL_TTL_MS,
  createBuildCredentials,
  verifyBuildCredential,
  type BuildCredentials,
} from "@/server/builds/token";
import { acceptUpload, parseUploadHeaders, readUpload, uploadsDir } from "@/server/builds/uploads";
import { createProject, deployBranch, deploymentLogs, enqueueDeployment, setEnvVar, type ProjectRow } from "@/server/projects";
import { rateLimiter } from "@/server/rate-limit";
import { createServer } from "@/server/servers";
import { useFreshDb } from "@/server/test/db";
import { goodRelease, rawTarGz, sha256Of } from "@/server/test/raw-tar";

// The route layer, the database and the files are real. Only sign-in is replaced.
vi.mock("@/server/auth/current", () => ({ getCurrentUser: vi.fn(), requireUser: vi.fn() }));
import { getCurrentUser } from "@/server/auth/current";
import { POST as uploadRoute } from "@/app/api/builds/upload/route";
import { GET as envRoute } from "@/app/api/builds/env/route";
import {
  DELETE as credentialsDelete,
  GET as credentialsGet,
  POST as credentialsPost,
} from "@/app/api/projects/[id]/build-credentials/route";

const COMMIT = "a".repeat(40);
const OTHER_COMMIT = "b".repeat(40);

let ctx: Awaited<ReturnType<typeof useFreshDb>>;
let work: string;
let user: Awaited<ReturnType<typeof upsertUser>>;
let stranger: Awaited<ReturnType<typeof upsertUser>>;
let serverId: string;
let project: ProjectRow;
let creds: BuildCredentials;
let token: string;
let port = 4100;

async function newProject(name: string, extra: Record<string, unknown> = {}) {
  return createProject(user.id, {
    serverId,
    name,
    repoUrl: "https://github.com/example/demo",
    runtime: "node",
    port: port++,
    ...extra,
  });
}

const headersFor = (bytes: Buffer, over: Record<string, string> = {}) => ({
  "x-egg-commit": COMMIT,
  "x-egg-sha256": sha256Of(bytes),
  "x-egg-branch": "main",
  "x-egg-run": "4242",
  ...over,
});

/** The credential goes in the Authorization header, and only there. */
const bearer = (tok: string | null): Record<string, string> => (tok === null ? {} : { authorization: `Bearer ${tok}` });

const upload = (tok: string | null, bytes: Buffer, over: Record<string, string> = {}, extra: Record<string, string> = {}) =>
  uploadRoute(
    new NextRequest("http://localhost/api/builds/upload", {
      method: "POST",
      body: new Uint8Array(bytes),
      headers: { ...headersFor(bytes, over), ...bearer(tok), ...extra },
    }),
    undefined
  );

const envGet = (tok: string | null, query = "") =>
  envRoute(new NextRequest(`http://localhost/api/builds/env${query}`, { headers: bearer(tok) }), undefined);

const ONE_DAY = 24 * 60 * 60 * 1000;

/** Make every credential of the project already past its expiry. */
const expireAll = (projectId: string) =>
  ctx.db.update(schema.buildCredentials).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(schema.buildCredentials.projectId, projectId));

const filesInUploads = () => readdirSync(uploadsDir());
const logText = async (id: string) => (await deploymentLogs(user.id, id)).map((l) => l.message).join("\n");

/** A queued deployment of the project that waits for COMMIT on main. */
async function waitingFor(p: ProjectRow, commit: string | null = COMMIT, branch = "main") {
  return enqueueDeployment(p, { env: "production", source: commit ? "webhook" : "manual", branch, commitSha: commit, triggeredBy: user.id });
}

async function finish(id: string, state: "ready" | "canceled" | "error") {
  await ctx.db.update(schema.deployments).set({ state }).where(eq(schema.deployments.id, id));
}

beforeAll(async () => {
  work = mkdtempSync(path.join(tmpdir(), "egg-uploads-"));
  process.env.DEPLOY_WORK_DIR = work;
  ctx = await useFreshDb();
  resetConfigForTests();
  user = await upsertUser({ id: "u1", name: "Sam", email: null, slackId: null });
  stranger = await upsertUser({ id: "u2", name: "Kim", email: null, slackId: null });
  serverId = (await createServer(user.id, "sam-r")).id;
});
afterAll(async () => {
  await ctx.cleanup();
  delete process.env.DEPLOY_WORK_DIR;
  resetConfigForTests();
  rmSync(work, { recursive: true, force: true });
});
beforeEach(async () => {
  rateLimiter().clear();
  vi.mocked(getCurrentUser).mockResolvedValue(user);
  project = await newProject(`P${port}`, { buildLocation: "github" });
  creds = await createBuildCredentials(project.id);
  token = creds.productionUploadToken;
  for (const f of filesInUploads()) rmSync(path.join(uploadsDir(), f), { force: true });
});

const allTokens = () => [creds.previewUploadToken, creds.productionUploadToken, creds.previewEnvToken, creds.productionEnvToken];

/** Every way a credential can be bad must produce this exact answer. */
async function expectSame401(res: Response) {
  expect(res.status).toBe(401);
  expect(await res.json()).toEqual({ error: { code: "unauthorized", message: "That build credential is not valid." } });
}

function ownerReq(id: string, method: string, headers: Record<string, string> = {}) {
  return new NextRequest(`http://localhost:3000/api/projects/${id}/build-credentials`, { method, headers });
}

describe("the build credentials", () => {
  it("look like egg_build_<scope>_ plus 43 characters of base64url (32 random bytes), one per scope", () => {
    expect(creds.previewUploadToken).toMatch(/^egg_build_upload_preview_[A-Za-z0-9_-]{43}$/);
    expect(creds.productionUploadToken).toMatch(/^egg_build_upload_production_[A-Za-z0-9_-]{43}$/);
    expect(creds.previewEnvToken).toMatch(/^egg_build_env_preview_[A-Za-z0-9_-]{43}$/);
    expect(creds.productionEnvToken).toMatch(/^egg_build_env_production_[A-Za-z0-9_-]{43}$/);
  });

  it("last 90 days", () => {
    expect(BUILD_CREDENTIAL_TTL_MS).toBe(90 * ONE_DAY);
    expect(creds.expiresAt.getTime() - creds.createdAt.getTime()).toBe(90 * ONE_DAY);
  });

  it("are stored only as SHA-256 hashes: no table, audit row or deployment log holds a token", async () => {
    const dep = await waitingFor(project);
    await upload(token, goodRelease());
    await envGet(creds.productionEnvToken);
    const rows = await ctx.db.select().from(schema.buildCredentials).where(eq(schema.buildCredentials.projectId, project.id));
    expect(rows.map((r) => r.tokenHash).sort()).toEqual(allTokens().map(sha256Hex).sort());
    const everything = JSON.stringify([
      await ctx.db.select().from(schema.buildCredentials),
      await ctx.db.select().from(schema.projects),
      await ctx.db.select().from(schema.auditLog),
      await ctx.db.select().from(schema.deploymentLogs),
      await logText(dep.id),
    ]);
    for (const t of allTokens()) expect(everything).not.toContain(t);
  });

  it("belong to one project and verify to its id", async () => {
    const other = await newProject(`Other${port}`, { buildLocation: "github" });
    const otherCreds = await createBuildCredentials(other.id);
    expect(await verifyBuildCredential(token, "upload_production")).toBe(project.id);
    expect(await verifyBuildCredential(otherCreds.productionUploadToken, "upload_production")).toBe(other.id);
  });

  it("are replaced by new ones: the old three stop working at once", async () => {
    const second = await createBuildCredentials(project.id);
    expect(second.productionUploadToken).not.toBe(token);
    expect(await verifyBuildCredential(token, "upload_production")).toBeNull();
    expect(await verifyBuildCredential(creds.productionEnvToken, "env_production")).toBeNull();
    expect(await verifyBuildCredential(creds.previewEnvToken, "env_preview")).toBeNull();
    expect(await verifyBuildCredential(second.productionUploadToken, "upload_production")).toBe(project.id);
    await expectSame401(await upload(token, goodRelease()));
    await expectSame401(await envGet(creds.productionEnvToken));
    await expectSame401(await envGet(creds.previewEnvToken, "?env=preview"));
  });

  it("are refused when the wrong shape, unknown, or a byte changed", async () => {
    expect(await verifyBuildCredential("", "upload_production")).toBeNull();
    expect(await verifyBuildCredential("egg_build_upload_production_short", "upload_production")).toBeNull();
    expect(await verifyBuildCredential(token.slice(0, -1) + (token.endsWith("A") ? "B" : "A"), "upload_production")).toBeNull();
    expect(await verifyBuildCredential("egg_build_upload_production_" + "x".repeat(43), "upload_production")).toBeNull();
    expect(await verifyBuildCredential(sha256Hex(token), "upload_production")).toBeNull();
  });

  it("are compared in constant time", async () => {
    const fs = await import("node:fs");
    const source = fs.readFileSync(path.join(process.cwd(), "src/server/builds/token.ts"), "utf8");
    expect(source).toMatch(/safeEqual\(row\.hash, hash\)/);
    const crypto = fs.readFileSync(path.join(process.cwd(), "src/server/crypto.ts"), "utf8");
    expect(crypto).toMatch(/timingSafeEqual/);
  });

  it("stop working at the moment they expire", async () => {
    expect(await verifyBuildCredential(token, "upload_production", new Date(creds.expiresAt.getTime() - 1))).toBe(project.id);
    expect(await verifyBuildCredential(token, "upload_production", creds.expiresAt)).toBeNull();
  });

  it("an expired credential gets the 401 from the route, not a 202 or a 409", async () => {
    await waitingFor(project);
    await expireAll(project.id);
    await expectSame401(await upload(token, goodRelease()));
    await expectSame401(await envGet(creds.productionEnvToken));
    await expectSame401(await envGet(creds.previewEnvToken, "?env=preview"));
    expect(filesInUploads()).toEqual([]);
  });

  it("making new ones deletes the project's expired rows too, and leaves other projects alone", async () => {
    const other = await newProject(`Keep${port}`, { buildLocation: "github" });
    const otherCreds = await createBuildCredentials(other.id);
    await expireAll(project.id);
    await createBuildCredentials(project.id);
    const mine = await ctx.db.select().from(schema.buildCredentials).where(eq(schema.buildCredentials.projectId, project.id));
    expect(mine.map(r => r.scope).sort()).toEqual(["env_preview", "env_production", "upload_preview", "upload_production"]);
    expect(mine.every((r) => r.expiresAt.getTime() > Date.now())).toBe(true);
    expect(await verifyBuildCredential(otherCreds.productionUploadToken, "upload_production")).toBe(other.id);
  });
});

describe("a credential in the URL is never accepted", () => {
  it("ignores a token in the upload query string, even a valid one", async () => {
    await waitingFor(project);
    const bytes = goodRelease();
    for (const url of [
      `http://localhost/api/builds/upload?token=${token}`,
      `http://localhost/api/builds/upload?access_token=${token}&key=${token}`,
      `http://localhost/api/builds/upload?authorization=Bearer%20${token}`,
    ]) {
      const res = await uploadRoute(new NextRequest(url, { method: "POST", body: new Uint8Array(bytes), headers: headersFor(bytes) }), undefined);
      await expectSame401(res);
    }
    expect(filesInUploads()).toEqual([]);
  });

  it("ignores a token in the env query string, for production and for preview", async () => {
    await setEnvVar(user.id, project.id, { key: "SECRET", value: "do-not-leak-this", target: "all" });
    for (const url of [
      `http://localhost/api/builds/env?token=${creds.productionEnvToken}`,
      `http://localhost/api/builds/env?env=preview&token=${creds.previewEnvToken}`,
    ]) {
      await expectSame401(await envRoute(new NextRequest(url), undefined));
    }
  });

  it("has no route that takes the token in the path, and no legacy token code", async () => {
    const fs = await import("node:fs");
    const root = path.join(process.cwd(), "src/app/api/builds");
    expect(fs.readdirSync(root).sort()).toEqual(["env", "upload"]);
    expect(fs.existsSync(path.join(process.cwd(), "src/app/api/projects/[id]/build-token"))).toBe(false);
    const tokenSource = fs.readFileSync(path.join(process.cwd(), "src/server/builds/token.ts"), "utf8");
    expect(tokenSource).not.toMatch(/buildUploadToken|UPLOAD_TOKEN_PREFIX|verifyUploadToken|authenticateBuildToken/);
  });

  it("ignores the credential in a cookie, a custom header or a Basic or malformed Authorization header", async () => {
    await waitingFor(project);
    const bytes = goodRelease();
    const attempts: Record<string, string>[] = [
      { cookie: `egg_build=${token}` },
      { "x-egg-token": token },
      { authorization: token },
      { authorization: `Basic ${token}` },
      { authorization: `Bearer ${token} extra` },
      { authorization: `Bearer ${token}, Bearer ${token}` },
    ];
    for (const extra of attempts) {
      await expectSame401(await upload(null, bytes, {}, extra));
    }
    expect(filesInUploads()).toEqual([]);
  });
});

describe("a bad credential gets the same 401 whatever is wrong with it", () => {
  it("is identical for missing, malformed, unknown, wrong-scope and replaced credentials", async () => {
    const stale = creds;
    await createBuildCredentials(project.id); // replaces `stale`
    const bad: { name: string; call: () => Promise<Response> }[] = [
      { name: "no header", call: () => upload(null, goodRelease()) },
      { name: "garbage", call: () => upload("nonsense", goodRelease()) },
      { name: "truncated", call: () => upload(token.slice(0, 20), goodRelease()) },
      { name: "unknown", call: () => upload("egg_build_upload_production_" + "x".repeat(43), goodRelease()) },
      { name: "replaced", call: () => upload(stale.productionUploadToken, goodRelease()) },
      { name: "env token on upload", call: () => upload(stale.productionEnvToken, goodRelease()) },
      { name: "env no header", call: () => envGet(null) },
      { name: "env garbage", call: () => envGet("nonsense") },
      { name: "env replaced production", call: () => envGet(stale.productionEnvToken) },
      { name: "env upload token", call: () => envGet(stale.productionUploadToken) },
    ];
    const bodies = new Set<string>();
    for (const b of bad) {
      const res = await b.call();
      expect(res.status, b.name).toBe(401);
      bodies.add(JSON.stringify(await res.json()));
    }
    expect([...bodies]).toEqual([JSON.stringify({ error: { code: "unauthorized", message: "That build credential is not valid." } })]);
  });

  it("is identical for a revoked credential", async () => {
    const res = await credentialsDelete(ownerReq(project.id, "DELETE"), { params: Promise.resolve({ id: project.id }) });
    expect(res.status).toBe(200);
    await expectSame401(await upload(token, goodRelease()));
    await expectSame401(await envGet(creds.productionEnvToken));
    await expectSame401(await envGet(creds.previewEnvToken, "?env=preview"));
  });

  it("turns an address away with 429 after 60 bad credentials a minute (behind a trusted proxy)", async () => {
    process.env.TRUST_PROXY = "1";
    try {
      const from = { "x-forwarded-for": "203.0.113.7" };
      for (let i = 0; i < 60; i++) expect((await upload("nonsense", goodRelease(), {}, from)).status).toBe(401);
      const res = await upload(token, goodRelease(), {}, from);
      expect(res.status).toBe(429);
      expect(Number(res.headers.get("retry-after"))).toBeGreaterThan(0);
      // Another address is not held back.
      expect((await upload(token, goodRelease(), {}, { "x-forwarded-for": "203.0.113.8" })).status).toBe(409);
    } finally {
      delete process.env.TRUST_PROXY;
    }
  });
});

describe("/api/projects/[id]/build-credentials", () => {
  const params = (id: string) => ({ params: Promise.resolve({ id }) });
  const make = (id: string, headers: Record<string, string> = {}) => credentialsPost(ownerReq(id, "POST", headers), params(id));
  const read = (id: string) => credentialsGet(ownerReq(id, "GET"), params(id));
  const revoke = (id: string, headers: Record<string, string> = {}) => credentialsDelete(ownerReq(id, "DELETE", headers), params(id));

  it("POST shows the four credentials once to the owner, replaces the earlier set and records it in the audit log", async () => {
    const res = await make(project.id);
    expect(res.status).toBe(201);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = await res.json();
    expect(body.previewUploadToken).toMatch(/^egg_build_upload_preview_/);
    expect(body.productionUploadToken).toMatch(/^egg_build_upload_production_/);
    expect(body.previewEnvToken).toMatch(/^egg_build_env_preview_/);
    expect(body.productionEnvToken).toMatch(/^egg_build_env_production_/);
    expect(Date.parse(body.expiresAt) - Date.parse(body.createdAt)).toBe(90 * ONE_DAY);
    expect(await verifyBuildCredential(body.productionUploadToken, "upload_production")).toBe(project.id);
    expect(await verifyBuildCredential(body.productionEnvToken, "env_production")).toBe(project.id);
    expect(await verifyBuildCredential(token, "upload_production")).toBeNull();
    const log = await ctx.db.select().from(schema.auditLog);
    expect(log.filter((r) => r.action === "build_credentials.create").length).toBeGreaterThan(0);
    for (const t of [body.previewUploadToken, body.productionUploadToken, body.previewEnvToken, body.productionEnvToken]) {
      expect(JSON.stringify(log)).not.toContain(t);
    }
  });

  it("GET gives only when they were made and when they stop working, never a token or a hash", async () => {
    const res = await read(project.id);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const text = await res.text();
    const body = JSON.parse(text);
    expect(body.configured).toBe(true);
    expect(body.credentials.map((c: { scope: string }) => c.scope)).toEqual(["upload_preview", "upload_production", "env_preview", "env_production"]);
    for (const c of body.credentials) {
      expect(Object.keys(c).sort()).toEqual(["createdAt", "expired", "expiresAt", "scope"]);
      expect(c.expired).toBe(false);
      expect(Date.parse(c.expiresAt) - Date.parse(c.createdAt)).toBe(90 * ONE_DAY);
    }
    for (const t of allTokens()) {
      expect(text).not.toContain(t);
      expect(text).not.toContain(sha256Hex(t));
    }
  });

  it("GET says so when there are none, and marks an expired set", async () => {
    const fresh = await newProject(`Bare${port}`, { buildLocation: "github" });
    expect(await (await read(fresh.id)).json()).toEqual({ configured: false, credentials: [] });
    await expireAll(project.id);
    const body = await (await read(project.id)).json();
    expect(body.credentials).toHaveLength(4);
    expect(body.credentials.every((c: { expired: boolean }) => c.expired)).toBe(true);
  });

  it("DELETE revokes all four at once and records it", async () => {
    const res = await revoke(project.id);
    expect(res.status).toBe(200);
    for (const [t, scope] of [[creds.previewUploadToken, "upload_preview"], [token, "upload_production"], [creds.previewEnvToken, "env_preview"], [creds.productionEnvToken, "env_production"]] as const) {
      expect(await verifyBuildCredential(t, scope)).toBeNull();
    }
    expect(await ctx.db.select().from(schema.buildCredentials).where(eq(schema.buildCredentials.projectId, project.id))).toHaveLength(0);
    expect(await (await read(project.id)).json()).toEqual({ configured: false, credentials: [] });
    const log = await ctx.db.select().from(schema.auditLog);
    expect(log.filter((r) => r.action === "build_credentials.revoke").length).toBeGreaterThan(0);
  });

  it("is for the owner only: another user cannot create, read or revoke, and nothing changes", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(stranger);
    expect((await make(project.id)).status).toBe(404);
    expect((await read(project.id)).status).toBe(404);
    expect((await revoke(project.id)).status).toBe(404);
    vi.mocked(getCurrentUser).mockResolvedValue(user);
    expect(await verifyBuildCredential(token, "upload_production")).toBe(project.id);
    expect(await verifyBuildCredential(creds.productionEnvToken, "env_production")).toBe(project.id);
  });

  it("needs a sign-in, and the same origin for POST and DELETE", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(null);
    expect((await make(project.id)).status).toBe(401);
    expect((await read(project.id)).status).toBe(401);
    expect((await revoke(project.id)).status).toBe(401);
    vi.mocked(getCurrentUser).mockResolvedValue(user);
    expect((await make(project.id, { origin: "https://evil.example" })).status).toBe(403);
    expect((await revoke(project.id, { origin: "https://evil.example" })).status).toBe(403);
    expect(await verifyBuildCredential(token, "upload_production")).toBe(project.id);
  });
});

describe("parseUploadHeaders", () => {
  const h = (over: Record<string, string | null> = {}) => {
    const x = new Headers({ "x-egg-commit": COMMIT, "x-egg-sha256": "c".repeat(64), "x-egg-branch": "feature/x", "x-egg-run": "12", ...(over as Record<string, string>) });
    for (const [k, v] of Object.entries(over)) if (v === null) x.delete(k);
    return x;
  };

  it("accepts good headers and lower-cases the hashes", () => {
    expect(parseUploadHeaders(h({ "x-egg-commit": COMMIT.toUpperCase() }))).toEqual({ commit: COMMIT, sha256: "c".repeat(64), branch: "feature/x", run: "12" });
  });

  it("refuses a commit that is not 40 hex characters, a checksum that is not 64, a bad ref, a run that is not digits", () => {
    const cases: Record<string, string | null>[] = [
      { "x-egg-commit": "abc" },
      { "x-egg-commit": "z".repeat(40) },
      { "x-egg-commit": "a".repeat(41) },
      { "x-egg-commit": null },
      { "x-egg-sha256": "c".repeat(63) },
      { "x-egg-sha256": null },
      { "x-egg-branch": "--upload-pack=x" },
      { "x-egg-branch": "a..b" },
      { "x-egg-branch": "a b" },
      { "x-egg-branch": "" },
      { "x-egg-run": "12a" },
      { "x-egg-run": "" },
    ];
    for (const over of cases) {
      expect(() => parseUploadHeaders(h(over)), JSON.stringify(over)).toThrow();
    }
  });
});

describe("POST /api/builds/upload: a credential only delivers a build to its own environment", () => {
  const waitingPreview = (commit = COMMIT, branch = "feature/x") =>
    enqueueDeployment(project, { env: "preview", source: "webhook", branch, commitSha: commit, triggeredBy: user.id });

  it("takes a preview upload credential for a preview deployment", async () => {
    const dep = await waitingPreview();
    const res = await upload(creds.previewUploadToken, goodRelease(), { "x-egg-branch": "feature/x" });
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ deployment: { id: dep.id } });
  });

  it("refuses a preview upload credential for the production deployment, with 403, and attaches nothing", async () => {
    const dep = await waitingFor(project);
    const res = await upload(creds.previewUploadToken, goodRelease());
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe("wrong_upload_credential");
    expect(body.error.message).toMatch(/production credential from the egg-production environment/);
    expect(filesInUploads()).toEqual([]);
    expect(await readUpload(dep.id)).toBeNull();
    // The right credential still works afterwards: the refusal did not use the deployment up.
    expect((await upload(token, goodRelease())).status).toBe(202);
  });

  it("refuses a production upload credential for a preview deployment, with 403", async () => {
    await waitingPreview();
    const res = await upload(token, goodRelease(), { "x-egg-branch": "feature/x" });
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("wrong_upload_credential");
    expect(filesInUploads()).toEqual([]);
  });

  it("cannot be fooled by naming the production branch in the header: the deployment's own environment decides", async () => {
    // Only a preview deployment waits, on feature/x. A preview credential that claims branch main finds nothing.
    await waitingPreview();
    const res = await upload(creds.previewUploadToken, goodRelease(), { "x-egg-branch": "main" });
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("no_deployment_waiting");
    expect(filesInUploads()).toEqual([]);
  });

  it("answers an env credential on the upload route with the same 401 as any bad credential", async () => {
    await waitingFor(project);
    await expectSame401(await upload(creds.productionEnvToken, goodRelease()));
    await expectSame401(await upload(creds.previewEnvToken, goodRelease()));
  });

  it("still says no deployment is waiting when there is none in either environment", async () => {
    const res = await upload(creds.previewUploadToken, goodRelease());
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("no_deployment_waiting");
  });
});

describe("POST /api/builds/upload", () => {
  it("attaches a valid upload to the deployment waiting for that commit and answers 202 with its id", async () => {
    const dep = await waitingFor(project);
    const bytes = goodRelease();
    const res = await upload(token, bytes);
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ deployment: { id: dep.id } });
    const got = await readUpload(dep.id);
    expect(got?.meta).toMatchObject({ sha256: sha256Of(bytes), commit: COMMIT, branch: "main", run: "4242", bytes: bytes.length });
    expect(filesInUploads().sort()).toEqual([`${dep.id}.json`, `${dep.id}.tar.gz`]);
  });

  it("writes upload events to the deployment log, with no token and no file path in them", async () => {
    const dep = await waitingFor(project);
    await upload(token, goodRelease());
    const text = await logText(dep.id);
    expect(text).toMatch(/sending the build for commit aaaaaaa/);
    expect(text).toMatch(/Checksum verified/);
    expect(text).toMatch(/attached to this deployment/);
    expect(text).not.toContain(token);
    expect(text).not.toContain(work);
    expect(text).not.toContain(".tar.gz");
  });

  it("refuses a second upload for the same deployment and keeps the first", async () => {
    const dep = await waitingFor(project);
    const first = goodRelease();
    expect((await upload(token, first)).status).toBe(202);
    const second = rawTarGz([{ name: "other.js", content: "different" }]);
    const res = await upload(token, second);
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("already_received");
    expect((await readUpload(dep.id))?.meta.sha256).toBe(sha256Of(first));
    expect(filesInUploads().sort()).toEqual([`${dep.id}.json`, `${dep.id}.tar.gz`]);
    expect(await logText(dep.id)).toMatch(/second build.*rejected/);
  });

  it("refuses two uploads that arrive at the same moment: one wins", async () => {
    const dep = await waitingFor(project);
    const a = goodRelease([{ name: "a.txt", content: "a" }]);
    const b = goodRelease([{ name: "b.txt", content: "b" }]);
    const codes = (await Promise.all([upload(token, a), upload(token, b)])).map((r) => r.status).sort();
    expect(codes).toEqual([202, 409]);
    expect(filesInUploads().sort()).toEqual([`${dep.id}.json`, `${dep.id}.tar.gz`]);
  });

  it("rejects a checksum mismatch with 400 checksum_mismatch and deletes the file", async () => {
    const dep = await waitingFor(project);
    const bytes = goodRelease();
    const res = await upload(token, bytes, { "x-egg-sha256": "0".repeat(64) });
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("checksum_mismatch");
    expect(filesInUploads()).toEqual([]);
    expect(await readUpload(dep.id)).toBeNull();
    expect(await logText(dep.id)).toMatch(/rejected: its checksum did not match/);
  });

  it("rejects an archive over 500 MB by its declared size, before reading it", async () => {
    await waitingFor(project);
    const res = await upload(token, goodRelease(), {}, { "content-length": String(600 * 1024 * 1024) });
    expect(res.status).toBe(413);
    expect((await res.json()).error.code).toBe("too_large");
    expect(filesInUploads()).toEqual([]);
  });

  it("rejects a body that grows past the limit while streaming, and deletes the part-file", async () => {
    const dep = await waitingFor(project);
    const chunk = Buffer.concat([Buffer.from([0x1f, 0x8b]), Buffer.alloc(600)]);
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        for (let i = 0; i < 5; i++) c.enqueue(chunk);
        c.close();
      },
    });
    const err = await acceptUpload({
      projectId: project.id,
      environment: "production",
      headers: { commit: COMMIT, sha256: "0".repeat(64), branch: "main", run: "1" },
      body,
      contentLength: null,
      maxBytes: 2000,
    }).catch((e) => e);
    expect(err).toMatchObject({ status: 413, code: "too_large" });
    expect(filesInUploads()).toEqual([]);
    expect(await logText(dep.id)).toMatch(/rejected: That archive is too large/);
  });

  it("rejects bytes that are not a gzip archive", async () => {
    await waitingFor(project);
    const bytes = Buffer.from("just some text, not an archive");
    const res = await upload(token, bytes);
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("not_gzip");
    expect(filesInUploads()).toEqual([]);
  });

  it("rejects a bad commit, branch, checksum or run header with 400 before anything is stored", async () => {
    await waitingFor(project);
    const bytes = goodRelease();
    const cases: Record<string, string>[] = [
      { "x-egg-commit": "nothex" },
      { "x-egg-commit": "a".repeat(39) },
      { "x-egg-branch": "bad branch" },
      { "x-egg-branch": "-rf" },
      { "x-egg-branch": "x..y" },
      { "x-egg-sha256": "abc" },
      { "x-egg-run": "run-1" },
    ];
    for (const over of cases) {
      const res = await upload(token, bytes, over);
      expect(res.status, JSON.stringify(over)).toBe(400);
      expect((await res.json()).error.code).toBe("invalid_header");
    }
    expect(filesInUploads()).toEqual([]);
  });

  it("answers 409 no_deployment_waiting when nothing is waiting", async () => {
    const res = await upload(token, goodRelease());
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("no_deployment_waiting");
    expect(filesInUploads()).toEqual([]);
  });

  it("answers 409 when the deployment waits for another commit or another branch, or has already finished", async () => {
    const dep = await waitingFor(project, OTHER_COMMIT);
    expect((await upload(token, goodRelease())).status).toBe(409);
    await finish(dep.id, "canceled");
    await waitingFor(project, COMMIT, "other-branch");
    expect((await upload(token, goodRelease())).status).toBe(409);
    const done = await waitingFor(project);
    await finish(done.id, "ready");
    expect((await upload(token, goodRelease())).status).toBe(409);
    expect(filesInUploads()).toEqual([]);
  });

  it("gives a deployment whose commit is not known yet the next build of its branch, and prefers an exact commit match", async () => {
    const open = await waitingFor(project, null);
    const exact = await waitingFor(project, COMMIT);
    const res = await upload(token, goodRelease());
    expect((await res.json()).deployment.id).toBe(exact.id);
    const res2 = await upload(token, goodRelease([{ name: "x", content: "y" }]));
    expect((await res2.json()).deployment.id).toBe(open.id);
  });

  it("works for a deploy started by hand from the dashboard", async () => {
    const dep = await deployBranch(user.id, project.id, "main");
    expect((await upload(token, goodRelease())).status).toBe(202);
    expect(await readUpload(dep.id)).not.toBeNull();
  });

  it("is refused for a project that builds on the container", async () => {
    const boxed = await newProject(`Boxed${port}`);
    const boxedToken = (await createBuildCredentials(boxed.id)).productionUploadToken;
    await enqueueDeployment(boxed, { env: "production", source: "webhook", branch: "main", commitSha: COMMIT });
    const res = await upload(boxedToken, goodRelease());
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("build_location_not_github");
    expect(filesInUploads()).toEqual([]);
  });

  it("never attaches an upload to another project's deployment", async () => {
    const other = await newProject(`Other${port}`, { buildLocation: "github" });
    const mine = await waitingFor(other);
    expect((await upload(token, goodRelease())).status).toBe(409);
    expect(await readUpload(mine.id)).toBeNull();
  });

  it("allows 20 uploads an hour per project, then answers 429 with Retry-After", async () => {
    for (let i = 0; i < 20; i++) expect((await upload(token, goodRelease(), { "x-egg-commit": "x" })).status).toBe(400);
    const res = await upload(token, goodRelease());
    expect(res.status).toBe(429);
    expect(Number(res.headers.get("retry-after"))).toBeGreaterThan(0);
    // Another project is not held back by it.
    const other = await newProject(`Free${port}`, { buildLocation: "github" });
    const otherToken = (await createBuildCredentials(other.id)).productionUploadToken;
    expect((await upload(otherToken, goodRelease())).status).toBe(409);
  });

  it("removes uploads nobody collected when the next one arrives", async () => {
    const stale = path.join(uploadsDir(), "old-deployment.tar.gz");
    (await import("node:fs")).writeFileSync(stale, "x");
    const old = new Date(Date.now() - 4 * 60 * 60_000);
    (await import("node:fs")).utimesSync(stale, old, old);
    await upload(token, goodRelease());
    expect(existsSync(stale)).toBe(false);
  });
});

describe("GET /api/builds/env", () => {
  it("gives the project's variables as JSON with no-store, for the production target by default", async () => {
    await setEnvVar(user.id, project.id, { key: "NEXT_PUBLIC_API", value: "https://api.example.test", target: "all" });
    await setEnvVar(user.id, project.id, { key: "ONLY_PROD", value: "prod-secret-value", target: "production" });
    await setEnvVar(user.id, project.id, { key: "ONLY_PREVIEW", value: "preview-value", target: "preview" });
    const res = await envGet(creds.productionEnvToken);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ NEXT_PUBLIC_API: "https://api.example.test", ONLY_PROD: "prod-secret-value" });
    const preview = await envGet(creds.previewEnvToken, "?env=preview");
    expect(await preview.json()).toEqual({ NEXT_PUBLIC_API: "https://api.example.test", ONLY_PREVIEW: "preview-value" });
  });

  it("answers 401 for a wrong token, with no variable in the body", async () => {
    await setEnvVar(user.id, project.id, { key: "SECRET_ONE", value: "do-not-leak-this", target: "all" });
    const res = await envGet("egg_build_env_production_" + "q".repeat(43));
    expect(res.status).toBe(401);
    expect(await res.text()).not.toContain("do-not-leak-this");
  });

  it("keeps the two environments apart: a preview credential cannot read production, and the other way round", async () => {
    await setEnvVar(user.id, project.id, { key: "ONLY_PROD", value: "prod-secret-value", target: "production" });
    await setEnvVar(user.id, project.id, { key: "ONLY_PREVIEW", value: "preview-value", target: "preview" });
    const wrong = [
      await envGet(creds.previewEnvToken), // production by default
      await envGet(creds.previewEnvToken, "?env=production"),
      await envGet(creds.previewEnvToken, "?env=anything-else"),
      await envGet(creds.productionEnvToken, "?env=preview"),
      await envGet(creds.productionUploadToken),
      await envGet(creds.productionUploadToken, "?env=preview"),
    ];
    for (const res of wrong) {
      const text = await res.text();
      expect(res.status).toBe(401);
      expect(text).toBe(JSON.stringify({ error: { code: "unauthorized", message: "That build credential is not valid." } }));
    }
  });

  it("does not accept an env credential on the upload route", async () => {
    await waitingFor(project);
    await expectSame401(await upload(creds.productionEnvToken, goodRelease()));
    await expectSame401(await upload(creds.previewEnvToken, goodRelease()));
    expect(filesInUploads()).toEqual([]);
  });

  it("only reads the variables of the token's own project", async () => {
    const other = await newProject(`Env${port}`, { buildLocation: "github" });
    await setEnvVar(user.id, other.id, { key: "OTHER_ONLY", value: "other-value", target: "all" });
    expect(await (await envGet(creds.productionEnvToken)).json()).toEqual({});
  });

  it("logs nothing: no console output, deployment log line or audit row holds a value", async () => {
    await setEnvVar(user.id, project.id, { key: "DB_PASSWORD", value: "hunter2-very-secret", target: "all" });
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
    const auditBefore = (await ctx.db.select().from(schema.auditLog)).length;
    try {
      const dep = await waitingFor(project);
      expect((await envGet(creds.productionEnvToken)).status).toBe(200);
      expect((await envGet("wrong")).status).toBe(401);
      const printed = spies.flatMap((s) => s.mock.calls.flat().map(String)).join("\n");
      expect(printed).not.toContain("hunter2-very-secret");
      for (const t of allTokens()) expect(printed).not.toContain(t);
      expect(await logText(dep.id)).not.toContain("hunter2-very-secret");
    } finally {
      spies.forEach((s) => s.mockRestore());
    }
    const rows = await ctx.db.select().from(schema.auditLog);
    expect(rows.length).toBe(auditBefore);
    expect(JSON.stringify(rows)).not.toContain("hunter2-very-secret");
    const logs = await ctx.db.select().from(schema.deploymentLogs);
    expect(JSON.stringify(logs)).not.toContain("hunter2-very-secret");
  });

  it("allows 30 reads an hour per project, then answers 429", async () => {
    for (let i = 0; i < 30; i++) expect((await envGet(creds.productionEnvToken)).status).toBe(200);
    expect((await envGet(creds.productionEnvToken)).status).toBe(429);
  });
});
