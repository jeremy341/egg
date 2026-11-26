import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { resetConfigForTests } from "@/server/config";
import { SESSION_COOKIE, createSession, upsertUser, userForSessionToken } from "@/server/auth/session";
import { rateLimiter } from "@/server/rate-limit";
import { useFreshDb } from "@/server/test/db";
import { schema } from "@/server/db";
import { GET as reauth } from "@/app/api/auth/reauth/route";
import { POST as local } from "@/app/api/auth/local/route";

// `connection()` only works inside a real request; here it is a no-op.
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
  rateLimiter().clear();
  await ctx.db.delete(schema.localAuthCredentials);
});
afterEach(() => {
  vi.unstubAllEnvs();
  resetConfigForTests();
});

function env(vars: Record<string, string | undefined>) {
  for (const [k, v] of Object.entries(vars)) vi.stubEnv(k, v as string);
  resetConfigForTests();
}
const LOCAL_SECRET = "test-local-mode-secret-test-local-mode-secret";
const PASSWORD = "correct local owner password";
const post = (
  url = "http://localhost:3000/api/auth/local",
  headers: Record<string, string> = {},
  fields: Record<string, string> = { flow: "login", password: PASSWORD }
) =>
  local(
    new NextRequest(url, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", ...headers },
      body: new URLSearchParams(fields).toString(),
    }),
    undefined
  );
const cookie = (res: Response) => res.headers.getSetCookie().find((c) => c.startsWith(`${SESSION_COOKIE}=`)) ?? "";

describe("local sign-in", () => {
  it("is a 404 and sets no session while LOCAL_MODE is off, even in production", async () => {
    env({ NODE_ENV: "production", LOCAL_MODE: undefined });
    const res = await post();
    expect(res.status).toBe(404);
    expect(cookie(res)).toBe("");
  });

  it("is not unlocked by the development switch", async () => {
    env({ NODE_ENV: "development", DEV_LOGIN: "1", LOCAL_MODE: undefined });
    expect((await post()).status).toBe(404);
  });

  it("signs in the owner in a production build when LOCAL_MODE is on", async () => {
    env({ NODE_ENV: "production", LOCAL_MODE: "1", APP_URL: "http://localhost:3000" });
    const res = await post(undefined, {}, {
      flow: "setup",
      recoveryKey: LOCAL_SECRET,
      newPassword: PASSWORD,
      confirmPassword: PASSWORD,
    });
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("http://localhost:3000/projects");
    const token = decodeURIComponent(cookie(res).split(";")[0].split("=").slice(1).join("="));
    expect((await userForSessionToken(token))?.hackClubId).toBe("local:owner");
    const stored = await ctx.db.select().from(schema.localAuthCredentials).get();
    expect(stored?.passwordHash).toMatch(/^scrypt\$32768\$8\$1\$/);
    expect(stored?.passwordHash).not.toContain(PASSWORD);
  });

  it("signs in as the same owner every time", async () => {
    env({ LOCAL_MODE: "1" });
    await post(undefined, {}, {
      flow: "setup",
      recoveryKey: LOCAL_SECRET,
      newPassword: PASSWORD,
      confirmPassword: PASSWORD,
    });
    const a = decodeURIComponent(cookie(await post()).split(";")[0].split("=")[1]);
    const b = decodeURIComponent(cookie(await post()).split(";")[0].split("=")[1]);
    const [ua, ub] = await Promise.all([userForSessionToken(a), userForSessionToken(b)]);
    expect(ua?.id).toBe(ub?.id);
  });

  it("rejects a wrong local password even if the Host claims loopback", async () => {
    env({ LOCAL_MODE: "1" });
    await post(undefined, {}, {
      flow: "setup",
      recoveryKey: LOCAL_SECRET,
      newPassword: PASSWORD,
      confirmPassword: PASSWORD,
    });
    const res = await post("http://192.168.1.20:3000/api/auth/local", { host: "localhost:3000" }, { flow: "login", password: "wrong password" });
    expect(res.headers.get("location")).toContain("error=local_password");
    expect(cookie(res)).toBe("");
  });

  it("allows that host with the explicit override", async () => {
    env({ LOCAL_MODE: "1", LOCAL_MODE_ALLOW_REMOTE: "1", APP_URL: "https://egg.example.com" });
    const res = await post("https://egg.example.com/api/auth/local", { host: "egg.example.com" }, {
      flow: "setup",
      recoveryKey: LOCAL_SECRET,
      newPassword: PASSWORD,
      confirmPassword: PASSWORD,
    });
    expect(res.status).toBe(303);
  });

  it("requires the recovery key to enroll the first password", async () => {
    env({ LOCAL_MODE: "1" });
    const res = await post(undefined, {}, {
      flow: "setup",
      recoveryKey: "wrong recovery key",
      newPassword: PASSWORD,
      confirmPassword: PASSWORD,
    });
    expect(res.headers.get("location")).toContain("error=local_recovery");
    expect(cookie(res)).toBe("");
  });

  it("resets a lost password with the recovery key and invalidates old sessions", async () => {
    env({ LOCAL_MODE: "1" });
    const initial = await post(undefined, {}, {
      flow: "setup",
      recoveryKey: LOCAL_SECRET,
      newPassword: PASSWORD,
      confirmPassword: PASSWORD,
    });
    const oldToken = decodeURIComponent(cookie(initial).split(";")[0].split("=").slice(1).join("="));
    const updated = await post(undefined, {}, {
      flow: "reset",
      recoveryKey: LOCAL_SECRET,
      newPassword: "new and different owner password",
      confirmPassword: "new and different owner password",
    });
    expect(updated.status).toBe(303);
    expect(await userForSessionToken(oldToken)).toBeNull();
    const loggedIn = await post(undefined, {}, { flow: "login", password: "new and different owner password" });
    expect(loggedIn.status).toBe(303);
  });

  it("uses a shared rate-limit bucket when no trusted client IP is available", async () => {
    env({ LOCAL_MODE: "1" });
    for (let i = 0; i < 20; i++) rateLimiter().check("signIn:local-mode:unknown-client", 20, 60_000);
    const res = await post();
    expect(res.status).toBe(429);
  });

  it("refuses a cross-site post", async () => {
    env({ LOCAL_MODE: "1" });
    const res = await post(undefined, { origin: "https://evil.example" });
    expect(res.status).toBe(403);
  });
});

describe("confirming again in local mode", () => {
  async function confirm() {
    const user = await upsertUser({ id: "local:owner", name: "Owner", email: null, slackId: null });
    const { token } = await createSession(user.id);
    return reauth(
      new NextRequest("http://localhost:3000/api/auth/reauth?next=/projects", {
        headers: { cookie: `${SESSION_COOKIE}=${token}` },
      })
    );
  }

  it("skips Hack Club and returns to the page in a production build", async () => {
    env({ NODE_ENV: "production", LOCAL_MODE: "1" });
    const res = await confirm();
    expect(res.headers.get("location")).toBe("http://localhost:3000/projects");
  });

  it("still reports that confirmation is not set up when local mode is off", async () => {
    env({ NODE_ENV: "production", LOCAL_MODE: undefined, DEV_LOGIN: "0" });
    const res = await confirm();
    expect(res.headers.get("location")).toContain("reauth=not_configured");
  });
});
