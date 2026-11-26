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

function open(): Holder {
  const url = config().DATABASE_URL;
  if (url.startsWith("file:") && !url.startsWith("file::memory:")) {
    const file = url.slice("file:".length);
    mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  }
  const client = createClient({ url });
  const db = drizzle(client, { schema, logger: { logQuery: recordBackendQuery } });
  const ready = (async () => {
    await client.execute("PRAGMA foreign_keys = ON");
    await client.execute("PRAGMA busy_timeout = 5000");
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
