import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Principal, Scope } from "@/server/api-tokens";
import { ENDPOINTS, callEndpoint } from "@/server/api-v1";
import { upsertUser } from "@/server/auth/session";
import { schema } from "@/server/db";
import { createProject, deployBranch } from "@/server/projects";
import { createServer } from "@/server/servers";
import { useFreshDb } from "@/server/test/db";

let ctx: Awaited<ReturnType<typeof useFreshDb>>;
let me: { id: string };
let other: { id: string };
let projectId: string;
let theirProjectId: string;
let deploymentId: string;

const foundEndpoint = () => {
  const endpoint = ENDPOINTS.find((candidate) => candidate.id === "get_changes");
  expect(endpoint, "get_changes should be registered in ENDPOINTS").toBeDefined();
  return endpoint!;
};

const principal = (userId: string, scopes: Scope[] = ["activity:read"]): Principal => ({
  userId,
  tokenId: "changes-test-token",
  scopes,
});

type Change = {
  time: string;
  kind: string;
  actor: string;
  summary: string;
  deploymentId?: string;
};
type Page = { items: Change[]; nextCursor: string | null };

const run = async (
  input: Record<string, unknown> = {},
  userId = me.id,
  scopes: Scope[] = ["activity:read"]
) => (await callEndpoint(principal(userId, scopes), foundEndpoint(), { projectId, ...input })) as Page;

async function row(
  userId: string,
  action: string,
  target: string | null,
  at: Date,
  meta: Record<string, unknown> = {}
) {
  await ctx.db.insert(schema.auditLog).values({ userId, action, target, at, meta: JSON.stringify(meta) });
}

beforeAll(async () => {
  ctx = await useFreshDb();
  me = await upsertUser({ id: "changes-1", name: "Sam", email: null, slackId: null });
  other = await upsertUser({ id: "changes-2", name: "Kim", email: null, slackId: null });
  const myServerId = (await createServer(me.id, "changes-sam")).id;
  const theirServerId = (await createServer(other.id, "changes-kim")).id;
  const projectInput = { repoUrl: "https://github.com/sam/app.git", runtime: "node" as const };
  projectId = (
    await createProject(me.id, { ...projectInput, serverId: myServerId, name: "App", slug: "app", port: 3000 })
  ).id;
  theirProjectId = (
    await createProject(other.id, { ...projectInput, serverId: theirServerId, name: "Theirs", slug: "theirs", port: 3001 })
  ).id;
  deploymentId = (await deployBranch(me.id, projectId)).id;

  await ctx.db.delete(schema.auditLog);
  const base = Date.now() - 60_000;
  await row(me.id, "project.update", projectId, new Date(base + 4_000), { fields: "port" });
  await row(me.id, "env.set", projectId, new Date(base + 3_000), {
    name: "DATABASE_URL\nINJECTED",
    target: "production",
    value: "RAW_ENV_VALUE_SHOULD_NEVER_APPEAR",
  });
  await row(me.id, "deploy.rollback", projectId, new Date(base + 2_000), { deploymentId, sha: "abc123" });
  await row(me.id, "unknown.noop", projectId, new Date(base + 1_000));
  // A malformed cross-project target must not bleed into this project's feed.
  await row(me.id, "project.update", theirProjectId, new Date(base + 5_000), { fields: "name" });
});

afterAll(async () => {
  await ctx.cleanup();
});

describe("the project changes feed endpoint", () => {
  it("is a project-scoped read endpoint using activity:read", () => {
    const endpoint = foundEndpoint();
    expect(endpoint).toMatchObject({
      method: "GET",
      path: "/projects/{projectId}/changes",
      scope: "activity:read",
      bucket: "read",
      tag: "Activity",
      readOnly: true,
      destructive: false,
    });
  });

  it("returns only change kinds, newest first, for the requested project", async () => {
    const page = await run();
    expect(page.items.map((item) => item.kind)).toEqual(["projects", "projects", "deployments"]);
    expect(page.items.map((item) => item.actor)).toEqual(["Sam", "Sam", "Sam"]);
    expect(page.items[0].summary).toContain("App");
    expect(page.items.map((item) => item.summary).join(" ")).not.toContain("Theirs");
    expect(page.items.map((item) => item.time)).toEqual([...page.items.map((item) => item.time)].sort().reverse());
  });

  it("includes environment key names without returning environment values", async () => {
    const page = await run();
    const env = page.items.find((item) => item.summary.includes("DATABASE_URL"));
    expect(env).toBeDefined();
    expect(JSON.stringify(env)).not.toContain("RAW_ENV_VALUE_SHOULD_NEVER_APPEAR");
    expect(env).not.toHaveProperty("value");
  });

  it("keeps summaries on one line", async () => {
    const page = await run();
    expect(page.items.every((item) => !/[\r\n]/.test(item.summary))).toBe(true);
  });

  it("returns a deployment id only when the audit row names one for this project", async () => {
    const page = await run();
    expect(page.items.find((item) => item.kind === "deployments")).toMatchObject({ deploymentId });
  });

  it("pages newest-first changes with a bounded limit and cursor", async () => {
    const first = await run({ limit: 2 });
    expect(first.items).toHaveLength(2);
    expect(first.nextCursor).toMatch(/^\d{1,15}\.\d{1,12}$/);

    const second = await run({ limit: 2, cursor: first.nextCursor });
    expect(second.items).toHaveLength(1);
    expect(second.items[0].kind).toBe("deployments");
    expect(second.nextCursor).toBeNull();
  });

  it("requires activity:read before reading changes", async () => {
    await expect(run({}, me.id, ["projects:read"])).rejects.toMatchObject({ status: 403 });
  });

  it("returns 404 when the caller does not own the requested project", async () => {
    await expect(
      callEndpoint(principal(me.id), foundEndpoint(), { projectId: theirProjectId })
    ).rejects.toMatchObject({ status: 404 });
  });
});
