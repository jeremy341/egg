import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createApiToken, type Scope } from "@/server/api-tokens";
import { upsertUser } from "@/server/auth/session";
import { schema } from "@/server/db";
import { createProject, deployBranch, setEnvVar } from "@/server/projects";
import { rateLimiter } from "@/server/rate-limit";
import { createServer } from "@/server/servers";
import { useFreshDb } from "@/server/test/db";

// The routes are real. Only who is signed in is replaced.
vi.mock("@/server/auth/current", () => ({ getCurrentUser: vi.fn(), requireUser: vi.fn() }));

import { getCurrentUser } from "@/server/auth/current";
import { GET as activityExport } from "@/app/api/activity/export/route";
import { GET as deploymentsExport } from "@/app/api/projects/[id]/deployments/export/route";
import { GET as v1DeploymentsExport } from "@/app/api/v1/projects/[projectId]/deployments/export/route";

let ctx: Awaited<ReturnType<typeof useFreshDb>>;
let me: { id: string };
let other: { id: string };
let projectId: string;
let theirProjectId: string;
let deploymentId: string;

const get = (path: string, headers: Record<string, string> = {}) =>
  new NextRequest(`http://localhost:3000${path}`, { headers });
type Handler = (req: NextRequest, c: { params: Promise<Record<string, string>> }) => Promise<Response>;
const run = (h: Handler, req: NextRequest, params: Record<string, string> = {}) =>
  h(req, { params: Promise.resolve(params) });
const signIn = (user: { id: string } | null) =>
  vi.mocked(getCurrentUser).mockResolvedValue(user ? ({ id: user.id, name: "Sam" } as never) : null);
const lines = (csv: string) => csv.split("\r\n").filter(Boolean);

async function entry(userId: string, action: string, meta: Record<string, unknown> | null = null, at = new Date()) {
  await ctx.db.insert(schema.auditLog).values({ userId, action, target: projectId, meta: meta ? JSON.stringify(meta) : null, at });
}

beforeAll(async () => {
  ctx = await useFreshDb();
  me = await upsertUser({ id: "exp-1", name: "Sam", email: null, slackId: null });
  other = await upsertUser({ id: "exp-2", name: "Kim", email: null, slackId: null });
  const base = { repoUrl: "https://github.com/sam/app.git", runtime: "node" as const };
  const myServer = (await createServer(me.id, "sam-api")).id;
  const theirServer = (await createServer(other.id, "kim-api")).id;
  projectId = (await createProject(me.id, { ...base, serverId: myServer, name: "Billing API", slug: "billing-api", port: 3000 })).id;
  theirProjectId = (await createProject(other.id, { ...base, serverId: theirServer, name: "Theirs", slug: "theirs", port: 3001 })).id;
  deploymentId = (await deployBranch(me.id, projectId)).id;
  await deployBranch(other.id, theirProjectId);
  await setEnvVar(me.id, projectId, { key: "DATABASE_URL", value: "postgres://u:pw-very-secret@db/x", target: "all" });
  await ctx.db.insert(schema.deploymentLogs).values({ deploymentId, at: new Date(), message: "LOG-LINE-SHOULD-NOT-EXPORT" });
});

afterAll(async () => {
  await ctx.cleanup();
});

beforeEach(async () => {
  await ctx.db.delete(schema.auditLog);
  await ctx.db.delete(schema.apiTokens);
  rateLimiter().clear();
  vi.mocked(getCurrentUser).mockReset();
  signIn(me);
});

describe("GET /api/activity/export", () => {
  it("needs a signed-in user", async () => {
    signIn(null);
    const res = await run(activityExport as Handler, get("/api/activity/export"));
    expect(res.status).toBe(401);
  });

  it("returns the signed-in user's activity as a CSV download", async () => {
    await entry(me.id, "deploy.redeploy", { branch: "main" });
    await entry(other.id, "deploy.redeploy", { branch: "someone-elses" });
    const res = await run(activityExport as Handler, get("/api/activity/export"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(res.headers.get("content-disposition")).toMatch(/^attachment; filename="activity-\d{4}-\d{2}-\d{2}\.csv"$/);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    const csv = await res.text();
    expect(lines(csv)[0]).toBe('"Time (UTC)","Kind","Action","Description","Target","Details","Access token","Entry id"');
    expect(lines(csv)).toHaveLength(2);
    expect(csv).toContain('"deploy.redeploy"');
    expect(csv).toContain("from branch main");
    expect(csv).not.toContain("someone-elses");
  });

  it("applies the page's filters from the query string", async () => {
    await entry(me.id, "deploy.redeploy", { branch: "main" });
    await entry(me.id, "domain.add", { domain: "shop.example.com" });
    await entry(me.id, "domain.add", { domain: "old.example.com" }, new Date(Date.now() - 3 * 86_400_000));

    const kind = await (await run(activityExport as Handler, get("/api/activity/export?kind=domains"))).text();
    expect(lines(kind)).toHaveLength(3);
    expect(kind).not.toContain("deploy.redeploy");

    const range = await (await run(activityExport as Handler, get("/api/activity/export?kind=domains&range=24h"))).text();
    expect(lines(range)).toHaveLength(2);
    expect(range).toContain("shop.example.com");

    const q = await (await run(activityExport as Handler, get("/api/activity/export?q=old.example"))).text();
    expect(lines(q)).toHaveLength(2);
    expect(q).toContain("old.example.com");
  });

  it("drops secrets the way the activity page does and neutralises formulas", async () => {
    await entry(me.id, "project.update", {
      password: "hunter2-plain",
      apiKey: "abc",
      note: "ghp_abcdefghijklmnopqrstuvwxyz0123456789",
      fields: "=HYPERLINK(\"http://evil\")",
    });
    const csv = await (await run(activityExport as Handler, get("/api/activity/export"))).text();
    expect(csv).not.toContain("hunter2");
    expect(csv).not.toContain("ghp_");
    expect(csv).not.toMatch(/apiKey|api key/i);
    expect(csv).not.toMatch(/(^|,)"=/m);
  });

  it("stops at 5000 rows and says so", async () => {
    const now = Date.now();
    const rows = Array.from({ length: 5001 }, (_, i) => ({
      userId: me.id,
      action: "deploy.redeploy",
      target: projectId,
      meta: null,
      at: new Date(now - i * 1000),
    }));
    for (let i = 0; i < rows.length; i += 500) await ctx.db.insert(schema.auditLog).values(rows.slice(i, i + 500));
    const res = await run(activityExport as Handler, get("/api/activity/export"));
    expect(res.headers.get("x-export-truncated")).toBe("true");
    expect(lines(await res.text())).toHaveLength(5001);
  }, 30_000);

  it("is rate limited per user", async () => {
    const codes: number[] = [];
    for (let i = 0; i < 11; i++) codes.push((await run(activityExport as Handler, get("/api/activity/export"))).status);
    expect(codes.slice(0, 10).every((c) => c === 200)).toBe(true);
    expect(codes[10]).toBe(429);
  });
});

describe("GET /api/projects/[id]/deployments/export", () => {
  it("needs a signed-in user", async () => {
    signIn(null);
    const res = await run(deploymentsExport as Handler, get(`/api/projects/${projectId}/deployments/export`), { id: projectId });
    expect(res.status).toBe(401);
  });

  it("is 404 for someone else's project", async () => {
    const res = await run(deploymentsExport as Handler, get(`/api/projects/${theirProjectId}/deployments/export`), { id: theirProjectId });
    expect(res.status).toBe(404);
  });

  it("returns the project's deployments with only the agreed columns", async () => {
    const res = await run(deploymentsExport as Handler, get(`/api/projects/${projectId}/deployments/export`), { id: projectId });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(res.headers.get("content-disposition")).toMatch(/^attachment; filename="billing-api-deployments-\d{4}-\d{2}-\d{2}\.csv"$/);
    const csv = await res.text();
    const [header, row, ...rest] = lines(csv);
    expect(header).toBe('"Created (UTC)","Commit","Branch","Environment","State","Duration (seconds)","Deployment id"');
    expect(rest).toEqual([]);
    expect(row).toMatch(/^"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z","","main","production","queued","","/);
    expect(row.endsWith(`"${deploymentId}"`)).toBe(true);
    expect(csv).not.toContain("pw-very-secret");
    expect(csv).not.toContain("DATABASE_URL");
    expect(csv).not.toContain("LOG-LINE");
  });
});

describe("GET /api/v1/projects/{projectId}/deployments/export", () => {
  const token = async (scopes: Scope[], userId = me.id) => (await createApiToken(userId, { name: "t", scopes })).secret;
  const call = (id: string, secret?: string) =>
    run(
      v1DeploymentsExport as Handler,
      get(`/api/v1/projects/${id}/deployments/export`, secret ? { authorization: `Bearer ${secret}` } : {}),
      { projectId: id }
    );

  it("ignores the browser session and needs a bearer token", async () => {
    const res = await call(projectId);
    expect(res.status).toBe(401);
    expect(getCurrentUser).not.toHaveBeenCalled();
  });

  it("needs the deployments:read scope", async () => {
    const res = await call(projectId, await token(["projects:read"]));
    expect(res.status).toBe(403);
  });

  it("is 404 for someone else's project", async () => {
    const res = await call(theirProjectId, await token(["deployments:read"]));
    expect(res.status).toBe(404);
  });

  it("returns the same CSV as the dashboard export", async () => {
    const res = await call(projectId, await token(["deployments:read"]));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    const csv = await res.text();
    expect(lines(csv)).toHaveLength(2);
    expect(csv).toContain(deploymentId);
  });
});
