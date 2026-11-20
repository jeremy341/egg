import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { schema } from "@/server/db";
import { upsertUser } from "@/server/auth/session";
import { useFreshDb } from "@/server/test/db";

let ctx: Awaited<ReturnType<typeof useFreshDb>>;
beforeAll(async () => {
  ctx = await useFreshDb();
});
afterAll(async () => {
  await ctx.cleanup();
});
beforeEach(async () => {
  await ctx.db.delete(schema.users);
});

const profile = { id: "ident!race", name: "Rae", email: "  Rae@Example.com ", slackId: null };

describe("upsertUser", () => {
  it("returns one user for two concurrent first sign-ins with the same identity", async () => {
    const [a, b] = await Promise.all([upsertUser(profile), upsertUser(profile)]);
    expect(a.id).toBe(b.id);
    expect(a.hackClubId).toBe(profile.id);
    const rows = await ctx.db.select().from(schema.users).where(eq(schema.users.hackClubId, profile.id));
    expect(rows).toHaveLength(1);
    expect(rows[0].email).toBe("rae@example.com");
  });
});
