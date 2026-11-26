import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
