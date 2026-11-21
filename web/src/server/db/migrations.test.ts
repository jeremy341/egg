import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createClient } from "@libsql/client";
import { afterEach, describe, expect, it } from "vitest";
import { migrateDatabase } from "@/server/db/migrations";

const clients: ReturnType<typeof createClient>[] = [];
const dirs: string[] = [];

afterEach(() => {
  for (const client of clients.splice(0)) client.close();
  for (const dir of dirs.splice(0)) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // Windows can briefly keep a SQLite file open after close().
    }
  }
});

describe("database migrations", () => {
  it.each([false, true])("backfills listener ports without losing existing rows (main migration applied: %s)", async (fromMain) => {
    const dir = mkdtempSync(path.join(tmpdir(), "egg-workload-migration-"));
    dirs.push(dir);
    const migrations = path.join(dir, "drizzle");
    cpSync(path.join(process.cwd(), "drizzle"), migrations, { recursive: true });
    const journalFile = path.join(migrations, "meta", "_journal.json");
    const journal = JSON.parse(readFileSync(journalFile, "utf8"));
    journal.entries = journal.entries.filter((entry: { idx: number }) => entry.idx < 44);
    if (fromMain) {
      // main shipped this migration on its own, after the four workload/provider timestamps.
      journal.entries.push({ idx: 44, version: "6", when: 1795019743367, tag: "0048_instance_admins", breakpoints: true });
      const adminsSql = readFileSync(path.join(migrations, "0053_instance_admins.sql"), "utf8");
      writeFileSync(path.join(migrations, "0048_instance_admins.sql"), adminsSql.replace(" IF NOT EXISTS", ""));
    }
    writeFileSync(journalFile, JSON.stringify(journal));
    const client = createClient({ url: `file:${path.join(dir, "test.db").replace(/\\/g, "/")}` });
    clients.push(client);
    await client.execute("PRAGMA foreign_keys=ON");
    await migrateDatabase(client, migrations);
    await client.execute("INSERT INTO users (id, hack_club_id, name, created_at) VALUES ('u', 'hc', 'User', 1)");
    await client.execute("INSERT INTO servers (id, user_id, nest_username, host, public_key, private_key_enc, key_fingerprint, created_at) VALUES ('s', 'u', 'user', 'host', 'pub', 'private', 'fingerprint', 1)");
    await client.execute("INSERT INTO projects (id, user_id, server_id, slug, name, repo_url, runtime, port, created_at, updated_at) VALUES ('p', 'u', 's', 'app', 'App', 'https://github.com/a/b', 'node', 3000, 1, 1)");
    await client.execute("INSERT INTO deployments (id, project_id, env, source, branch, port, release_id, created_at) VALUES ('d', 'p', 'production', 'manual', 'main', 3000, 'r', 1)");
    if (fromMain) {
      await client.execute("INSERT INTO instance_admins (user_id, granted_at) VALUES ('u', 1)");
    }
    await migrateDatabase(client, path.join(process.cwd(), "drizzle"));
    expect((await client.execute("SELECT workload_kind, deployment_mode, listen_port FROM projects WHERE id='p'")).rows[0]).toMatchObject({ workload_kind: "web", deployment_mode: "native", listen_port: 3000 });
    expect((await client.execute("SELECT listen_port FROM deployments WHERE id='d'")).rows[0]?.listen_port).toBe(3000);
    if (fromMain) {
      await migrateDatabase(client, path.join(process.cwd(), "drizzle"));
      expect((await client.execute("SELECT user_id FROM instance_admins")).rows).toEqual([{ user_id: "u" }]);
      expect((await client.execute("SELECT source_provider, provider_connection_id, provider_webhook_secret_enc FROM projects")).rows[0]).toMatchObject({
        source_provider: "github", provider_connection_id: null, provider_webhook_secret_enc: null,
      });
      for (const table of ["provider_connections", "provider_webhook_deliveries"]) {
        expect((await client.execute({ sql: "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?", args: [table] })).rows).toHaveLength(1);
      }
    }
    expect((await client.execute("PRAGMA foreign_key_check")).rows).toEqual([]);
  });
  it("recovers when first migrations compete across separate connections", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "egg-migration-race-"));
    dirs.push(dir);
    const url = `file:${path.join(dir, "shared.db").replace(/\\/g, "/")}`;
    const first = createClient({ url });
    const second = createClient({ url });
    clients.push(first, second);
    await Promise.all([
      first.execute("PRAGMA busy_timeout = 5000"),
      second.execute("PRAGMA busy_timeout = 5000"),
    ]);

    const results = await Promise.allSettled([
      migrateDatabase(first, path.join(process.cwd(), "drizzle")),
      migrateDatabase(second, path.join(process.cwd(), "drizzle")),
    ]);

    expect(results.filter((result) => result.status === "rejected")).toEqual([]);
    const journal = JSON.parse(
      readFileSync(path.join(process.cwd(), "drizzle", "meta", "_journal.json"), "utf8")
    ) as { entries: unknown[] };
    const applied = await first.execute("SELECT count(*) AS count FROM __drizzle_migrations");
    expect(Number(applied.rows[0]?.count)).toBe(journal.entries.length);
  });

  it("renames duplicate slugs and nest usernames instead of failing the upgrade", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "egg-duplicate-upgrade-"));
    dirs.push(dir);
    const migrations = path.join(dir, "drizzle");
    cpSync(path.join(process.cwd(), "drizzle"), migrations, { recursive: true });
    const journalFile = path.join(migrations, "meta", "_journal.json");
    const journal = JSON.parse(readFileSync(journalFile, "utf8"));
    journal.entries = journal.entries.filter((entry: { idx: number }) => entry.idx < 50);
    writeFileSync(journalFile, JSON.stringify(journal));
    const client = createClient({ url: `file:${path.join(dir, "test.db").replace(/\\/g, "/")}` });
    clients.push(client);
    await client.execute("PRAGMA foreign_keys=ON");
    await migrateDatabase(client, migrations);
    // Two users holding the same slug on one server, and the same Nest username
    // on one host: legal before this upgrade, unique-index violations after.
    await client.execute("INSERT INTO users (id, hack_club_id, name, created_at) VALUES ('u1', 'hc1', 'One', 1)");
    await client.execute("INSERT INTO users (id, hack_club_id, name, created_at) VALUES ('u2', 'hc2', 'Two', 1)");
    await client.execute(
      "INSERT INTO servers (id, user_id, nest_username, host, public_key, private_key_enc, key_fingerprint, created_at) VALUES ('s1', 'u1', 'kaj', 'nest.example', 'pub', 'enc', 'fp1', 1)"
    );
    await client.execute(
      "INSERT INTO servers (id, user_id, nest_username, host, public_key, private_key_enc, key_fingerprint, created_at) VALUES ('s2', 'u2', 'kaj', 'nest.example', 'pub', 'enc', 'fp2', 2)"
    );
    await client.execute(
      "INSERT INTO projects (id, user_id, server_id, slug, name, repo_url, runtime, port, created_at, updated_at) VALUES ('p1', 'u1', 's1', 'app', 'App One', 'https://github.com/a/b', 'node', 3000, 1, 1)"
    );
    await client.execute(
      "INSERT INTO projects (id, user_id, server_id, slug, name, repo_url, runtime, port, created_at, updated_at) VALUES ('p2', 'u2', 's1', 'app', 'App Two', 'https://github.com/a/c', 'node', 3001, 2, 2)"
    );
    await migrateDatabase(client, path.join(process.cwd(), "drizzle"));
    const slugs = (await client.execute("SELECT id, slug FROM projects ORDER BY id")).rows;
    expect(slugs).toEqual([
      { id: "p1", slug: "app-r-p1" },
      { id: "p2", slug: "app" },
    ]);
    const usernames = (await client.execute("SELECT id, nest_username FROM servers ORDER BY id")).rows;
    expect(usernames).toEqual([
      { id: "s1", nest_username: "kaj-r-s1" },
      { id: "s2", nest_username: "kaj" },
    ]);
    const indexes = await client.execute(
      "SELECT name FROM sqlite_master WHERE type = 'index' AND name IN ('projects_server_slug_idx', 'servers_nest_host_idx')"
    );
    expect(indexes.rows).toHaveLength(2);
    expect((await client.execute("PRAGMA foreign_key_check")).rows).toEqual([]);
  });

  it("rethrows a persistent duplicate-schema conflict instead of treating it as success", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "egg-migration-invalid-"));
    dirs.push(dir);
    const migrationsFolder = path.join(dir, "drizzle");
    mkdirSync(path.join(migrationsFolder, "meta"), { recursive: true });
    writeFileSync(
      path.join(migrationsFolder, "meta", "_journal.json"),
      JSON.stringify({
        version: "6",
        dialect: "sqlite",
        entries: [{ idx: 0, version: "6", when: 1, tag: "0000_duplicate", breakpoints: true }],
      })
    );
    writeFileSync(path.join(migrationsFolder, "0000_duplicate.sql"), "CREATE TABLE collision (id integer);");

    const client = createClient({ url: `file:${path.join(dir, "shared.db").replace(/\\/g, "/")}` });
    clients.push(client);
    await client.execute("CREATE TABLE collision (id integer)");

    await expect(migrateDatabase(client, migrationsFolder)).rejects.toThrow(/table .* already exists/i);
    const applied = await client.execute("SELECT count(*) AS count FROM __drizzle_migrations");
    expect(Number(applied.rows[0]?.count)).toBe(0);
  });
});
