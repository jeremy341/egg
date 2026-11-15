import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { resetConfigForTests } from "@/server/config";
import { SESSION_COOKIE, createSession, upsertUser, userForSessionToken } from "@/server/auth/session";
import { verifyLocalPassword } from "@/server/auth/local-password";
import { PASSWORD_AUTH_ERROR, createPasswordCredential, generateRecoveryKey, normalizeRecoveryKey } from "@/server/auth/password-signin";
import { sha256Hex } from "@/server/crypto";
import { useFreshDb } from "@/server/test/db";
import { schema } from "@/server/db";
import { rateLimiter } from "@/server/rate-limit";
import { POST as signIn } from "@/app/api/auth/password/route";
import { POST as reset } from "@/app/api/auth/password/reset/route";

vi.mock("next/server", async (orig) => ({
  ...(await orig<typeof import("next/server")>()),
  connection: async () => undefined,
}));

let ctx: Awaited<ReturnType<typeof useFreshDb>>;
beforeAll(async () => {
  ctx = await useFreshDb();
});
afterAll(async () => {
  await ctx.cleanup();
});
beforeEach(async () => {
  vi.stubEnv("APP_URL", "http://localhost:3000");
  resetConfigForTests();
  rateLimiter().clear();
  await ctx.db.delete(schema.localAuthCredentials);
  await ctx.db.delete(schema.sessions);
});
afterEach(() => {
  vi.unstubAllEnvs();
  resetConfigForTests();
});

const EMAIL = "sam@example.com";
const PASSWORD = "a long enough password";
const NEXT_PASSWORD = "another long enough password";

async function member(withPassword = true) {
  const user = await upsertUser({ id: "ident!sam", name: "Sam", email: "Sam@Example.com", slackId: null });
  const recoveryKey = generateRecoveryKey();
  if (withPassword) await createPasswordCredential(user.id, PASSWORD, recoveryKey);
  return { user, recoveryKey };
}

const form = (fields: Record<string, string>) =>
  signIn(
    new NextRequest("http://localhost:3000/api/auth/password", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(fields).toString(),
    }),
    undefined
  );

const resetWith = (fields: Record<string, string>) =>
  reset(
    new NextRequest("http://localhost:3000/api/auth/password/reset", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: EMAIL, newPassword: NEXT_PASSWORD, confirmPassword: NEXT_PASSWORD, ...fields }),
    }),
    undefined
  );

const cookie = (res: Response) => res.headers.getSetCookie().find((c) => c.startsWith(`${SESSION_COOKIE}=`)) ?? "";
const rows = () => ctx.db.select().from(schema.localAuthCredentials).all();

describe("password sign-in", () => {
  it("signs in with the email and password, whatever the email's case", async () => {
    const { user } = await member();
    const res = await form({ email: "  SAM@example.com", password: PASSWORD });
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("http://localhost:3000/projects");
    const token = decodeURIComponent(cookie(res).split(";")[0].split("=").slice(1).join("="));
    expect((await userForSessionToken(token))?.id).toBe(user.id);
  });

  it("gives the same answer for a wrong password, an unknown email and an account with no password", async () => {
    await member();
    await upsertUser({ id: "ident!kim", name: "Kim", email: "kim@example.com", slackId: null });
    const wrong = await form({ email: EMAIL, password: "not the right password" });
    const unknown = await form({ email: "nobody@example.com", password: PASSWORD });
    const off = await form({ email: "kim@example.com", password: PASSWORD });
    for (const res of [wrong, unknown, off]) {
      expect(res.status).toBe(303);
      expect(cookie(res)).toBe("");
    }
    const places = [wrong, unknown, off].map((r) => r.headers.get("location"));
    expect(new Set(places).size).toBe(1);
    expect(places[0]).toContain("error=password_invalid");
  });

  it("does not sign in while it is off, even with the right password", async () => {
    await member(false);
    const res = await form({ email: EMAIL, password: PASSWORD });
    expect(cookie(res)).toBe("");
  });

  it("is rate limited per address and per account", async () => {
    await member();
    const bucket = `signIn:password-email:${sha256Hex(EMAIL)}`;
    for (let i = 0; i < 20; i++) rateLimiter().check(bucket, 20, 60_000);
    const res = await form({ email: EMAIL, password: PASSWORD });
    expect(res.headers.get("location")).toContain("error=rate_limited");
    expect(res.headers.get("retry-after")).not.toBeNull();
    expect(cookie(res)).toBe("");

    rateLimiter().clear();
    for (let i = 0; i < 20; i++) rateLimiter().check("signIn:password:unknown-client", 20, 60_000);
    expect((await form({ email: EMAIL, password: PASSWORD })).headers.get("location")).toContain("error=rate_limited");
  });
});

describe("reset with the recovery key", () => {
  it("sets the new password, rotates the recovery key and revokes every session", async () => {
    const { user, recoveryKey } = await member();
    const a = await createSession(user.id);
    const b = await createSession(user.id);
    const before = (await rows())[0];

    const res = await resetWith({ recoveryKey: recoveryKey.toLowerCase() });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.recoveryKey).toMatch(/^([A-Z2-7]{4}-){7}[A-Z2-7]{4}$/);
    expect(body.recoveryKey).not.toBe(recoveryKey);
    // The reset signs nobody in.
    expect(cookie(res)).toBe("");
    expect(await userForSessionToken(a.token)).toBeNull();
    expect(await userForSessionToken(b.token)).toBeNull();

    const [row] = await rows();
    expect(row.recoveryKeyHash).not.toBe(before.recoveryKeyHash);
    expect(await verifyLocalPassword(NEXT_PASSWORD, row.passwordHash)).toBe(true);
    expect(await verifyLocalPassword(PASSWORD, row.passwordHash)).toBe(false);
    expect(await verifyLocalPassword(normalizeRecoveryKey(body.recoveryKey), row.recoveryKeyHash!)).toBe(true);
    expect(await verifyLocalPassword(normalizeRecoveryKey(recoveryKey), row.recoveryKeyHash!)).toBe(false);
    expect(JSON.stringify(row)).not.toContain(NEXT_PASSWORD);
    expect(JSON.stringify(row)).not.toContain(body.recoveryKey.replaceAll("-", ""));

    // The old key is spent; the new password signs in.
    expect((await resetWith({ recoveryKey })).status).toBe(403);
    expect((await form({ email: EMAIL, password: NEXT_PASSWORD })).status).toBe(303);
    expect(cookie(await form({ email: EMAIL, password: NEXT_PASSWORD }))).not.toBe("");
  });

  it("gives one generic message for a wrong key, an unknown email and an account with no password", async () => {
    const { recoveryKey } = await member();
    await upsertUser({ id: "ident!kim", name: "Kim", email: "kim@example.com", slackId: null });
    const wrong = await resetWith({ recoveryKey: generateRecoveryKey() });
    const unknown = await resetWith({ email: "nobody@example.com", recoveryKey });
    const off = await resetWith({ email: "kim@example.com", recoveryKey });
    const malformed = await resetWith({ recoveryKey: "short" });
    for (const res of [wrong, unknown, off, malformed]) {
      expect(res.status).toBe(403);
      expect((await res.json()).error.message).toBe(PASSWORD_AUTH_ERROR);
    }
    expect(await verifyLocalPassword(PASSWORD, (await rows())[0].passwordHash)).toBe(true);
  });

  it("does not reset to a short password or mismatched entries", async () => {
    const { recoveryKey } = await member();
    expect((await resetWith({ recoveryKey, newPassword: "short", confirmPassword: "short" })).status).toBe(400);
    expect((await resetWith({ recoveryKey, confirmPassword: "something else entirely" })).status).toBe(400);
    expect(await verifyLocalPassword(PASSWORD, (await rows())[0].passwordHash)).toBe(true);
  });

  it("is rate limited", async () => {
    const { recoveryKey } = await member();
    for (let i = 0; i < 20; i++) rateLimiter().check(`signIn:password-email:${sha256Hex(EMAIL)}`, 20, 60_000);
    const res = await resetWith({ recoveryKey });
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).not.toBeNull();
    expect(await verifyLocalPassword(PASSWORD, (await rows())[0].passwordHash)).toBe(true);
  });
});
