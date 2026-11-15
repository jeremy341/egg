import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { upsertUser } from "@/server/auth/session";
import { schema } from "@/server/db";
import { handleGithubEvent } from "@/server/github/webhook";
import { createProject } from "@/server/projects";
import { createServer } from "@/server/servers";
import { useFreshDb } from "@/server/test/db";

let ctx: Awaited<ReturnType<typeof useFreshDb>>;
let alice: { id: string };
let bob: { id: string };
let aliceServer: string;
let port = 3300;

const SHA = "b".repeat(40);

function push(fullName: string, installationId?: number) {
  return {
    ref: "refs/heads/main",
    after: SHA,
    repository: { full_name: fullName },
    head_commit: { message: "ship it", author: { username: "someone" } },
    ...(installationId ? { installation: { id: installationId } } : {}),
  };
}

async function importRepo(repoFullName: string, urlPath = repoFullName) {
  return createProject(alice.id, {
    serverId: aliceServer,
    name: `Repo ${port}`,
    repoUrl: `https://github.com/${urlPath}`,
    repoFullName,
    runtime: "node",
    port: port++,
  });
}

beforeAll(async () => {
  ctx = await useFreshDb();
  alice = await upsertUser({ id: "edge-gh-alice", name: "Alice", email: null, slackId: null });
  bob = await upsertUser({ id: "edge-gh-bob", name: "Bob", email: null, slackId: null });
  aliceServer = (await createServer(alice.id, "edge-alice")).id;
  await ctx.db.insert(schema.githubInstallations).values([
    { id: 1001, userId: alice.id, accountLogin: "alice", accountType: "User", createdAt: new Date() },
    { id: 2002, userId: bob.id, accountLogin: "bob", accountType: "User", createdAt: new Date() },
  ]);
});

afterAll(async () => {
  await ctx.cleanup();
});

describe("push events", () => {
  it("only deploy a project for an installation its owner linked", async () => {
    // A public repository imported by URL has no installation id of its own.
    const project = await importRepo("alice/spoofed");

    // Control: the owner's own installation does deploy it.
    const own = await handleGithubEvent("push", push("alice/spoofed", 1001));
    expect(own.deployments).toHaveLength(1);
    await ctx.db.update(schema.deployments).set({ state: "ready" }).where(eq(schema.deployments.projectId, project.id));

    // Bob installs the App on a repository that took over the name alice/spoofed. His signed
    // event carries his installation id, which belongs to a different account.
    const foreign = await handleGithubEvent("push", push("alice/spoofed", 2002));
    expect(foreign.deployments).toEqual([]);
  });

  it("match the repository name without regard to letter case", async () => {
    // The project stores the name as the importer typed it; GitHub sends its canonical spelling.
    await importRepo("alice/case-test");
    const result = await handleGithubEvent("push", push("Alice/Case-Test", 1001));
    expect(result.deployments).toHaveLength(1);
  });
});

describe("a repository renamed on GitHub", () => {
  it("keeps auto deploy working under the new name", async () => {
    const project = await importRepo("alice/old-name");

    await handleGithubEvent("repository", {
      action: "renamed",
      changes: { repository: { name: { from: "old-name" } } },
      repository: { full_name: "alice/new-name" },
      installation: { id: 1001 },
    });
    const after = await handleGithubEvent("push", push("alice/new-name", 1001));

    expect(after.deployments).toHaveLength(1);
    const row = await ctx.db.select().from(schema.projects).where(eq(schema.projects.id, project.id)).get();
    expect(row?.repoFullName).toBe("alice/new-name");
  });
});
