import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { upsertUser } from "@/server/auth/session";
import { schema } from "@/server/db";
import { createProject } from "@/server/projects";
import { createServer } from "@/server/servers";
import { useFreshDb } from "@/server/test/db";
import { handleGithubEvent } from "@/server/github/webhook";

// Flip maintenance on only after the dispatcher's first check, so the handlers'
// own re-check is the thing under test.
const gate = vi.hoisted(() => ({ calls: 0, activeAfter: 1 }));
vi.mock("@/server/maintenance", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/maintenance")>();
  return {
    ...actual,
    maintenanceState: async () => {
      gate.calls++;
      const base = await actual.maintenanceState();
      return { ...base, active: gate.calls > gate.activeAfter };
    },
  };
});

let ctx: Awaited<ReturnType<typeof useFreshDb>>;
let owner: string;
let projectId: string;

beforeAll(async () => {
  ctx = await useFreshDb();
  owner = (await upsertUser({ id: "recheck-owner", name: "Owner", email: null, slackId: null })).id;
  const server = await createServer(owner, "recheck-r");
  projectId = (await createProject(owner, {
    serverId: server.id, name: "Recheck", slug: "recheck", repoUrl: "https://github.com/sample/app.git",
    runtime: "node", port: 3000,
  })).id;
  await ctx.db.update(schema.projects)
    .set({ repoFullName: "sample/app", installationId: 777, autoDeploy: true })
    .where(eq(schema.projects.id, projectId));
  await ctx.db.insert(schema.githubInstallations).values({
    id: 777, userId: owner, accountLogin: "sample", accountType: "User", createdAt: new Date(),
  });
});
afterAll(async () => ctx.cleanup());
beforeEach(() => { gate.calls = 0; });

describe("maintenance re-check inside mutating GitHub handlers", () => {
  it("does not delete an installation when maintenance activates after the dispatcher check", async () => {
    await expect(handleGithubEvent("installation", {
      action: "deleted", installation: { id: 777 },
    })).rejects.toMatchObject({ status: 503, code: "maintenance" });
    expect(await ctx.db.select().from(schema.githubInstallations).where(eq(schema.githubInstallations.id, 777)).get()).toBeTruthy();
    expect((await ctx.db.select().from(schema.projects).where(eq(schema.projects.id, projectId)).get())?.installationId).toBe(777);
  });

  it("does not rewrite a repository when maintenance activates after the dispatcher check", async () => {
    await expect(handleGithubEvent("repository", {
      action: "renamed", installation: { id: 777 },
      repository: { full_name: "sample/renamed" },
      changes: { repository: { name: { from: "app" } } },
    })).rejects.toMatchObject({ status: 503, code: "maintenance" });
    expect((await ctx.db.select().from(schema.projects).where(eq(schema.projects.id, projectId)).get())?.repoFullName).toBe("sample/app");
  });
});
