import { eq } from "drizzle-orm";
import { describe, expect, it, afterAll, beforeAll } from "vitest";
import { newId, randomToken } from "@/server/crypto";
import { schema } from "@/server/db";
import { getDb } from "@/server/db";
import { useFreshDb } from "@/server/test/db";

let ctx: Awaited<ReturnType<typeof useFreshDb>>;

beforeAll(async () => {
  ctx = await useFreshDb();
});
afterAll(async () => {
  await ctx.cleanup();
});

/**
 * The libsql file: client pools connections, and `PRAGMA foreign_keys` only
 * covers the one connection it ran on. This test deletes a user while parallel
 * queries keep the pool busy, the conditions under which the cascade silently
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

    // Keep several statements in flight while the user delete lands so the
    // delete cannot rely on being the only activity on the connection.
    const busy = Array.from({ length: 80 }, (_, i) =>
      db
        .select({ n: schema.users.id })
        .from(schema.users)
        .where(eq(schema.users.id, i % 2 === 0 ? userId : "missing")),
    );
    await db.delete(schema.users).where(eq(schema.users.id, userId));
    await Promise.all(busy);

    const tokens = await db.select({ id: schema.apiTokens.id }).from(schema.apiTokens);
    const servers = await db.select({ id: schema.servers.id }).from(schema.servers);
    const projects = await db.select({ id: schema.projects.id }).from(schema.projects);
    expect(tokens.filter((row) => tokenIds.includes(row.id))).toEqual([]);
    expect(servers.filter((row) => row.id === serverId)).toEqual([]);
    expect(projects).toEqual([]);
  });
});
