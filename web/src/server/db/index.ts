import { mkdirSync } from "node:fs";
import path from "node:path";
import { createClient, type Client } from "@libsql/client";
import { drizzle, type LibSQLDatabase } from "drizzle-orm/libsql";
import { config } from "@/server/config";
import * as schema from "@/server/db/schema";
import { recordBackendQuery } from "@/server/backend-metrics";
import { migrateDatabase } from "@/server/db/migrations";

export type Db = LibSQLDatabase<typeof schema>;

type Holder = { client: Client; db: Db; ready: Promise<void> };

// Next.js re-evaluates modules in dev, so keep one connection on globalThis.
const g = globalThis as unknown as { __eggDb?: Holder };

/** How many pooled connections a local file: database serves. Must match the client's `concurrency`. */
const POOL_CONNECTIONS = 20;

function open(): Holder {
  const url = config().DATABASE_URL;
  if (url.startsWith("file:") && !url.startsWith("file::memory:")) {
    const file = url.slice("file:".length);
    mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  }
  // A local file: database is served by a pool of connections, and both
  // pragmas below are per-connection switches: running each once would only
  // cover the one connection that borrowed, leaving every other pooled
  // connection with cascades off and no busy timeout, so cascade deletes
  // would silently no-op under load. Every pooled connection is therefore
  // opened up front, gets both settings, and is verified to carry them.
  const client = createClient(url.startsWith("file:") ? { url, concurrency: POOL_CONNECTIONS } : { url });
  const db = drizzle(client, { schema, logger: { logQuery: recordBackendQuery } });
  const ready = (async () => {
    if (url.startsWith("file:")) {
      await Promise.all(
        Array.from({ length: POOL_CONNECTIONS }, () => client.execute("PRAGMA foreign_keys = ON"))
      );
      await Promise.all(
        Array.from({ length: POOL_CONNECTIONS }, () => client.execute("PRAGMA busy_timeout = 5000"))
      );
      // Both switches are per-connection and are only defaults in disguise: a
      // connection can be replaced (reconnect) or its settings flipped, so the
      // warm-up verifies that every pooled connection carries both, not just FK.
      const states = await Promise.all(
        Array.from({ length: POOL_CONNECTIONS }, async () => ({
          fk: await client.execute("PRAGMA foreign_keys"),
          timeout: await client.execute("PRAGMA busy_timeout"),
        }))
      );
      if (states.some((r) => r.fk.rows.length === 0 || Number(r.fk.rows[0].foreign_keys) !== 1) ||
          states.some((r) => Number(r.timeout.rows[0].timeout) !== 5000)) {
        throw new Error("The database did not open with foreign key checks and its busy timeout enabled.");
      }
    } else {
      await client.execute("PRAGMA foreign_keys = ON");
      await client.execute("PRAGMA busy_timeout = 5000");
    }
    await migrateDatabase(client, path.join(process.cwd(), "drizzle"));
  })();
  return { client, db, ready };
}

/** The database, with migrations applied. Await it before the first query. */
export async function getDb(): Promise<Db> {
  g.__eggDb ??= open();
  await g.__eggDb.ready;
  return g.__eggDb.db;
}

/**
 * SQLite can reject a concurrent write transaction immediately. Run a write that
 * can meet lock contention through this: it retries only SQLITE_BUSY/SQLITE_LOCKED
 * errors; constraint and application errors reach the caller unchanged.
 */
export async function withLockRetry<T>(run: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await run();
    } catch (err) {
      if (attempt >= 49 || !(err instanceof Error) || !/SQLITE_BUSY|SQLITE_LOCKED/.test(err.message)) throw err;
      await new Promise((resolve) => setTimeout(resolve, 20 + attempt * 5));
    }
  }
}

/** For tests: close and forget the connection. */
export async function closeDbForTests() {
  if (g.__eggDb) {
    g.__eggDb.client.close();
    g.__eggDb = undefined;
  }
}

export { schema };
