import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { schema } from "@/server/db";
import { createSession, isFreshAuth, upsertUser } from "@/server/auth/session";
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

describe("isFreshAuth", () => {
  it("does not accept a fresh session belonging to a different user", async () => {
    const a = await upsertUser({ id: "ident!a", name: "A", email: "a@example.com", slackId: null });
    const b = await upsertUser({ id: "ident!b", name: "B", email: "b@example.com", slackId: null });
    const freshB = await createSession(b.id, null, undefined, { freshHackClubAuth: true });
    expect(await isFreshAuth(freshB.token, Date.now(), a.id)).toBe(false);
    expect(await isFreshAuth(freshB.token, Date.now(), b.id)).toBe(true);
  });
});

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
