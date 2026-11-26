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

export async function migrateDatabase(client: Client, migrationsFolder: string): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
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
