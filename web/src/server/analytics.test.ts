import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { upsertUser } from "@/server/auth/session";
import { enableAnalytics, KEY_PREFIX, snippet } from "@/server/analytics";
import { schema } from "@/server/db";
import { createProject, type ProjectRow } from "@/server/projects";
import { createServer } from "@/server/servers";
import { useFreshDb } from "@/server/test/db";

let ctx: Awaited<ReturnType<typeof useFreshDb>>;
let userId: string;
let serverId: string;
let n = 0;

const base = {
  repoUrl: "https://github.com/example/demo",
  runtime: "node" as const,
  startCommand: "node server.js",
};

const makeProject = () => {
  n += 1;
  return createProject(userId, { ...base, serverId, name: `Analytics ${n}`, port: 3500 + n });
};

async function enableAudits(projectId: string) {
  return ctx.db
    .select()
    .from(schema.auditLog)
    .where(and(eq(schema.auditLog.action, "analytics.enable"), eq(schema.auditLog.target, projectId)));
}

beforeAll(async () => {
  ctx = await useFreshDb();
  userId = (await upsertUser({ id: "analytics-owner", name: "Analytics", email: null, slackId: null })).id;
  serverId = (await createServer(userId, "analytics-server")).id;
});

afterAll(async () => {
  await ctx.cleanup();
});

describe("enableAnalytics", () => {
  it("gives two concurrent first enables the same persisted key and audits once", async () => {
    const project: ProjectRow = await makeProject();
    const [a, b] = await Promise.all([
      enableAnalytics(userId, project.id),
      enableAnalytics(userId, project.id),
    ]);

    expect(a.key).toBe(b.key);
    expect(a.snippet).toBe(b.snippet);
    expect(a.key).toMatch(new RegExp(`^${KEY_PREFIX}`));
    expect(a.snippet).toBe(snippet(a.key));

    const stored = await ctx.db
      .select({ analyticsKey: schema.projects.analyticsKey })
      .from(schema.projects)
      .where(eq(schema.projects.id, project.id))
      .get();
    expect(stored?.analyticsKey).toBe(a.key);
    expect(await enableAudits(project.id)).toHaveLength(1);
  });

  it("returns the stored key again without re-auditing or changing it", async () => {
    const project: ProjectRow = await makeProject();
    const first = await enableAnalytics(userId, project.id);
    const second = await enableAnalytics(userId, project.id);

    expect(second.key).toBe(first.key);
    expect(second.snippet).toBe(first.snippet);
    const stored = await ctx.db
      .select({ analyticsKey: schema.projects.analyticsKey })
      .from(schema.projects)
      .where(eq(schema.projects.id, project.id))
      .get();
    expect(stored?.analyticsKey).toBe(first.key);
    expect(await enableAudits(project.id)).toHaveLength(1);
  });
});
