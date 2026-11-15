import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { resetConfigForTests } from "@/server/config";
import { SESSION_COOKIE, createSession, markFreshAuth, upsertUser, userForSessionToken } from "@/server/auth/session";
import { sha256Hex } from "@/server/crypto";
import { hashLocalPassword, verifyLocalPassword } from "@/server/auth/local-password";
import { PASSWORD_AUTH_ERROR, createPasswordCredential, generateRecoveryKey } from "@/server/auth/password-signin";
import { useFreshDb } from "@/server/test/db";
import { schema } from "@/server/db";
import { rateLimiter } from "@/server/rate-limit";
import { POST } from "@/app/api/account/password/route";

let currentCookie = "";
vi.mock("next/server", async (orig) => ({
  ...(await orig<typeof import("next/server")>()),
  connection: async () => undefined,
}));
vi.mock("next/headers", async (orig) => ({
  ...(await orig<typeof import("next/headers")>()),
  cookies: async () => ({ get: (name: string) => name === "egg_session" && currentCookie ? { value: currentCookie } : undefined }),
}));

let ctx: Awaited<ReturnType<typeof useFreshDb>>;
beforeAll(async () => {
  ctx = await useFreshDb();
});
afterAll(async () => {
  await ctx.cleanup();
});
beforeEach(async () => {
  vi.stubEnv("HACKCLUB_CLIENT_ID", "client-id");
  vi.stubEnv("HACKCLUB_CLIENT_SECRET", "client-secret");
  vi.stubEnv("DEV_LOGIN", "0");
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

const PASSWORD = "a long enough password";
const NEXT_PASSWORD = "another long enough password";

async function person(hackClubId = "ident!sam", email: string | null = "sam@example.com") {
  const user = await upsertUser({ id: hackClubId, name: "Sam", email, slackId: null });
  const session = await createSession(user.id, undefined, undefined, { freshHackClubAuth: true });
  currentCookie = session.token;
  return { user, session };
}

function call(body: unknown) {
  return POST(
    new NextRequest("http://localhost:3000/api/account/password", {
      method: "POST",
      headers: { cookie: `${SESSION_COOKIE}=${currentCookie}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    undefined
  );
}

async function turnedOn(userId: string, recoveryKey = generateRecoveryKey()) {
  expect(await createPasswordCredential(userId, PASSWORD, recoveryKey)).toBe(true);
  return recoveryKey;
}

const rows = () => ctx.db.select().from(schema.localAuthCredentials).all();

async function enable(over: Record<string, unknown> = {}) {
  const prepared = await (await call({ action: "prepare" })).json();
  const res = await call({
    action: "enable",
    recoveryKey: prepared.recoveryKey,
    expiresAt: prepared.expiresAt,
    ticket: prepared.ticket,
    savedRecoveryKey: true,
    password: PASSWORD,
    confirmPassword: PASSWORD,
    ...over,
  });
  return { res, prepared };
}

describe("turning password sign-in on", () => {
  it("is off by default: no credential exists for anyone", async () => {
    await person();
    expect(await rows()).toHaveLength(0);
  });

  it("shows a fresh recovery key and stores nothing yet", async () => {
    await person();
    const res = await call({ action: "prepare" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.recoveryKey).toMatch(/^([A-Z2-7]{4}-){7}[A-Z2-7]{4}$/);
    expect(await rows()).toHaveLength(0);
  });

  it("requires the saved-the-key tick", async () => {
    await person();
    const { res } = await enable({ savedRecoveryKey: false });
    expect(res.status).toBe(400);
    expect((await res.json()).error.message).toMatch(/saved the recovery key/);
    expect(await rows()).toHaveLength(0);
  });

  it("refuses a recovery key the server did not issue", async () => {
    await person();
    const { res } = await enable({ recoveryKey: "AAAA-AAAA-AAAA-AAAA-AAAA-AAAA-AAAA-AAAA" });
    expect(res.status).toBe(400);
    expect(await rows()).toHaveLength(0);
  });

  it("checks the password length and that both entries match", async () => {
    await person();
    expect((await enable({ password: "short", confirmPassword: "short" })).res.status).toBe(400);
    expect((await enable({ confirmPassword: "does not match this" })).res.status).toBe(400);
    expect(await rows()).toHaveLength(0);
  });

  it("stores only scrypt hashes, never the password or the recovery key", async () => {
    const { user } = await person();
    const { res, prepared } = await enable();
    expect(res.status).toBe(200);
    const [row] = await rows();
    expect(row.userId).toBe(user.id);
    expect(row.passwordHash).toMatch(/^scrypt\$/);
    expect(row.recoveryKeyHash).toMatch(/^scrypt\$/);
    const stored = JSON.stringify(row);
    expect(stored).not.toContain(PASSWORD);
    expect(stored).not.toContain(prepared.recoveryKey);
    expect(stored).not.toContain(prepared.recoveryKey.replaceAll("-", ""));
    expect(await verifyLocalPassword(PASSWORD, row.passwordHash)).toBe(true);
    expect(await verifyLocalPassword(prepared.recoveryKey.replaceAll("-", ""), row.recoveryKeyHash!)).toBe(true);
  });

  it("does not turn on for the local-mode owner or for an account with no email", async () => {
    await person("local:owner", null);
    expect((await call({ action: "prepare" })).status).toBe(404);
    await person("dev:sam", null);
    expect((await call({ action: "prepare" })).status).toBe(400);
  });
});

describe("turning it off", () => {
  it("needs the current password or the recovery key", async () => {
    const { user } = await person();
    await turnedOn(user.id);
    const none = await call({ action: "disable" });
    expect(none.status).toBe(403);
    const wrong = await call({ action: "disable", currentPassword: "not the password at all" });
    expect(wrong.status).toBe(403);
    expect((await wrong.json()).error.message).toBe(PASSWORD_AUTH_ERROR);
    const wrongKey = await call({ action: "disable", recoveryKey: generateRecoveryKey() });
    expect(wrongKey.status).toBe(403);
    expect(await rows()).toHaveLength(1);
  });

  it("works with the current password and keeps this browser signed in", async () => {
    const { user, session } = await person();
    await turnedOn(user.id);
    const res = await call({ action: "disable", currentPassword: PASSWORD });
    expect(res.status).toBe(200);
    expect(await rows()).toHaveLength(0);
    expect((await userForSessionToken(session.token))?.id).toBe(user.id);
  });

  it("works with the recovery key", async () => {
    const { user, session } = await person();
    const key = await turnedOn(user.id);
    const res = await call({ action: "disable", recoveryKey: key.toLowerCase() });
    expect(res.status).toBe(200);
    expect(await rows()).toHaveLength(0);
    expect(await userForSessionToken(session.token)).not.toBeNull();
  });

  it("refuses when the account would have no other way to sign in", async () => {
    // Hack Club sign-in is not set up here, so the password is the only way in.
    vi.stubEnv("HACKCLUB_CLIENT_ID", "");
    vi.stubEnv("HACKCLUB_CLIENT_SECRET", "");
    resetConfigForTests();
    const { user } = await person();
    await turnedOn(user.id);
    const res = await call({ action: "disable", currentPassword: PASSWORD });
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("no_other_sign_in");
    expect(await rows()).toHaveLength(1);
  });

  it("refuses a development account when the development sign-in is off", async () => {
    const { user } = await person("dev:sam", "sam@example.com");
    await turnedOn(user.id);
    expect((await call({ action: "disable", currentPassword: PASSWORD })).status).toBe(409);
    vi.stubEnv("DEV_LOGIN", "1");
    resetConfigForTests();
    expect((await call({ action: "disable", currentPassword: PASSWORD })).status).toBe(200);
  });
});

describe("changing the password", () => {
  it("revokes every session, including the one making the change", async () => {
    const { user, session } = await person();
    await turnedOn(user.id);
    const other = await createSession(user.id);
    const res = await call({ action: "change", currentPassword: PASSWORD, newPassword: NEXT_PASSWORD, confirmPassword: NEXT_PASSWORD });
    expect(res.status).toBe(200);
    expect(await userForSessionToken(session.token)).toBeNull();
    expect(await userForSessionToken(other.token)).toBeNull();
    const cleared = res.headers.getSetCookie().find((c) => c.startsWith(`${SESSION_COOKIE}=`))!;
    expect(cleared).toMatch(/Max-Age=0|Expires=Thu, 01 Jan 1970/i);
    const [row] = await rows();
    expect(await verifyLocalPassword(NEXT_PASSWORD, row.passwordHash)).toBe(true);
    expect(await verifyLocalPassword(PASSWORD, row.passwordHash)).toBe(false);
  });

  it("leaves other people's sessions alone", async () => {
    const { user } = await person();
    await turnedOn(user.id);
    const stranger = await upsertUser({ id: "ident!kim", name: "Kim", email: "kim@example.com", slackId: null });
    const theirs = await createSession(stranger.id);
    await call({ action: "change", currentPassword: PASSWORD, newPassword: NEXT_PASSWORD, confirmPassword: NEXT_PASSWORD });
    expect(await userForSessionToken(theirs.token)).not.toBeNull();
  });

  it("does nothing with a wrong current password", async () => {
    const { user, session } = await person();
    await turnedOn(user.id);
    const before = (await rows())[0].passwordHash;
    const res = await call({ action: "change", currentPassword: "wrong wrong wrong", newPassword: NEXT_PASSWORD, confirmPassword: NEXT_PASSWORD });
    expect(res.status).toBe(403);
    expect((await res.json()).error.message).toBe(PASSWORD_AUTH_ERROR);
    expect((await rows())[0].passwordHash).toBe(before);
    expect(await userForSessionToken(session.token)).not.toBeNull();
  });

  it("keeps the recovery key", async () => {
    const { user } = await person();
    await turnedOn(user.id);
    const before = (await rows())[0].recoveryKeyHash;
    await call({ action: "change", currentPassword: PASSWORD, newPassword: NEXT_PASSWORD, confirmPassword: NEXT_PASSWORD });
    expect((await rows())[0].recoveryKeyHash).toBe(before);
  });
});

async function setFreshAt(token: string, at: Date | null) {
  await ctx.db.update(schema.sessions).set({ freshAuthAt: at }).where(eq(schema.sessions.id, sha256Hex(token)));
}

describe("turning password sign-in on needs a fresh Hack Club sign-in", () => {
  it("refuses to show a recovery key from a session that confirmed more than 5 minutes ago", async () => {
    const { session } = await person();
    await setFreshAt(session.token, new Date(Date.now() - 6 * 60_000));
    const res = await call({ action: "prepare" });
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("reauth_required");
    expect(await rows()).toHaveLength(0);
  });

  it("refuses to store a password from a session that never confirmed, even with a valid ticket", async () => {
    const { session } = await person();
    const prepared = await (await call({ action: "prepare" })).json();
    await setFreshAt(session.token, null);
    const res = await call({
      action: "enable",
      recoveryKey: prepared.recoveryKey,
      expiresAt: prepared.expiresAt,
      ticket: prepared.ticket,
      savedRecoveryKey: true,
      password: PASSWORD,
      confirmPassword: PASSWORD,
    });
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("reauth_required");
    expect(await rows()).toHaveLength(0);
  });

  it("works once the person confirms again, and stores the same hashes as before", async () => {
    const { session, user } = await person();
    await setFreshAt(session.token, new Date(Date.now() - 6 * 60_000));
    expect((await call({ action: "prepare" })).status).toBe(403);
    await markFreshAuth(session.token);
    const { res, prepared } = await enable();
    expect(res.status).toBe(200);
    const [row] = await rows();
    expect(row.userId).toBe(user.id);
    expect(await verifyLocalPassword(PASSWORD, row.passwordHash)).toBe(true);
    expect(await verifyLocalPassword(prepared.recoveryKey.replaceAll("-", ""), row.recoveryKeyHash!)).toBe(true);
  });
});

describe("rate limit", () => {
  it("applies to every action on the account", async () => {
    await person();
    let last = 0;
    for (let i = 0; i < 21; i++) last = (await call({ action: "prepare" })).status;
    expect(last).toBe(429);
  });
});

describe("account removal", () => {
  it("removes the credential with the account", async () => {
    const { user } = await person();
    await turnedOn(user.id);
    await ctx.db.delete(schema.users).where(eq(schema.users.id, user.id));
    expect(await rows()).toHaveLength(0);
  });

  it("is unaffected by the legacy local-owner row", async () => {
    await ctx.db.insert(schema.localAuthCredentials).values({
      id: "local-owner",
      passwordHash: await hashLocalPassword(PASSWORD),
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const { user } = await person();
    await turnedOn(user.id);
    expect(await rows()).toHaveLength(2);
    expect((await call({ action: "disable", currentPassword: PASSWORD })).status).toBe(200);
    expect(await rows()).toHaveLength(1);
  });
});
