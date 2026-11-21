import { readMigrationFiles } from "drizzle-orm/migrator";
import { migrate } from "drizzle-orm/libsql/migrator";
import type { Client } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";

const RETRY_DELAYS_MS = [100, 250, 500] as const;

function isConcurrentMigrationConflict(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current; depth++) {
    const value = current as { code?: unknown; message?: unknown; cause?: unknown };
    const code = String(value.code ?? "");
    const message = String(value.message ?? "");
    if (code === "SQLITE_BUSY" || code === "SQLITE_LOCKED") return true;
    if (/\b(?:table|index) .+ already exists\b|\bduplicate column name\b/i.test(message)) return true;
    current = value.cause;
  }
  return false;
}

const HOMEPAGE_FEED_MIGRATION = 1794595329949;
const MAIN_INSTANCE_ADMINS_MIGRATION = 1795019743367;

async function reconcileMainMigrations(client: Client, migrationsFolder: string): Promise<void> {
  const journal = await client.execute(
    "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = '__drizzle_migrations'",
  );
  if (journal.rows.length === 0) return;

  const appliedInRange = {
    sql: "SELECT created_at FROM __drizzle_migrations WHERE created_at > ? AND created_at <= ?",
    args: [HOMEPAGE_FEED_MIGRATION, MAIN_INSTANCE_ADMINS_MIGRATION],
  };
  const applied = new Set((await client.execute(appliedInRange)).rows.map((row) => Number(row.created_at)));
  if (!applied.has(MAIN_INSTANCE_ADMINS_MIGRATION)) return;

  // main shipped instance_admins without the earlier workload and provider
  // migrations. Drizzle's latest-timestamp check skips them during an upgrade.
  const missing = readMigrationFiles({ migrationsFolder }).filter((migration) =>
    migration.folderMillis > HOMEPAGE_FEED_MIGRATION &&
    migration.folderMillis < MAIN_INSTANCE_ADMINS_MIGRATION &&
    !applied.has(migration.folderMillis),
  );
  if (missing.length === 0) return;

  const tx = await client.transaction("write");
  try {
    const latest = new Set((await tx.execute(appliedInRange)).rows.map((row) => Number(row.created_at)));
    for (const migration of missing) {
      if (latest.has(migration.folderMillis)) continue;
      for (const sql of migration.sql) await tx.execute(sql);
      await tx.execute({
        sql: "INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)",
        args: [migration.hash, migration.folderMillis],
      });
    }
    await tx.commit();
  } finally {
    tx.close();
  }
}

export async function migrateDatabase(client: Client, migrationsFolder: string): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await reconcileMainMigrations(client, migrationsFolder);
      // Drizzle reloads the latest migration row on every call, so a retry
      // observes the state committed by the process that won the race.
      await migrate(drizzle(client), { migrationsFolder });
      return;
    } catch (error) {
      const delay = RETRY_DELAYS_MS[attempt];
      if (delay === undefined || !isConcurrentMigrationConflict(error)) throw error;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}
