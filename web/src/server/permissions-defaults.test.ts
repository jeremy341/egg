import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { upsertUser } from "@/server/auth/session";
import { enableAnalytics } from "@/server/analytics";
import { SCOPES, SHORT_LIVED_SCOPES, createApiToken, createTokenInput, holdsShortLivedScope } from "@/server/api-tokens";
import { schema } from "@/server/db";
import { enableStatusPage } from "@/server/status-page";
import { createProject } from "@/server/projects";
import { createServer } from "@/server/servers";
import { useFreshDb } from "@/server/test/db";

/**
 * Default-deny, checked in one place: what is off for a new server, a new
 * project and a new token. The matrix and the reasons are in
 * docs/design/permissions.md.
 */

let ctx: Awaited<ReturnType<typeof useFreshDb>>;
let userId: string;
let projectId: string;

beforeAll(async () => {
  ctx = await useFreshDb();
  userId = (await upsertUser({ id: "pd1", name: "Pat", email: null, slackId: null })).id;
  const server = await createServer(userId, "pat-d1");
  projectId = (
    await createProject(userId, {
      serverId: server.id,
      name: "App",
      slug: "app",
      port: 3000,
      repoUrl: "https://github.com/pat/app.git",
      runtime: "node",
    })
  ).id;
});
afterAll(async () => {
  await ctx.cleanup();
});

const projectRow = async () =>
  (await ctx.db.select().from(schema.projects).where(eq(schema.projects.id, projectId)).get())!;

describe("a new server", () => {
  it("starts with the terminal, file changes and leftover removal all off", async () => {
    const row = (await ctx.db.select().from(schema.servers).where(eq(schema.servers.nestUsername, "pat-d1")).get())!;
    expect([row.allowTerminal, row.allowFileWrites, row.allowOrphanRemoval]).toEqual([false, false, false]);
  });
});

describe("a new project", () => {
  it("has no analytics, status page, deploy hook or notification webhook", async () => {
    const p = await projectRow();
    expect([p.analyticsKey, p.statusKey, p.hookHash, p.notifyUrlEnc]).toEqual([null, null, null, null]);
  });

  it("keeps those four nullable, with no database default that could switch one on", () => {
    for (const col of [schema.projects.analyticsKey, schema.projects.statusKey, schema.projects.hookHash, schema.projects.notifyUrlEnc]) {
      expect(col.notNull).toBe(false);
      expect(col.default).toBeUndefined();
    }
  });

  it("turns analytics on without turning the status page on, and the other way round", async () => {
    await enableAnalytics(userId, projectId);
    let p = await projectRow();
    expect(p.analyticsKey).toBeTruthy();
    expect(p.statusKey).toBeNull();
    await enableStatusPage(userId, projectId);
    p = await projectRow();
    expect(p.analyticsKey).toBeTruthy();
    expect(p.statusKey).toBeTruthy();
    expect(p.hookHash).toBeNull();
    expect(p.notifyUrlEnc).toBeNull();
  });

  it("still has auto deploy on by default (open decision: see docs/design/permissions.md)", () => {
    expect(schema.projects.autoDeploy.default).toBe(true);
  });
});

describe("a new token", () => {
  it("must be given scopes on purpose: none is the default", () => {
    expect(createTokenInput.safeParse({ name: "ci" }).success).toBe(false);
    expect(createTokenInput.safeParse({ name: "ci", scopes: [] }).success).toBe(false);
  });

  it("only holds the scopes that were asked for", async () => {
    const { token } = await createApiToken(userId, { name: "deploy", scopes: ["projects:read", "deployments:write"] });
    expect(token.scopes).toEqual(["projects:read", "deployments:write"]);
    expect(holdsShortLivedScope(token.scopes)).toBe(false);
  });

  it("is not given the terminal or file changes by the Read only set (every :read scope)", () => {
    const readOnly = SCOPES.filter((s) => s.endsWith(":read"));
    expect(readOnly.length).toBeGreaterThan(0);
    expect(readOnly.some((s) => (SHORT_LIVED_SCOPES as readonly string[]).includes(s))).toBe(false);
  });

  it("treats exactly the terminal and file change scopes as container scopes, capped at 7 days", async () => {
    expect([...SHORT_LIVED_SCOPES].sort()).toEqual(["files:write", "terminal:use"]);
    await expect(
      createApiToken(userId, { name: "long", scopes: ["terminal:use"], expiresInDays: 90 })
    ).rejects.toThrow(/7 days/);
    const { token } = await createApiToken(userId, { name: "short", scopes: ["files:write"] });
    const days = (new Date(token.expiresAt).getTime() - new Date(token.createdAt).getTime()) / 86_400_000;
    expect(days).toBe(7);
  });

  it("has no scope that reaches leftover removal or the container switches", () => {
    expect(SCOPES.some((s) => /orphan|leftover|permission/i.test(s))).toBe(false);
  });
});
