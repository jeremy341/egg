import { eq } from "drizzle-orm";
import { describe, expect, it, afterAll, beforeAll } from "vitest";
import { newId, randomToken } from "@/server/crypto";
import { schema } from "@/server/db";
import { closeDbForTests, getDb } from "@/server/db";
import { useFreshDb } from "@/server/test/db";

let ctx: Awaited<ReturnType<typeof useFreshDb>>;

beforeAll(async () => {
  ctx = await useFreshDb();
});
afterAll(async () => {
  await ctx.cleanup();
});

/** The raw client behind `getDb()`, for tests that must touch a pooled connection. */
function rawClient() {
  const holder = (globalThis as { __eggDb?: { client: import("@libsql/client").Client } }).__eggDb;
  if (!holder) throw new Error("The database was never opened.");
  return holder.client;
}

/**
 * The libsql file: client pools connections, and `PRAGMA foreign_keys` and
 * `busy_timeout` only cover the one connection they ran on. This test deletes
 * a user while queries genuinely run in parallel — the reads are started
 * before the delete lands — the conditions under which the cascade silently
 * skipped when a fresh pooled connection ran with foreign keys off.
 */
describe("foreign key cascades", () => {
  it("delete a user while queries run in parallel and every child row goes with it", async () => {
    const db = await getDb();
    const userId = newId();
    await db.insert(schema.users).values({ id: userId, hackClubId: `hc-${newId()}`, name: "Cascade", createdAt: new Date() });
    const tokenIds = Array.from({ length: 12 }, () => newId());
    await db.insert(schema.apiTokens).values(
      tokenIds.map((id) => ({
        id,
        userId,
        name: `Token ${id}`,
        prefix: "egg_test",
        hash: randomToken(32),
        scopes: "[]",
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 86_400_000),
      })),
    );
    const serverId = newId();
    await db.insert(schema.servers).values({
      id: serverId,
      userId,
      nestUsername: "cascade-user",
      host: "nest.test",
      publicKey: "pub",
      privateKeyEnc: "sealed",
      keyFingerprint: "fingerprint",
      createdAt: new Date(),
    });
    await db.insert(schema.projects).values({
      id: newId(),
      userId,
      serverId,
      slug: "cascade-app",
      name: "Cascade App",
      repoUrl: "https://github.com/sam/app.git",
      runtime: "node",
      port: 3000,
      listenPort: 3000,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    // Start the reads, then delete while they are in flight: Promise.all
    // subscribes to every lazy statement first so they are actually running
    // when the delete lands, not only after it.
    const busy = Promise.all(
      Array.from({ length: 80 }, (_, i) =>
        db
          .select({ n: schema.users.id })
          .from(schema.users)
          .where(eq(schema.users.id, i % 2 === 0 ? userId : "missing")),
      ),
    );
    await db.delete(schema.users).where(eq(schema.users.id, userId));
    await busy;

    const tokens = await db.select({ id: schema.apiTokens.id }).from(schema.apiTokens);
    const servers = await db.select({ id: schema.servers.id }).from(schema.servers);
    const projects = await db.select({ id: schema.projects.id }).from(schema.projects);
    expect(tokens.filter((row) => tokenIds.includes(row.id))).toEqual([]);
    expect(servers.filter((row) => row.id === serverId)).toEqual([]);
    expect(projects).toEqual([]);
  });
});

/**
 * Both pragmas are per-connection switches with defaults that can be lost. One
 * pooled connection is sabotaged directly; a fresh open (what the app does at
 * boot) must restore both switches on every pooled connection.
 */
describe("per-connection pragma warm-up", () => {
  it("a fresh open restores foreign_keys and busy_timeout on every pooled connection", async () => {
    // Keep in step with POOL_CONNECTIONS in src/server/db/index.ts.
    const POOL = 20;
    await getDb();
    const sabotage = rawClient();

    // Hold pool-1 connections inside open transactions, so the sabotage below
    // borrows the one connection that is left.
    const pins = await Promise.all(Array.from({ length: POOL - 1 }, () => sabotage.transaction("deferred")));
    await sabotage.execute("PRAGMA foreign_keys = OFF");
    await sabotage.execute("PRAGMA busy_timeout = 0");
    const off = await sabotage.execute("PRAGMA foreign_keys");
    for (const pin of pins) await pin.rollback();
    expect(Number(off.rows[0].foreign_keys)).toBe(0);

    // A fresh open runs the boot warm-up again on a brand-new pool.
    await closeDbForTests();
    await getDb();
    const client = rawClient();

    // Read both switches from every pooled connection: each open transaction
    // pins its own connection, so POOL reads see POOL different connections.
    const reads = await Promise.all(
      Array.from({ length: POOL }, async () => {
        const tx = await client.transaction("deferred");
        try {
          const fk = await tx.execute("PRAGMA foreign_keys");
          const timeout = await tx.execute("PRAGMA busy_timeout");
          return { fk: Number(fk.rows[0].foreign_keys), timeout: Number(timeout.rows[0].timeout) };
        } finally {
          await tx.rollback();
        }
      }),
    );
    expect(reads).toHaveLength(POOL);
    for (const read of reads) {
      expect(read.fk).toBe(1);
      expect(read.timeout).toBe(5000);
    }
  });
});
