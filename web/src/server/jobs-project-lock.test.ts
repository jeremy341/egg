import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { upsertUser } from "@/server/auth/session";
import { schema } from "@/server/db";
import { isUniqueViolation } from "@/server/db/errors";
import { claimNextJob } from "@/server/jobs";
import { createProject, deployBranch } from "@/server/projects";
import { createServer } from "@/server/servers";
import { useFreshDb } from "@/server/test/db";

let ctx: Awaited<ReturnType<typeof useFreshDb>>;
let userId: string;
let a: Awaited<ReturnType<typeof createProject>>;
let b: Awaited<ReturnType<typeof createProject>>;

beforeAll(async () => {
  ctx = await useFreshDb();
  userId = (await upsertUser({ id: "lock-user", name: "Lock", email: null, slackId: null })).id;
  const server = await createServer(userId, "lock-server");
  const base = { serverId: server.id, repoUrl: "https://github.com/example/demo", runtime: "node" as const };
  a = await createProject(userId, { ...base, name: "Lock A", port: 3201 });
  b = await createProject(userId, { ...base, name: "Lock B", port: 3202 });
});
afterAll(async () => ctx.cleanup());

const finishAll = () => ctx.db.update(schema.jobs).set({ state: "done" });

describe("one running job per project, enforced by the database", () => {
  it("stamps a queued job with its project", async () => {
    const dep = await deployBranch(userId, a.id);
    const job = await ctx.db.select().from(schema.jobs).where(eq(schema.jobs.deploymentId, dep.id)).get();
    expect(job?.projectId).toBe(a.id);
    await finishAll();
  });

  it("lets only one of several concurrent claims for the same project win; the other job stays queued", async () => {
    const one = await deployBranch(userId, a.id);
    const two = await deployBranch(userId, a.id);
    const claims = await Promise.all([claimNextJob("lock-1"), claimNextJob("lock-2"), claimNextJob("lock-3")]);
    const won = claims.filter((c) => c !== null);
    expect(won).toHaveLength(1);
    expect(won[0]?.deploymentId).toBe(one.id);
    expect(won[0]?.projectId).toBe(a.id);
    const waiting = await ctx.db.select().from(schema.jobs).where(eq(schema.jobs.deploymentId, two.id)).get();
    expect(waiting?.state).toBe("queued");
    await finishAll();
  });

  it("refuses a second running job for one project at the index", async () => {
    const one = await deployBranch(userId, a.id);
    const two = await deployBranch(userId, a.id);
    await ctx.db.update(schema.jobs).set({ state: "running", lockedBy: "w", lockedAt: new Date() }).where(eq(schema.jobs.deploymentId, one.id));
    const err = await ctx.db
      .update(schema.jobs)
      .set({ state: "running", lockedBy: "w2", lockedAt: new Date() })
      .where(eq(schema.jobs.deploymentId, two.id))
      .then(() => null, (e: unknown) => e);
    expect(isUniqueViolation(err)).toBe(true);
    await finishAll();
  });

  it("treats a claim the index refuses as already taken, not as an error", async () => {
    // A running job whose project_id says "A" but whose deployment belongs to B: the claim query
    // (which looks at the deployment) cannot see it, so only the index stands in the way.
    const decoyDep = await deployBranch(userId, b.id, "decoy");
    await ctx.db
      .update(schema.jobs)
      .set({ state: "running", lockedBy: "ghost", lockedAt: new Date(), projectId: a.id })
      .where(eq(schema.jobs.deploymentId, decoyDep.id));
    const wanted = await deployBranch(userId, a.id, "wanted");
    await expect(claimNextJob("late")).resolves.toBeNull();
    const row = await ctx.db.select().from(schema.jobs).where(eq(schema.jobs.deploymentId, wanted.id)).get();
    expect(row).toMatchObject({ state: "queued", lockedBy: null, attempts: 0 });
    await finishAll();
  });

  it("does not cover finished jobs or jobs of other projects", async () => {
    const one = await deployBranch(userId, a.id);
    const other = await deployBranch(userId, b.id);
    const first = await claimNextJob("x1");
    const second = await claimNextJob("x2");
    expect([first?.deploymentId, second?.deploymentId].sort()).toEqual([one.id, other.id].sort());
    await finishAll();
    const again = await deployBranch(userId, a.id);
    expect((await claimNextJob("x3"))?.deploymentId).toBe(again.id);
    await finishAll();
  });
});

describe("migration 0042 on a database that already has duplicates", () => {
  let dir: string;
  beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), "egg-mig-"));
  });
  afterAll(() => {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // Windows keeps the SQLite file locked for a moment; the OS temp folder is cleaned up eventually.
    }
  });

  it("keeps the newest lock per project, leaves the older ones running, and adds the index", async () => {
    const full = path.join(process.cwd(), "drizzle");
    const journal = JSON.parse(readFileSync(path.join(full, "meta", "_journal.json"), "utf8")) as {
      entries: { idx: number; tag: string }[];
    };
    const at = journal.entries.findIndex((e) => e.tag === "0042_job_project_lock");
    expect(at).toBeGreaterThan(0);
    const before = path.join(dir, "before");
    mkdirSync(path.join(before, "meta"), { recursive: true });
    for (const e of journal.entries.slice(0, at)) cpSync(path.join(full, `${e.tag}.sql`), path.join(before, `${e.tag}.sql`));
    writeFileSync(path.join(before, "meta", "_journal.json"), JSON.stringify({ ...journal, entries: journal.entries.slice(0, at) }));

    const client = createClient({ url: ":memory:" });
    try {
      await client.execute("PRAGMA foreign_keys = OFF");
      const db = drizzle(client);
      await migrate(db, { migrationsFolder: before });

      const insert = async (table: string, values: Record<string, unknown>) => {
        const cols = (await client.execute(`PRAGMA table_info(${table})`)).rows.filter((r) => Number(r.notnull) === 1 && r.dflt_value === null);
        const row: Record<string, unknown> = {};
        for (const c of cols) row[String(c.name)] = String(c.type).toLowerCase().includes("int") ? 1 : "x";
        Object.assign(row, values);
        const names = Object.keys(row);
        await client.execute({
          sql: `INSERT INTO ${table} (${names.join(",")}) VALUES (${names.map(() => "?").join(",")})`,
          args: names.map((n) => row[n] as never),
        });
      };
      await insert("users", { id: "u" });
      await insert("servers", { id: "s", user_id: "u", nest_username: "s" });
      for (const p of ["p1", "p2"]) {
        await insert("projects", { id: p, user_id: "u", server_id: "s", slug: p, name: p, port: p === "p1" ? 3000 : 3001 });
      }
      const job = async (id: string, project: string, state: string, lockedAt: number | null, createdAt: number) => {
        await insert("deployments", { id: `d-${id}`, project_id: project, state: "building", created_at: createdAt });
        await insert("jobs", { id, type: "deploy", deployment_id: `d-${id}`, state, locked_at: lockedAt, created_at: createdAt });
      };
      // p1 has three running jobs. j2 and j3 share a lock time, so created_at decides: j3 is the newest.
      await job("j1", "p1", "running", 1000, 1);
      await job("j2", "p1", "running", 2000, 2);
      await job("j3", "p1", "running", 2000, 3);
      await job("j4", "p1", "done", 9000, 4);
      await job("j5", "p1", "queued", null, 5);
      // p2 has one running job, which must be untouched.
      await job("k1", "p2", "running", 500, 6);

      await migrate(db, { migrationsFolder: full });

      const rows = (await client.execute("SELECT id, project_id, state FROM jobs ORDER BY id")).rows.map((r) => [r.id, r.project_id, r.state]);
      expect(rows).toEqual([
        ["j1", null, "running"],
        ["j2", null, "running"],
        ["j3", "p1", "running"],
        ["j4", "p1", "done"],
        ["j5", "p1", "queued"],
        ["k1", "p2", "running"],
      ]);

      // The index exists and now refuses a second running job for p1.
      await job("j6", "p1", "queued", null, 7);
      await migrate(db, { migrationsFolder: full }); // running it again changes nothing
      await expect(client.execute("UPDATE jobs SET state = 'running', project_id = 'p1' WHERE id = 'j6'")).rejects.toThrow(/UNIQUE/i);
    } finally {
      client.close();
    }
  });
});
