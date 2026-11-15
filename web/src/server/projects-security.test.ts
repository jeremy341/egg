import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { upsertUser } from "@/server/auth/session";
import { getDb, schema } from "@/server/db";
import { HttpError } from "@/server/http";
import { createProject } from "@/server/projects";
import { createServer } from "@/server/servers";
import { useFreshDb } from "@/server/test/db";

let ctx: Awaited<ReturnType<typeof useFreshDb>>;
let sam: string;
let alex: string;
let samServer: string;

beforeAll(async () => {
  ctx = await useFreshDb();
  sam = (await upsertUser({ id: "u1", name: "Sam", email: null, slackId: null })).id;
  alex = (await upsertUser({ id: "u2", name: "Alex", email: null, slackId: null })).id;
  samServer = (await createServer(sam, "sam-r")).id;
  const db = await getDb();
  await db.insert(schema.githubInstallations).values({
    id: 777,
    userId: alex,
    accountLogin: "alex",
    accountType: "User",
    createdAt: new Date(),
  });
  await db.insert(schema.githubInstallations).values({
    id: 888,
    userId: sam,
    accountLogin: "sam",
    accountType: "User",
    createdAt: new Date(),
  });
});
afterAll(async () => {
  await ctx.cleanup();
});

const base = (over: Record<string, unknown>) => ({
  serverId: samServer,
  name: "App",
  repoUrl: "https://github.com/alex/private.git",
  runtime: "node" as const,
  port: 3000,
  ...over,
});

describe("createProject and GitHub installations", () => {
  it("refuses an installation that belongs to someone else", async () => {
    const err: unknown = await createProject(sam, base({ slug: "stolen", installationId: 777 })).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HttpError);
    expect((err as HttpError).status).toBe(403);
  });

  it("refuses an installation id that nobody linked", async () => {
    const err: unknown = await createProject(sam, base({ slug: "ghost", installationId: 999999 })).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HttpError);
    expect((err as HttpError).status).toBe(403);
  });

  it("accepts an installation the user linked", async () => {
    const p = await createProject(sam, base({ slug: "mine", installationId: 888, repoUrl: "https://github.com/sam/app.git", port: 3100 }));
    expect(p.installationId).toBe(888);
  });

  it("still creates a project with no installation", async () => {
    const p = await createProject(sam, base({ slug: "public", repoUrl: "https://github.com/sam/pub.git", port: 3200 }));
    expect(p.installationId).toBeNull();
  });

  it("refuses a repository name that does not match the repository URL", async () => {
    const err: unknown = await createProject(
      sam,
      base({ slug: "liar", repoUrl: "https://github.com/sam/mine.git", repoFullName: "alex/private", port: 3300 })
    ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HttpError);
    expect((err as HttpError).status).toBe(400);
  });

  it("accepts a matching repository name, ignoring case and .git", async () => {
    const p = await createProject(
      sam,
      base({ slug: "match", repoUrl: "https://github.com/Sam/Match.git", repoFullName: "sam/match", port: 3400 })
    );
    expect(p.repoFullName).toBe("sam/match");
  });
});
