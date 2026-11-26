import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createClient, type Client } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { upsertUser } from "@/server/auth/session";
import { BUILD_LOCATIONS } from "@/server/db/schema";
import { createProject, createProjectInput, updateProject, updateProjectInput } from "@/server/projects";
import { createServer } from "@/server/servers";
import { useFreshDb } from "@/server/test/db";

describe("buildLocation validation", () => {
  const base = {
    serverId: "s1",
    name: "Demo",
    repoUrl: "https://github.com/example/demo",
    runtime: "node" as const,
    port: 3000,
  };

  it("accepts container and github, and nothing else", () => {
    expect(BUILD_LOCATIONS).toEqual(["container", "github"]);
    for (const good of ["container", "github"]) {
      expect(createProjectInput.parse({ ...base, buildLocation: good }).buildLocation).toBe(good);
      expect(updateProjectInput.parse({ buildLocation: good })).toMatchObject({ buildLocation: good });
    }
    for (const bad of ["central", "Central", "docker", "GitHub", "actions", "", null, 1, true]) {
      expect(createProjectInput.safeParse({ ...base, buildLocation: bad }).success, String(bad)).toBe(false);
      expect(updateProjectInput.safeParse({ buildLocation: bad }).success, String(bad)).toBe(false);
    }
  });

  it("leaves it unset when not given, so an edit that does not mention it cannot change it", () => {
    expect(createProjectInput.parse(base).buildLocation).toBeUndefined();
    expect(updateProjectInput.parse({ name: "Renamed" })).not.toHaveProperty("buildLocation");
  });
});

describe("buildLocation on projects", () => {
  let ctx: Awaited<ReturnType<typeof useFreshDb>>;
  let userId: string;
  let serverId: string;

  beforeAll(async () => {
    ctx = await useFreshDb();
    userId = (await upsertUser({ id: "u1", name: "Sam", email: null, slackId: null })).id;
    serverId = (await createServer(userId, "sam-r")).id;
  });
  afterAll(async () => {
    await ctx.cleanup();
  });

  const input = (name: string, port: number, extra: Record<string, unknown> = {}) => ({
    serverId,
    name,
    repoUrl: "https://github.com/example/demo",
    runtime: "node",
    port,
    ...extra,
  });

  it("is container for a new project, can be set to github, and cannot be set to build anywhere else", async () => {
    expect((await createProject(userId, input("One", 3101))).buildLocation).toBe("container");
    expect((await createProject(userId, input("Two", 3102, { buildLocation: "container" }))).buildLocation).toBe("container");
    expect((await createProject(userId, input("Gh", 3105, { buildLocation: "github" }))).buildLocation).toBe("github");
    await expect(createProject(userId, input("Central", 3104, { buildLocation: "central" }))).rejects.toThrow();
  });

  it("keeps its value through an edit that does not mention it, switches between container and github, and refuses any other value", async () => {
    const p = await createProject(userId, input("Three", 3103));
    const renamed = await updateProject(userId, p.id, { name: "Three renamed" });
    expect(renamed.buildLocation).toBe("container");
    await expect(updateProject(userId, p.id, { buildLocation: "central" })).rejects.toThrow();
    await expect(updateProject(userId, p.id, { buildLocation: "docker" })).rejects.toThrow();
    expect((await updateProject(userId, p.id, { name: "Three again" })).buildLocation).toBe("container");
    expect((await updateProject(userId, p.id, { buildLocation: "github" })).buildLocation).toBe("github");
    expect((await updateProject(userId, p.id, { name: "Three github" })).buildLocation).toBe("github");
    expect((await updateProject(userId, p.id, { buildLocation: "container" })).buildLocation).toBe("container");
  });

  it("starts a new server at 512 MB of build memory", async () => {
    const other = await upsertUser({ id: "u2", name: "Kim", email: null, slackId: null });
    const srv = await createServer(other.id, "kim-r");
    expect(srv.buildMemoryMb).toBe(512);
  });
});

describe("migration 0026", () => {
  let dir: string;
  let client: Client;

  beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), "egg-mig-"));
  });
  afterAll(() => {
    client?.close();
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // Windows keeps the SQLite file locked for a moment; the OS temp folder is cleaned up eventually.
    }
  });

  it("moves every project that was set to build on Egg's machine to the container, and keeps the container lock", async () => {
    const full = path.join(process.cwd(), "drizzle");
    const journal = JSON.parse(readFileSync(path.join(full, "meta", "_journal.json"), "utf8")) as {
      entries: { idx: number; tag: string }[];
    };
    const at = journal.entries.findIndex((e) => e.tag === "0026_container_only");
    expect(at).toBeGreaterThan(0);

    // A copy of the migrations as they were before this one.
    const before = path.join(dir, "before");
    mkdirSync(path.join(before, "meta"), { recursive: true });
    for (const e of journal.entries.slice(0, at)) cpSync(path.join(full, `${e.tag}.sql`), path.join(before, `${e.tag}.sql`));
    writeFileSync(path.join(before, "meta", "_journal.json"), JSON.stringify({ ...journal, entries: journal.entries.slice(0, at) }));

    client = createClient({ url: `file:${path.join(dir, "mig.db").replace(/\\/g, "/")}` });
    await client.execute("PRAGMA foreign_keys = OFF");
    const db = drizzle(client);
    await migrate(db, { migrationsFolder: before });

    // A project that exists before the migration, with every required column filled in.
    const required = async (table: string) =>
      (await client.execute(`PRAGMA table_info(${table})`)).rows.filter((r) => Number(r.notnull) === 1 && r.dflt_value === null);
    const insert = async (table: string, values: Record<string, unknown>) => {
      const cols = await required(table);
      const row: Record<string, unknown> = {};
      for (const c of cols) row[String(c.name)] = values[String(c.name)] ?? (String(c.type).toLowerCase().includes("int") ? 1 : "x");
      Object.assign(row, values);
      const names = Object.keys(row);
      await client.execute({
        sql: `INSERT INTO ${table} (${names.join(",")}) VALUES (${names.map(() => "?").join(",")})`,
        args: names.map((n) => row[n] as never),
      });
    };
    await insert("users", { id: "u1" });
    await insert("servers", { id: "s1", user_id: "u1", nest_username: "sam" });
    await insert("projects", { id: "old", user_id: "u1", server_id: "s1", slug: "old", name: "old", port: 3000, build_location: "central" });
    await insert("projects", { id: "boxed", user_id: "u1", server_id: "s1", slug: "boxed", name: "boxed", port: 3001, build_location: "container" });
    const stored = await client.execute("SELECT id, build_location FROM projects ORDER BY id");
    expect(stored.rows.map((r) => [r.id, r.build_location])).toEqual([["boxed", "container"], ["old", "central"]]);

    await migrate(db, { migrationsFolder: full });

    const after = await client.execute("SELECT id, build_location FROM projects ORDER BY id");
    expect(after.rows.map((r) => [r.id, r.build_location])).toEqual([["boxed", "container"], ["old", "container"]]);
    await insert("projects", { id: "fresh", user_id: "u1", server_id: "s1", slug: "fresh", name: "fresh", port: 3002 });
    const fresh = await client.execute("SELECT build_location FROM projects WHERE id = 'fresh'");
    expect(fresh.rows[0].build_location).toBe("container");

    const lock = (await client.execute("PRAGMA table_info(servers)")).rows.map((r) => r.name);
    expect(lock).toContain("build_lock_holder");
    expect(lock).toContain("build_lock_at");
  });
});

describe("migration 0025", () => {
  let dir: string;
  let client: Client;

  beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), "egg-mig-"));
  });
  afterAll(() => {
    client?.close();
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // Windows keeps the SQLite file locked for a moment; the OS temp folder is cleaned up eventually.
    }
  });

  it("lowers only servers still on 2048 MB to 1024 MB and leaves chosen values alone", async () => {
    const full = path.join(process.cwd(), "drizzle");
    const journal = JSON.parse(readFileSync(path.join(full, "meta", "_journal.json"), "utf8")) as {
      entries: { idx: number; tag: string }[];
    };
    const at = journal.entries.findIndex((e) => e.tag === "0025_build_memory_default");
    expect(at).toBeGreaterThan(0);

    const before = path.join(dir, "before");
    mkdirSync(path.join(before, "meta"), { recursive: true });
    for (const e of journal.entries.slice(0, at)) cpSync(path.join(full, `${e.tag}.sql`), path.join(before, `${e.tag}.sql`));
    writeFileSync(path.join(before, "meta", "_journal.json"), JSON.stringify({ ...journal, entries: journal.entries.slice(0, at) }));

    client = createClient({ url: `file:${path.join(dir, "mig.db").replace(/\\/g, "/")}` });
    await client.execute("PRAGMA foreign_keys = OFF");
    const db = drizzle(client);
    await migrate(db, { migrationsFolder: before });

    const insert = async (table: string, values: Record<string, unknown>) => {
      const cols = (await client.execute(`PRAGMA table_info(${table})`)).rows.filter((r) => Number(r.notnull) === 1 && r.dflt_value === null);
      const row: Record<string, unknown> = {};
      for (const c of cols) row[String(c.name)] = String(c.type).toLowerCase().includes("int") ? 1 : "x";
      Object.assign(row, values);
      const names = Object.keys(row);
      await client.execute({ sql: `INSERT INTO ${table} (${names.join(",")}) VALUES (${names.map(() => "?").join(",")})`, args: names.map((n) => row[n] as never) });
    };
    await insert("users", { id: "u1" });
    for (const [id, mb] of [["old", 2048], ["chosen", 4096], ["small", 1024]] as const) {
      await insert("servers", { id, user_id: "u1", nest_username: id, build_memory_mb: mb });
    }

    // Run through 0025 only: later migrations change the same column again.
    const through = path.join(dir, "through");
    mkdirSync(path.join(through, "meta"), { recursive: true });
    for (const e of journal.entries.slice(0, at + 1)) cpSync(path.join(full, `${e.tag}.sql`), path.join(through, `${e.tag}.sql`));
    writeFileSync(path.join(through, "meta", "_journal.json"), JSON.stringify({ ...journal, entries: journal.entries.slice(0, at + 1) }));
    await migrate(db, { migrationsFolder: through });

    const rows = (await client.execute("SELECT id, build_memory_mb FROM servers ORDER BY id")).rows.map((r) => [r.id, Number(r.build_memory_mb)]);
    expect(rows).toEqual([["chosen", 4096], ["old", 1024], ["small", 1024]]);
    // The column default is untouched, so SQLite does not rebuild the table.
    const info = (await client.execute("PRAGMA table_info(servers)")).rows.find((r) => r.name === "build_memory_mb");
    expect(String(info?.dflt_value)).toBe("2048");
  });
});

describe("migration 0029", () => {
  let dir: string;
  let client: Client;

  beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), "egg-mig-"));
  });
  afterAll(() => {
    client?.close();
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // Windows keeps the SQLite file locked for a moment; the OS temp folder is cleaned up eventually.
    }
  });

  it("lowers only servers still on 1024 MB to 512 MB and leaves chosen values alone", async () => {
    const full = path.join(process.cwd(), "drizzle");
    const journal = JSON.parse(readFileSync(path.join(full, "meta", "_journal.json"), "utf8")) as {
      entries: { idx: number; tag: string }[];
    };
    const at = journal.entries.findIndex((e) => e.tag === "0029_build_memory_512");
    expect(at).toBeGreaterThan(0);

    const before = path.join(dir, "before");
    mkdirSync(path.join(before, "meta"), { recursive: true });
    for (const e of journal.entries.slice(0, at)) cpSync(path.join(full, `${e.tag}.sql`), path.join(before, `${e.tag}.sql`));
    writeFileSync(path.join(before, "meta", "_journal.json"), JSON.stringify({ ...journal, entries: journal.entries.slice(0, at) }));

    client = createClient({ url: `file:${path.join(dir, "mig.db").replace(/\\/g, "/")}` });
    await client.execute("PRAGMA foreign_keys = OFF");
    const db = drizzle(client);
    await migrate(db, { migrationsFolder: before });

    const insert = async (table: string, values: Record<string, unknown>) => {
      const cols = (await client.execute(`PRAGMA table_info(${table})`)).rows.filter((r) => Number(r.notnull) === 1 && r.dflt_value === null);
      const row: Record<string, unknown> = {};
      for (const c of cols) row[String(c.name)] = String(c.type).toLowerCase().includes("int") ? 1 : "x";
      Object.assign(row, values);
      const names = Object.keys(row);
      await client.execute({ sql: `INSERT INTO ${table} (${names.join(",")}) VALUES (${names.map(() => "?").join(",")})`, args: names.map((n) => row[n] as never) });
    };
    await insert("users", { id: "u1" });
    for (const [id, mb] of [["default", 1024], ["chosen", 4096], ["small", 768], ["floor", 512]] as const) {
      await insert("servers", { id, user_id: "u1", nest_username: id, build_memory_mb: mb });
    }

    await migrate(db, { migrationsFolder: full });

    const rows = (await client.execute("SELECT id, build_memory_mb FROM servers ORDER BY id")).rows.map((r) => [r.id, Number(r.build_memory_mb)]);
    expect(rows).toEqual([["chosen", 4096], ["default", 512], ["floor", 512], ["small", 768]]);
    // The column default is untouched, so SQLite does not rebuild the table.
    const info = (await client.execute("PRAGMA table_info(servers)")).rows.find((r) => r.name === "build_memory_mb");
    expect(String(info?.dflt_value)).toBe("2048");
  });
});

describe("migration 0030", () => {
  let dir: string;
  let client: Client;

  beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), "egg-mig-"));
  });
  afterAll(() => {
    client?.close();
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // Windows keeps the SQLite file locked for a moment; the OS temp folder is cleaned up eventually.
    }
  });

  it("0030 adds the upload token columns, empty, keeps every project as it was, and allows one project per token; the latest migration drops them again", async () => {
    const full = path.join(process.cwd(), "drizzle");
    const journal = JSON.parse(readFileSync(path.join(full, "meta", "_journal.json"), "utf8")) as {
      entries: { idx: number; tag: string }[];
    };
    const at = journal.entries.findIndex((e) => e.tag === "0030_github_builds");
    expect(at).toBeGreaterThan(0);

    const before = path.join(dir, "before");
    mkdirSync(path.join(before, "meta"), { recursive: true });
    for (const e of journal.entries.slice(0, at)) cpSync(path.join(full, `${e.tag}.sql`), path.join(before, `${e.tag}.sql`));
    writeFileSync(path.join(before, "meta", "_journal.json"), JSON.stringify({ ...journal, entries: journal.entries.slice(0, at) }));

    client = createClient({ url: `file:${path.join(dir, "mig.db").replace(/\\/g, "/")}` });
    await client.execute("PRAGMA foreign_keys = OFF");
    const db = drizzle(client);
    await migrate(db, { migrationsFolder: before });

    const insert = async (table: string, values: Record<string, unknown>) => {
      const cols = (await client.execute(`PRAGMA table_info(${table})`)).rows.filter((r) => Number(r.notnull) === 1 && r.dflt_value === null);
      const row: Record<string, unknown> = {};
      for (const c of cols) row[String(c.name)] = String(c.type).toLowerCase().includes("int") ? 1 : "x";
      Object.assign(row, values);
      const names = Object.keys(row);
      await client.execute({ sql: `INSERT INTO ${table} (${names.join(",")}) VALUES (${names.map(() => "?").join(",")})`, args: names.map((n) => row[n] as never) });
    };
    await insert("users", { id: "u1" });
    await insert("servers", { id: "s1", user_id: "u1", nest_username: "sam" });
    await insert("projects", { id: "old", user_id: "u1", server_id: "s1", slug: "old", name: "old", port: 3000 });
    const projectsBefore = (await client.execute("SELECT id, slug, build_location FROM projects")).rows.map((r) => [r.id, r.slug, r.build_location]);

    // Up to and including 0030 only.
    const upTo = path.join(dir, "upto0030");
    mkdirSync(path.join(upTo, "meta"), { recursive: true });
    for (const e of journal.entries.slice(0, at + 1)) cpSync(path.join(full, `${e.tag}.sql`), path.join(upTo, `${e.tag}.sql`));
    writeFileSync(path.join(upTo, "meta", "_journal.json"), JSON.stringify({ ...journal, entries: journal.entries.slice(0, at + 1) }));
    await migrate(db, { migrationsFolder: upTo });

    const cols = (await client.execute("PRAGMA table_info(projects)")).rows;
    const hash = cols.find((c) => c.name === "build_upload_token_hash");
    const made = cols.find((c) => c.name === "build_upload_token_created_at");
    expect([String(hash?.type).toLowerCase(), Number(hash?.notnull)]).toEqual(["text", 0]);
    expect([String(made?.type).toLowerCase(), Number(made?.notnull)]).toEqual(["integer", 0]);
    const after = (await client.execute("SELECT id, slug, build_location, build_upload_token_hash, build_upload_token_created_at FROM projects")).rows;
    expect(after.map((r) => [r.id, r.slug, r.build_location])).toEqual(projectsBefore);
    expect(after[0].build_upload_token_hash).toBeNull();
    expect(after[0].build_upload_token_created_at).toBeNull();

    // Many projects without a token are fine; two with the same token hash are not.
    await insert("projects", { id: "two", user_id: "u1", server_id: "s1", slug: "two", name: "two", port: 3001 });
    await client.execute("UPDATE projects SET build_upload_token_hash = 'h1' WHERE id = 'old'");
    await expect(client.execute("UPDATE projects SET build_upload_token_hash = 'h1' WHERE id = 'two'")).rejects.toThrow(/UNIQUE/i);

    // Every migration up to the latest (0034 removes the single long-lived upload token on purpose): the two
    // columns and their unique index are gone, and the projects are still there.
    expect(journal.entries.map((e) => e.tag)).toContain("0034_drop_legacy_build_token");
    await migrate(db, { migrationsFolder: full });
    const colsNow = (await client.execute("PRAGMA table_info(projects)")).rows.map((r) => String(r.name));
    expect(colsNow).not.toContain("build_upload_token_hash");
    expect(colsNow).not.toContain("build_upload_token_created_at");
    expect(colsNow).toContain("build_location");
    const indexes = (await client.execute("PRAGMA index_list(projects)")).rows.map((r) => String(r.name));
    expect(indexes).not.toContain("projects_build_token_idx");
    expect((await client.execute("SELECT id FROM projects ORDER BY id")).rows.map((r) => r.id)).toEqual(["old", "two"]);
  });
});
