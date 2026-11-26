import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import { NextRequest } from "next/server";
import { upsertUser } from "@/server/auth/session";
import { schema } from "@/server/db";
import { createProject } from "@/server/projects";
import { createServer } from "@/server/servers";
import { saveInstallations } from "@/server/github/app";
import { useFreshDb } from "@/server/test/db";

vi.mock("@/server/auth/current", () => ({ getCurrentUser: vi.fn(), requireUser: vi.fn() }));
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), connection: async () => undefined }));
// The cache directive only works inside Next; here the cached function is the plain builder.
vi.mock("@/server/public-feed-cache", async () => {
  const { buildPublicFeed } = await import("@/server/public-feed");
  return {
    getPublicFeed: () => buildPublicFeed({ visibility: async (_i, repo) => globalThis.__feedVisibility?.get(repo) ?? "unknown" }),
  };
});

import { getCurrentUser } from "@/server/auth/current";
import { buildPublicFeed, FEED_SIZE, oneLine, setHomepageFeed, toFeedRow, type FeedRow } from "@/server/public-feed";
import { rateLimiter } from "@/server/rate-limit";
import { GET as feedRoute } from "@/app/api/public/deployments/route";
import { DELETE as optOut, POST as optIn } from "@/app/api/projects/[id]/homepage-feed/route";

declare global {
  var __feedVisibility: Map<string, "public" | "private" | "unknown"> | undefined;
}
const VISIBILITY = (globalThis.__feedVisibility = new Map<string, "public" | "private" | "unknown">());
const check = async (_installation: number, repo: string) => VISIBILITY.get(repo) ?? "unknown";

let ctx: Awaited<ReturnType<typeof useFreshDb>>;
let sam: { id: string };
let kim: { id: string };
let serverId: string;
let n = 0;

beforeAll(async () => {
  ctx = await useFreshDb();
  sam = await upsertUser({ id: "pf1", name: "Sam", email: null, slackId: null });
  kim = await upsertUser({ id: "pf2", name: "Kim", email: null, slackId: null });
  serverId = (await createServer(sam.id, "sam-r")).id;
  await saveInstallations(sam.id, [{ id: 501, login: "sam", type: "User" }]);
});
afterAll(async () => {
  await ctx.cleanup();
});
beforeEach(() => {
  vi.mocked(getCurrentUser).mockResolvedValue(sam as never);
  rateLimiter().clear();
});

async function project(repo: string | null, opts: { feed?: boolean; installationId?: number | null } = {}) {
  const idx = ++n;
  const p = await createProject(sam.id, {
    serverId,
    name: `P${idx}`,
    repoUrl: `https://github.com/${repo ?? "x/y"}`,
    repoFullName: repo ?? undefined,
    installationId: opts.installationId === undefined ? 501 : (opts.installationId ?? undefined),
    runtime: "node",
    port: 4000 + idx,
  });
  if (opts.feed) await ctx.db.update(schema.projects).set({ homepageFeed: true }).where(eq(schema.projects.id, p.id));
  return p;
}

let depSeq = 0;
async function deploy(projectId: string, over: Partial<typeof schema.deployments.$inferInsert> = {}) {
  const id = `dep-${++depSeq}`;
  await ctx.db.insert(schema.deployments).values({
    id,
    projectId,
    env: "production",
    state: "ready",
    source: "webhook",
    branch: "main",
    commitSha: "a".repeat(40),
    commitMessage: "Fix the thing",
    author: "secret-author",
    port: 4999,
    releaseId: `rel-${id}`,
    error: "SECRET error text with /home/sam/path",
    createdAt: new Date(Date.UTC(2026, 10, 1, 12, 0, depSeq)),
    ...over,
  });
  return id;
}

describe("the migration", () => {
  it("adds projects.homepage_feed, off for every project", async () => {
    const cols = await ctx.db.all<{ name: string; notnull: number; dflt_value: string | null }>(sql`PRAGMA table_info(projects)`);
    const col = cols.find((c) => c.name === "homepage_feed");
    expect(col).toMatchObject({ notnull: 1, dflt_value: "0" });
    const p = await project("sam/fresh");
    const row = await ctx.db.select().from(schema.projects).where(eq(schema.projects.id, p.id)).get();
    expect(row?.homepageFeed).toBe(false);
  });
});

describe("the feed", () => {
  beforeEach(async () => {
    await ctx.db.delete(schema.deployments);
    await ctx.db.update(schema.projects).set({ homepageFeed: false });
    VISIBILITY.clear();
  });

  it("lists only deployments of opted-in projects whose repository is public", async () => {
    const open = await project("sam/open", { feed: true });
    const off = await project("sam/off");
    const secret = await project("sam/secret", { feed: true });
    const unknown = await project("sam/unknown", { feed: true });
    VISIBILITY.set("sam/open", "public");
    VISIBILITY.set("sam/off", "public");
    VISIBILITY.set("sam/secret", "private");
    // sam/unknown has no answer: unknown.
    await deploy(open.id, { commitMessage: "open one" });
    await deploy(off.id, { commitMessage: "not opted in" });
    await deploy(secret.id, { commitMessage: "private repo" });
    await deploy(unknown.id, { commitMessage: "unknown repo" });

    const rows = await buildPublicFeed({ visibility: check });
    expect(rows.map((r) => r.message)).toEqual(["open one"]);
    expect(rows[0].repo).toBe("sam/open");
  });

  it("drops a repository that becomes private, at the next build of the feed", async () => {
    const p = await project("sam/turns", { feed: true });
    await deploy(p.id);
    VISIBILITY.set("sam/turns", "public");
    expect(await buildPublicFeed({ visibility: check })).toHaveLength(1);
    VISIBILITY.set("sam/turns", "private");
    expect(await buildPublicFeed({ visibility: check })).toEqual([]);
  });

  it("fails closed when the visibility check throws", async () => {
    const p = await project("sam/boom", { feed: true });
    await deploy(p.id);
    const rows = await buildPublicFeed({
      visibility: async () => {
        throw new Error("GitHub is down");
      },
    });
    expect(rows).toEqual([]);
  });

  it("skips opted-in projects with no GitHub App link", async () => {
    const noInstall = await project("sam/noinstall", { feed: true, installationId: null });
    const noRepo = await project(null, { feed: true });
    await deploy(noInstall.id);
    await deploy(noRepo.id);
    VISIBILITY.set("sam/noinstall", "public");
    expect(await buildPublicFeed({ visibility: check })).toEqual([]);
  });

  it("asks GitHub once per repository", async () => {
    const a = await project("sam/shared", { feed: true });
    const b = await project("sam/shared", { feed: true });
    await deploy(a.id);
    await deploy(b.id);
    const asked: string[] = [];
    await buildPublicFeed({
      visibility: async (_i, repo) => {
        asked.push(repo);
        return "public";
      },
    });
    expect(asked).toEqual(["sam/shared"]);
  });

  it("returns the newest rows first, at most the feed size, without canceled or commit-less deployments", async () => {
    const p = await project("sam/many", { feed: true });
    VISIBILITY.set("sam/many", "public");
    for (let i = 0; i < FEED_SIZE + 4; i++) await deploy(p.id, { commitMessage: `commit ${i}` });
    await deploy(p.id, { commitMessage: "canceled", state: "canceled" });
    await deploy(p.id, { commitMessage: "no sha", commitSha: null });
    await deploy(p.id, { commitMessage: null });
    await deploy(p.id, { commitMessage: "   " });
    const rows = await buildPublicFeed({ visibility: check });
    expect(rows).toHaveLength(FEED_SIZE);
    expect(rows[0].message).toBe(`commit ${FEED_SIZE + 3}`);
    expect(rows.map((r) => r.message)).not.toContain("canceled");
    expect(rows.map((r) => r.message)).not.toContain("no sha");
  });

  it("exposes exactly the public keys and no project, server, user or log data", async () => {
    const p = await project("sam/keys", { feed: true });
    VISIBILITY.set("sam/keys", "public");
    await deploy(p.id, { state: "error", env: "preview", branch: "feat/x", prNumber: 12 });
    const rows = await buildPublicFeed({ visibility: check });
    expect(rows).toHaveLength(1);
    expect(Object.keys(rows[0]).sort()).toEqual(["at", "branch", "env", "message", "repo", "sha", "state"]);
    expect(rows[0]).toEqual({
      message: "Fix the thing",
      sha: "aaaaaaaaaa",
      branch: "feat/x",
      state: "error",
      env: "preview",
      at: expect.stringMatching(/^2026-11-01T12:00:\d\d\.000Z$/),
      repo: "sam/keys",
    } satisfies FeedRow);
    const text = JSON.stringify(rows);
    for (const secret of [p.id, p.name, String(p.port), "4999", "secret-author", "SECRET", "/home/sam", "sam-r", sam.id, "rel-"]) {
      expect(text, secret).not.toContain(secret);
    }
  });
});

describe("a feed row", () => {
  const base = { message: "m", sha: "b".repeat(40), branch: "main", state: "ready", env: "production" as const, at: new Date(0) };
  const BEL = String.fromCharCode(7);
  const RLO = String.fromCharCode(0x202e);

  it("keeps the first line of the commit message, cleaned and capped", () => {
    expect(oneLine("Fix it\n\nLong body\nmore", 100)).toBe("Fix it");
    expect(oneLine("  spaced \t out  ", 100)).toBe("spaced out");
    expect(oneLine(`a${BEL}b${RLO}c`, 100)).toBe("a b c");
    const cut = oneLine("x".repeat(300), 100);
    expect(Array.from(cut)).toHaveLength(100);
    expect(cut.endsWith("…")).toBe(true);
    expect(oneLine("x".repeat(100), 100)).toBe("x".repeat(100));
  });

  it("does not cut an emoji in half", () => {
    const cut = oneLine("😀".repeat(200), 100);
    expect(Array.from(cut)).toHaveLength(100);
  });

  it("shortens the commit to 10 lower-case characters and maps the state", () => {
    expect(toFeedRow({ ...base, sha: "ABCDEF1234567890ABCDEF1234567890ABCDEF12", message: "ok", state: "deploying" }, "sam/a")).toMatchObject({
      sha: "abcdef1234",
      state: "building",
    });
  });

  it("refuses rows it cannot show honestly", () => {
    expect(toFeedRow({ ...base, message: "ok", sha: "not-a-sha" }, "sam/a")).toBeNull();
    expect(toFeedRow({ ...base, message: "ok", sha: null }, "sam/a")).toBeNull();
    expect(toFeedRow({ ...base, message: null }, "sam/a")).toBeNull();
    expect(toFeedRow({ ...base, message: "\n\nbody only" }, "sam/a")).toBeNull();
    expect(toFeedRow({ ...base, message: "ok", state: "canceled" }, "sam/a")).toBeNull();
    expect(toFeedRow({ ...base, message: "ok" }, "../evil")).toBeNull();
  });
});

describe("opting in", () => {
  it("turns on for the owner of a public GitHub App repository, and is audited", async () => {
    const p = await project("sam/in");
    expect(await setHomepageFeed(sam.id, p.id, true, { visibility: async () => "public" })).toEqual({ enabled: true });
    const row = await ctx.db.select().from(schema.projects).where(eq(schema.projects.id, p.id)).get();
    expect(row?.homepageFeed).toBe(true);
    const log = await ctx.db.select().from(schema.auditLog).where(eq(schema.auditLog.target, p.id));
    expect(log.map((l) => l.action)).toContain("homepage_feed.enable");
    await setHomepageFeed(sam.id, p.id, false);
    const off = await ctx.db.select().from(schema.projects).where(eq(schema.projects.id, p.id)).get();
    expect(off?.homepageFeed).toBe(false);
    expect((await ctx.db.select().from(schema.auditLog).where(eq(schema.auditLog.target, p.id))).map((l) => l.action)).toContain(
      "homepage_feed.disable"
    );
  });

  it.each([
    ["private", "private" as const, "repo_not_public"],
    ["unknown", "unknown" as const, "repo_visibility_unknown"],
  ])("refuses a %s repository and changes nothing", async (_n, v, code) => {
    const p = await project(`sam/refuse-${v}`);
    await expect(setHomepageFeed(sam.id, p.id, true, { visibility: async () => v })).rejects.toMatchObject({ status: 409, code });
    const row = await ctx.db.select().from(schema.projects).where(eq(schema.projects.id, p.id)).get();
    expect(row?.homepageFeed).toBe(false);
  });

  it("refuses when the check itself throws", async () => {
    const p = await project("sam/throws");
    await expect(
      setHomepageFeed(sam.id, p.id, true, {
        visibility: async () => {
          throw new Error("down");
        },
      })
    ).rejects.toMatchObject({ status: 409 });
  });

  it("refuses a project that is not linked to the GitHub App", async () => {
    const p = await project("sam/noapp", { installationId: null });
    await expect(setHomepageFeed(sam.id, p.id, true, { visibility: async () => "public" })).rejects.toMatchObject({
      status: 409,
      code: "repo_not_checkable",
    });
  });

  it("refuses a project whose installation belongs to someone else", async () => {
    const p = await project("sam/borrowed");
    await ctx.db.update(schema.githubInstallations).set({ userId: kim.id }).where(eq(schema.githubInstallations.id, 501));
    try {
      await expect(setHomepageFeed(sam.id, p.id, true, { visibility: async () => "public" })).rejects.toMatchObject({ status: 403 });
    } finally {
      await ctx.db.update(schema.githubInstallations).set({ userId: sam.id }).where(eq(schema.githubInstallations.id, 501));
    }
  });

  it("is for the owner only: another user gets not found and nothing changes", async () => {
    const p = await project("sam/theirs");
    await expect(setHomepageFeed(kim.id, p.id, true, { visibility: async () => "public" })).rejects.toMatchObject({ status: 404 });
    await expect(setHomepageFeed(kim.id, p.id, false)).rejects.toMatchObject({ status: 404 });
    const row = await ctx.db.select().from(schema.projects).where(eq(schema.projects.id, p.id)).get();
    expect(row?.homepageFeed).toBe(false);
  });

  it("is for the owner only: a developer collaborator is refused too", async () => {
    const p = await project("sam/team");
    await ctx.db.insert(schema.projectMembers).values({ projectId: p.id, userId: kim.id, role: "developer", createdAt: new Date() } as never);
    await expect(setHomepageFeed(kim.id, p.id, true, { visibility: async () => "public" })).rejects.toMatchObject({ status: 404 });
  });
});

describe("the settings route", () => {
  const ctxOf = (id: string) => ({ params: Promise.resolve({ id }) });
  const req = (method: string) =>
    new NextRequest("http://localhost:3000/x", {
      method,
      headers: { origin: "http://localhost:3000", "content-type": "application/json" },
      body: method === "POST" ? "{}" : undefined,
    });

  it("needs a signed-in user", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(null as never);
    const p = await project("sam/anon");
    expect((await optIn(req("POST"), ctxOf(p.id))).status).toBe(401);
    expect((await optOut(req("DELETE"), ctxOf(p.id))).status).toBe(401);
  });

  it("refuses a user who is not the owner, before it asks GitHub anything", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(kim as never);
    const p = await project("sam/hers");
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    try {
      expect((await optIn(req("POST"), ctxOf(p.id))).status).toBe(404);
      expect((await optOut(req("DELETE"), ctxOf(p.id))).status).toBe(404);
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }
  });
});

describe("GET /api/public/deployments", () => {
  const get = () => feedRoute(new NextRequest("http://localhost:3000/api/public/deployments"), undefined as never);

  beforeEach(async () => {
    await ctx.db.delete(schema.deployments);
    await ctx.db.update(schema.projects).set({ homepageFeed: false });
    VISIBILITY.clear();
    vi.mocked(getCurrentUser).mockResolvedValue(null as never);
  });

  it("answers without a session, with the public keys only, cached for a minute", async () => {
    const p = await project("sam/route", { feed: true });
    VISIBILITY.set("sam/route", "public");
    await deploy(p.id);
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("public, max-age=60");
    expect(res.headers.get("set-cookie")).toBeNull();
    const body = (await res.json()) as { deployments: FeedRow[] };
    expect(Object.keys(body)).toEqual(["deployments"]);
    expect(body.deployments).toHaveLength(1);
    expect(Object.keys(body.deployments[0]).sort()).toEqual(["at", "branch", "env", "message", "repo", "sha", "state"]);
  });

  it("answers an empty list when nothing is opted in", async () => {
    const res = await get();
    expect(await res.json()).toEqual({ deployments: [] });
  });

  it("is rate limited per client", async () => {
    let last = 200;
    for (let i = 0; i < 62; i++) last = (await get()).status;
    expect(last).toBe(429);
  });
});
