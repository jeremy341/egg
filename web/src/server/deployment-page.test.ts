import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { upsertUser } from "@/server/auth/session";
import { schema } from "@/server/db";
import {
  decodeCursor,
  encodeCursor,
  MAX_PAGE_SIZE,
  pageLimit,
  selectDeploymentPage,
} from "@/server/deployment-page";
import { createProject } from "@/server/projects";
import { deploymentPage, deploymentView, deploymentViews } from "@/server/queries";
import { createServer } from "@/server/servers";
import { freePort } from "@/server/test/fake-nest";
import { useFreshDb } from "@/server/test/db";

describe("page cursor", () => {
  it("round-trips a position", () => {
    const c = { at: 1_762_300_000_123, id: "7f0c1c1e-5a3b-4a52-9d36-0b1f3a1e9c11" };
    expect(decodeCursor(encodeCursor(c))).toEqual(c);
  });

  it("is opaque base64url text, safe in a URL", () => {
    const text = encodeCursor({ at: 5, id: "abc" });
    expect(text).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(text).not.toContain("|");
  });

  it.each([
    ["not a string", 42],
    ["empty", ""],
    ["plain text", "hello world"],
    ["base64 of the wrong shape", Buffer.from("no separator").toString("base64url")],
    ["a non-numeric time", Buffer.from("abc|id1").toString("base64url")],
    ["an empty id", Buffer.from("123|").toString("base64url")],
    ["an id with a bad character", Buffer.from("123|a b").toString("base64url")],
    ["a negative time", Buffer.from("-5|id1").toString("base64url")],
    ["a time with too many digits", Buffer.from("9999999999999999|id1").toString("base64url")],
    ["too long", "A".repeat(201)],
    ["padding added", `${encodeCursor({ at: 1, id: "a" })}=`],
  ])("rejects %s", (_name, raw) => {
    expect(decodeCursor(raw)).toBeNull();
  });
});

describe("pageLimit", () => {
  it("defaults to 25 and stays between 1 and 100", () => {
    expect(pageLimit(undefined)).toBe(25);
    expect(pageLimit(null)).toBe(25);
    expect(pageLimit("")).toBe(25);
    expect(pageLimit(Number.NaN)).toBe(25);
    expect(pageLimit(0)).toBe(1);
    expect(pageLimit(-3)).toBe(1);
    expect(pageLimit(40.9)).toBe(40);
    expect(pageLimit(5000)).toBe(MAX_PAGE_SIZE);
  });
});

describe("deployment pages", () => {
  let ctx: Awaited<ReturnType<typeof useFreshDb>>;
  let userId: string;
  let otherUserId: string;
  let projectId: string;
  let otherProjectId: string;
  const BASE = Date.parse("2026-11-01T12:00:00Z");

  async function add(
    id: string,
    at: number,
    over: Partial<typeof schema.deployments.$inferInsert> = {},
    project = projectId
  ) {
    await ctx.db.insert(schema.deployments).values({
      id,
      projectId: project,
      env: "production",
      state: "ready",
      source: "manual",
      branch: "main",
      port: 3000,
      releaseId: `rel-${id}`,
      createdAt: new Date(at),
      ...over,
    });
  }

  const ids = (rows: { id: string }[]) => rows.map((r) => r.id);

  beforeAll(async () => {
    ctx = await useFreshDb();
    userId = (await upsertUser({ id: "dp1", name: "Sam", email: null, slackId: null })).id;
    otherUserId = (await upsertUser({ id: "dp2", name: "Alex", email: null, slackId: null })).id;
    const make = async (owner: string, name: string, nest: string) => {
      const server = await createServer(owner, nest, { host: "127.0.0.1", port: 1 });
      return (
        await createProject(owner, {
          serverId: server.id,
          repoUrl: "https://github.com/example/demo",
          runtime: "node",
          name,
          startCommand: "node server.js",
          port: await freePort(),
        })
      ).id;
    };
    projectId = await make(userId, "Pages App", "sam-p");
    otherProjectId = await make(otherUserId, "Other App", "alex-p");

    // 60 rows one minute apart: p-059 is the newest.
    for (let i = 0; i < 60; i++) {
      const n = String(i).padStart(3, "0");
      await add(`p-${n}`, BASE + i * 60_000, {
        state: i % 3 === 0 ? "error" : i % 3 === 1 ? "building" : "ready",
        env: i % 2 === 0 ? "preview" : "production",
        branch: i === 7 ? "feature/Login-Page" : "main",
        commitSha: i === 11 ? "deadbeef00112233" : null,
        author: i === 13 ? "Renée" : null,
        prNumber: i === 17 ? 42 : null,
      });
    }
    // Three rows made in the same millisecond, and one for another user.
    for (const n of ["t-a", "t-b", "t-c"]) await add(n, BASE + 500 * 60_000);
    await add("other-1", BASE + 999 * 60_000, {}, otherProjectId);
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  it("returns the newest 25 on the first page, with a cursor", async () => {
    const page = await deploymentPage(userId, { projectId });
    expect(page.rows).toHaveLength(25);
    expect(page.nextCursor).not.toBeNull();
    // t-a..t-c are the newest of all (same time, id descending), then p-059 downwards.
    expect(ids(page.rows).slice(0, 5)).toEqual(["t-c", "t-b", "t-a", "p-059", "p-058"]);
  });

  it("walks every row once, in order, with no repeats and no gaps", async () => {
    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const page: Awaited<ReturnType<typeof deploymentPage>> = await deploymentPage(userId, {
        projectId,
        limit: 25,
        cursor,
      });
      seen.push(...ids(page.rows));
      cursor = page.nextCursor;
      pages++;
    } while (cursor);
    expect(pages).toBe(3); // 25 + 25 + 13
    expect(seen).toHaveLength(63);
    expect(new Set(seen).size).toBe(63);
    expect(seen.slice(0, 4)).toEqual(["t-c", "t-b", "t-a", "p-059"]);
    expect(seen[seen.length - 1]).toBe("p-000");
  });

  it("has no cursor on the last page, and none when everything fits in one page", async () => {
    const all = await deploymentPage(userId, { projectId, limit: 100 });
    expect(all.rows).toHaveLength(63);
    expect(all.nextCursor).toBeNull();
    const exact = await deploymentPage(userId, { projectId, limit: 63 });
    expect(exact.rows).toHaveLength(63);
    expect(exact.nextCursor).toBeNull();
    const short = await deploymentPage(userId, { projectId, limit: 62 });
    expect(short.nextCursor).not.toBeNull();
  });

  it("splits rows made at the same time by id, without skipping or repeating one", async () => {
    const first = await deploymentPage(userId, { projectId, limit: 2 });
    expect(ids(first.rows)).toEqual(["t-c", "t-b"]);
    const second = await deploymentPage(userId, { projectId, limit: 2, cursor: first.nextCursor });
    expect(ids(second.rows)).toEqual(["t-a", "p-059"]);
  });

  it("returns an empty last page for a cursor past the oldest row", async () => {
    const past = encodeCursor({ at: 1, id: "zzz" });
    const page = await deploymentPage(userId, { projectId, cursor: past });
    expect(page.rows).toEqual([]);
    expect(page.nextCursor).toBeNull();
  });

  it("refuses a malformed cursor with a 400", async () => {
    await expect(deploymentPage(userId, { projectId, cursor: "not-a-cursor!" })).rejects.toMatchObject({
      status: 400,
      code: "bad_cursor",
    });
  });

  it("clamps the page size to 1..100", async () => {
    expect((await deploymentPage(userId, { projectId, limit: 0 })).rows).toHaveLength(1);
    expect((await deploymentPage(userId, { projectId, limit: 9999 })).rows).toHaveLength(63);
  });

  it("never shows another user's rows, even with their project id", async () => {
    const mine = await deploymentPage(userId, {});
    expect(ids(mine.rows)).not.toContain("other-1");
    const theirs = await deploymentPage(userId, { projectId: otherProjectId });
    expect(theirs.rows).toEqual([]);
  });

  it("filters by status the way the status pills do", async () => {
    const ready = await deploymentPage(userId, { projectId, limit: 100, filter: { status: "ready" } });
    expect(ready.rows.every((r) => r.state === "ready")).toBe(true);
    const building = await deploymentPage(userId, { projectId, limit: 100, filter: { status: "building" } });
    expect(building.rows.every((r) => r.state === "building")).toBe(true);
    const error = await deploymentPage(userId, { projectId, limit: 100, filter: { status: "error" } });
    expect(error.rows.every((r) => r.state === "error")).toBe(true);
    expect(ready.rows.length + building.rows.length + error.rows.length).toBe(63);
  });

  it("finds matches in older pages when filtering, which a page of 25 would hide", async () => {
    // p-007 is 52 rows from the newest, so it is on page 3 unfiltered.
    const page = await deploymentPage(userId, { projectId, filter: { q: "login-page" } });
    expect(ids(page.rows)).toEqual(["p-007"]);
  });

  it("searches commit sha, author, pull request and environment like the list does", async () => {
    const q = async (text: string) =>
      ids((await deploymentPage(userId, { projectId, limit: 100, filter: { q: text } })).rows);
    expect(await q("DEADBEEF")).toEqual(["p-011"]);
    expect(await q("0011")).toEqual(["p-011"]);
    expect(await q("renée")).toEqual(["p-013"]);
    expect(await q("#42")).toEqual(["p-017"]);
    expect(await q("pr 42")).toEqual(["p-017"]);
    expect(await q("pages app")).toHaveLength(63); // the project name
    expect(await q("preview")).toHaveLength(30);
  });

  it("needs every word to match, anywhere", async () => {
    const q = async (text: string) =>
      ids((await deploymentPage(userId, { projectId, limit: 100, filter: { q: text } })).rows);
    expect(await q("feature preview")).toEqual([]); // p-007 is a production row
    expect(await q("feature production")).toEqual(["p-007"]);
    expect(await q("   ")).toHaveLength(63);
  });

  it("treats % and _ in a search as plain characters", async () => {
    const q = async (text: string) =>
      ids((await deploymentPage(userId, { projectId, limit: 100, filter: { q: text } })).rows);
    expect(await q("%")).toEqual([]);
    expect(await q("_")).toEqual([]);
  });

  it("pages a filtered list with its own cursor", async () => {
    const first = await deploymentPage(userId, { projectId, limit: 10, filter: { env: "preview" } });
    expect(first.rows).toHaveLength(10);
    expect(first.nextCursor).not.toBeNull();
    const rest = await deploymentPage(userId, {
      projectId,
      limit: 100,
      cursor: first.nextCursor,
      filter: { env: "preview" },
    });
    expect(rest.rows).toHaveLength(20);
    expect(rest.nextCursor).toBeNull();
    expect([...first.rows, ...rest.rows].every((r) => r.env === "preview")).toBe(true);
  });

  it("filters by time range from a given clock", async () => {
    const now = BASE + 59 * 60_000 + 30_000;
    const day = await selectDeploymentPage(userId, { projectId, limit: 100, now, filter: { range: "24h" } });
    expect(day.rows).toHaveLength(63); // all of them are within a day of that clock
    const later = await selectDeploymentPage(userId, {
      projectId,
      limit: 100,
      now: BASE + 8 * 86_400_000,
      filter: { range: "7d" },
    });
    expect(later.rows.map((r) => r.d.id)).toEqual([]);
  });

  it("deploymentViews keeps its old behaviour: newest 100, or `limit`, newest first", async () => {
    const some = await deploymentViews(userId, { projectId, limit: 3 });
    expect(ids(some)).toEqual(["t-c", "t-b", "t-a"]);
    const all = await deploymentViews(userId, { projectId });
    expect(all).toHaveLength(63);
  });

  it("deploymentView is owner-only and uses the real slug", async () => {
    const real = (await ctx.db.select().from(schema.projects).where(eq(schema.projects.id, projectId)).get())!;

    const ownerView = await deploymentView(userId, "t-a");
    expect(ownerView.project.slug).toBe(real.slug);
    expect(ownerView.deployment.projectSlug).toBe(real.slug);

    await expect(deploymentView(otherUserId, "t-a")).rejects.toMatchObject({ status: 404 });
  });
});
