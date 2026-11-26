import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { resetConfigForTests } from "@/server/config";
import { SESSION_COOKIE, createSession, upsertUser, userForSessionToken } from "@/server/auth/session";
import { localCredential } from "@/server/auth/local-credential";
import { hashLocalPassword, verifyLocalPassword } from "@/server/auth/local-password";
import { useFreshDb } from "@/server/test/db";
import { schema } from "@/server/db";
import { rateLimiter } from "@/server/rate-limit";
import { POST } from "@/app/api/account/local-password/route";

let currentCookie = "";
vi.mock("next/server", async (orig) => ({
  ...(await orig<typeof import("next/server")>()),
  connection: async () => undefined,
}));
vi.mock("next/headers", async (orig) => ({
  ...(await orig<typeof import("next/headers")>()),
  cookies: async () => ({ get: (name: string) => name === "egg_session" && currentCookie ? { value: currentCookie } : undefined }),
}));
vi.mock("@/server/auth/local-credential", async (orig) => {
  const actual = await orig<typeof import("@/server/auth/local-credential")>();
  return { ...actual, localCredential: vi.fn(actual.localCredential) };
});

let ctx: Awaited<ReturnType<typeof useFreshDb>>;
beforeAll(async () => {
  ctx = await useFreshDb();
});
afterAll(async () => {
  await ctx.cleanup();
});
beforeEach(async () => {
  vi.stubEnv("LOCAL_MODE", "1");
  vi.stubEnv("LOCAL_MODE_SECRET", "test-local-mode-secret-test-local-mode-secret");
  vi.stubEnv("APP_URL", "http://localhost:3000");
  resetConfigForTests();
  rateLimiter().clear();
  currentCookie = "";
  await ctx.db.delete(schema.localAuthCredentials);
  await ctx.db.delete(schema.sessions);
});
afterEach(() => {
  vi.unstubAllEnvs();
  resetConfigForTests();
});

const OLD_PASSWORD = "the old local owner password";
const NEW_PASSWORD = "the new local owner password";

async function readyOwner() {
  const user = await upsertUser({ id: "local:owner", name: "Owner", email: null, slackId: null });
  const passwordHash = await hashLocalPassword(OLD_PASSWORD);
  await ctx.db.insert(schema.localAuthCredentials).values({
    id: "local-owner",
    passwordHash,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  const session = await createSession(user.id);
  return { user, passwordHash, session };
}

describe("local owner password change", () => {
  it("changes the password, closes old sessions, and keeps this browser signed in", async () => {
    const { user, session, passwordHash } = await readyOwner();
    currentCookie = session.token;
    const other = await createSession(user.id);
    const req = new NextRequest("http://localhost:3000/api/account/local-password", {
      method: "POST",
      headers: { cookie: `${SESSION_COOKIE}=${session.token}`, "content-type": "application/json" },
      body: JSON.stringify({
        currentPassword: OLD_PASSWORD,
        newPassword: NEW_PASSWORD,
        confirmPassword: NEW_PASSWORD,
      }),
    });

    const res = await POST(req, undefined);
    expect(res.status).toBe(200);
    const nextToken = decodeURIComponent(res.headers.getSetCookie().find((v) => v.startsWith(`${SESSION_COOKIE}=`))!.split(";")[0].split("=").slice(1).join("="));
    expect(await userForSessionToken(session.token)).toBeNull();
    expect(await userForSessionToken(other.token)).toBeNull();
    expect((await userForSessionToken(nextToken))?.hackClubId).toBe("local:owner");

    const row = await ctx.db.select().from(schema.localAuthCredentials).get();
    expect(row?.passwordHash).not.toBe(passwordHash);
    expect(await verifyLocalPassword(OLD_PASSWORD, row!.passwordHash)).toBe(false);
    expect(await verifyLocalPassword(NEW_PASSWORD, row!.passwordHash)).toBe(true);
  });

  it("keeps the browser's session when a competing change wins the race", async () => {
    const { user, session } = await readyOwner();
    currentCookie = session.token;
    const real = (await localCredential())!;
    vi.mocked(localCredential)
      .mockResolvedValueOnce(real)
      .mockResolvedValueOnce({ ...real, passwordHash: "changed-by-another-request" });
    const req = new NextRequest("http://localhost:3000/api/account/local-password", {
      method: "POST",
      headers: { cookie: `${SESSION_COOKIE}=${session.token}`, "content-type": "application/json" },
      body: JSON.stringify({
        currentPassword: OLD_PASSWORD,
        newPassword: NEW_PASSWORD,
        confirmPassword: NEW_PASSWORD,
      }),
    });
    const res = await POST(req, undefined);
    expect(res.status).toBe(409);
    expect((await res.json()).error.message).toBe("The password changed again. Sign in with the new password.");
    // No session was revoked on the way out, so this browser is still signed in.
    expect((await userForSessionToken(session.token))?.id).toBe(user.id);
  });

  it("does not change the password with a wrong current password", async () => {
    const { session, passwordHash } = await readyOwner();
    currentCookie = session.token;
    const req = new NextRequest("http://localhost:3000/api/account/local-password", {
      method: "POST",
      headers: { cookie: `${SESSION_COOKIE}=${session.token}`, "content-type": "application/json" },
      body: JSON.stringify({
        currentPassword: "wrong local password",
        newPassword: NEW_PASSWORD,
        confirmPassword: NEW_PASSWORD,
      }),
    });
    expect((await POST(req, undefined)).status).toBe(403);
    expect((await ctx.db.select().from(schema.localAuthCredentials).get())?.passwordHash).toBe(passwordHash);
  });
});
