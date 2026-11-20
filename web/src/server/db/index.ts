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
      const states = await Promise.all(
        Array.from({ length: POOL_CONNECTIONS }, () => client.execute("PRAGMA foreign_keys"))
      );
      if (states.some((r) => r.rows.length === 0 || Number(r.rows[0].foreign_keys) !== 1)) {
        throw new Error("The database did not open with foreign key checks enabled.");
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

/** For tests: close and forget the connection. */
export async function closeDbForTests() {
  if (g.__eggDb) {
    g.__eggDb.client.close();
    g.__eggDb = undefined;
  }
}

export { schema };
