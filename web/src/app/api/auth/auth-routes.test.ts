import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { resetConfigForTests } from "@/server/config";
import { SESSION_COOKIE, createSession, isFreshAuth, upsertUser, userForSessionToken } from "@/server/auth/session";
import { oauthStateCookieName } from "@/server/auth/oauth-cookie";
import { sha256Hex } from "@/server/crypto";
import { rateLimiter } from "@/server/rate-limit";
import { useFreshDb } from "@/server/test/db";

// Only the call out to Hack Club is replaced; the routes, sessions and database are real.
vi.mock("@/server/auth/hackclub", async (orig) => ({
  ...(await orig<typeof import("@/server/auth/hackclub")>()),
  completeLogin: vi.fn(),
}));

// `connection()` only works inside a real request; here it is a no-op.
vi.mock("next/server", async (orig) => ({
  ...(await orig<typeof import("next/server")>()),
  connection: async () => undefined,
}));

import { completeLogin } from "@/server/auth/hackclub";
import { GET as callback } from "@/app/api/auth/callback/route";
import { POST as dev } from "@/app/api/auth/dev/route";
import { GET as login } from "@/app/api/auth/login/route";
import { GET as reauth } from "@/app/api/auth/reauth/route";

const APP = "https://deploy.example.com";
let ctx: Awaited<ReturnType<typeof useFreshDb>>;

beforeAll(async () => {
  process.env.HACKCLUB_CLIENT_ID = "client-id";
  process.env.HACKCLUB_CLIENT_SECRET = "client-secret";
  process.env.APP_URL = APP;
  resetConfigForTests();
  ctx = await useFreshDb();
});
afterAll(async () => {
  await ctx.cleanup();
  delete process.env.HACKCLUB_CLIENT_ID;
  delete process.env.HACKCLUB_CLIENT_SECRET;
  process.env.APP_URL = "http://localhost:3000";
  resetConfigForTests();
});
beforeEach(() => {
  vi.stubEnv("TRUST_PROXY", "1");
  rateLimiter().clear();
  vi.mocked(completeLogin).mockReset();
});
afterEach(() => vi.unstubAllEnvs());

const req = (path: string, headers: Record<string, string> = {}, init: ConstructorParameters<typeof NextRequest>[1] = {}) =>
  new NextRequest(`${APP}${path}`, { headers, ...init });
const oauth = (value: object | string) =>
  `${oauthStateCookieName()}=${encodeURIComponent(typeof value === "string" ? value : JSON.stringify(value))}`;
const setCookie = (res: Response, name: string) => res.headers.getSetCookie().find((c) => c.startsWith(`${name}=`)) ?? "";
const valueOf = (cookie: string) => decodeURIComponent(cookie.split(";")[0].split("=").slice(1).join("="));

async function signedIn(hackClubId = "ident!r") {
  const user = await upsertUser({ id: hackClubId, name: "Rae", email: null, slackId: null });
  const { token } = await createSession(user.id);
  return { user, token };
}

describe("open redirects", () => {
  const evil = ["/\t/evil.example", "//evil.example", "/\n/evil.example", String.raw`/\evil.example`, "https://evil.example"];

  it.each(evil)("reauth drops the next value %j before it is stored", async (next) => {
    const { token } = await signedIn();
    const res = await reauth(req(`/api/auth/reauth?next=${encodeURIComponent(next)}`, { cookie: `${SESSION_COOKIE}=${token}` }));
    const saved = JSON.parse(valueOf(setCookie(res, oauthStateCookieName())));
    expect(saved.p).toBe("reauth");
    expect(saved.n).toBe("/account");
    expect(saved.r).toBe(sha256Hex(token));
  });

  it("reauth keeps a real local path", async () => {
    const { token } = await signedIn();
    const res = await reauth(req("/api/auth/reauth?next=%2Fprojects%2Fabc", { cookie: `${SESSION_COOKIE}=${token}` }));
    expect(JSON.parse(valueOf(setCookie(res, oauthStateCookieName()))).n).toBe("/projects/abc");
  });

  it.each(evil)("the callback never sends people to %j", async (n) => {
    const { token } = await signedIn("ident!c");
    vi.mocked(completeLogin).mockResolvedValue({ id: "ident!c", name: "Rae", email: null, slackId: null });
    const res = await callback(
      req("/api/auth/callback?code=c&state=st", { cookie: `${SESSION_COOKIE}=${token}; ${oauth({ s: "st", v: "v", p: "reauth", n, r: sha256Hex(token) })}` })
    );
    expect(res.status).toBe(303);
    expect(new URL(res.headers.get("location")!).origin).toBe(APP);
  });
});

describe("the callback", () => {
  it("gives every sign-in a new session and ends the one it replaces", async () => {
    const { token: old } = await signedIn("ident!s");
    vi.mocked(completeLogin).mockResolvedValue({ id: "ident!s", name: "Rae", email: null, slackId: null });
    const res = await callback(req("/api/auth/callback?code=c&state=st", { cookie: `${SESSION_COOKIE}=${old}; ${oauth({ s: "st", v: "v" })}` }));
    expect(new URL(res.headers.get("location")!).pathname).toBe("/projects");
    const fresh = valueOf(setCookie(res, SESSION_COOKIE));
    expect(fresh).not.toBe(old);
    expect(await userForSessionToken(old)).toBeNull();
    expect(await userForSessionToken(fresh)).not.toBeNull();
    expect(await isFreshAuth(fresh)).toBe(true);
  });

  it("sets the session cookie httpOnly, SameSite=Lax and Secure in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.mocked(completeLogin).mockResolvedValue({ id: "ident!f", name: "Rae", email: null, slackId: null });
    const res = await callback(req("/api/auth/callback?code=c&state=st", { cookie: oauth({ s: "st", v: "v" }) }));
    const cookie = setCookie(res, SESSION_COOKIE);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=lax/i);
    expect(cookie).toMatch(/Secure/i);
    expect(cookie).toMatch(/Path=\//i);
  });

  it.each(["null", "42", "[]", "{", '{"s":1,"v":2}', '{"v":"v"}'])(
    "answers a broken sign-in cookie %s with a redirect, not a 500",
    async (raw) => {
      const res = await callback(req("/api/auth/callback?code=c&state=st", { cookie: oauth(raw) }));
      expect(res.status).toBe(303);
      expect(res.headers.get("location")).toContain("error=invalid_request");
      expect(completeLogin).not.toHaveBeenCalled();
    }
  );

  it("refuses a state that does not match", async () => {
    const res = await callback(req("/api/auth/callback?code=c&state=other", { cookie: oauth({ s: "st", v: "v" }) }));
    expect(res.headers.get("location")).toContain("error=state_mismatch");
    expect(completeLogin).not.toHaveBeenCalled();
  });

  it("refuses a tossed second sign-in cookie instead of letting it win", async () => {
    const cookie = `${oauth({ s: "st", v: "v" })}; ${oauth({ s: "attacker", v: "attacker" })}`;
    const res = await callback(req("/api/auth/callback?code=c&state=attacker", { cookie }));
    expect(res.headers.get("location")).toContain("error=state_mismatch");
    expect(setCookie(res, oauthStateCookieName())).toMatch(/Max-Age=0|Expires=/i);
    expect(completeLogin).not.toHaveBeenCalled();
  });

  it("does not leak why Hack Club refused", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.mocked(completeLogin).mockRejectedValue(new Error("Hack Club Auth rejected the login (token 400) secret-detail"));
    const res = await callback(req("/api/auth/callback?code=c&state=st", { cookie: oauth({ s: "st", v: "v" }) }));
    expect(res.headers.get("location")).toBe(`${APP}/login?error=login_failed`);
  });
});

describe("sign-in rate limits", () => {
  it("turns an address away from login and callback after 20 tries a minute", async () => {
    const headers = { "x-forwarded-for": "203.0.113.50" };
    for (let i = 0; i < 20; i++) expect((await login(req("/api/auth/login", headers))).status).toBe(303);
    const limited = await login(req("/api/auth/login", headers));
    expect(limited.headers.get("location")).toBe(`${APP}/login?error=rate_limited`);
    expect(Number(limited.headers.get("retry-after"))).toBeGreaterThanOrEqual(1);
    // The same address is also turned away from the callback; other addresses are not.
    expect((await callback(req("/api/auth/callback?code=c&state=s", headers))).headers.get("location")).toContain("rate_limited");
    expect((await login(req("/api/auth/login", { "x-forwarded-for": "203.0.113.51" }))).headers.get("location")).toContain("auth.hackclub.com");
  });

  it("sets the sign-in state cookie httpOnly and Lax, scoped to the whole site", async () => {
    const res = await login(req("/api/auth/login"));
    const cookie = setCookie(res, oauthStateCookieName());
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=lax/i);
    expect(cookie).toMatch(/Path=\/(?:;|$)/i);
  });
});

describe("development sign-in", () => {
  const post = (headers: Record<string, string> = {}) => {
    const body = new FormData();
    body.set("name", "Dev");
    return dev(req("/api/auth/dev", headers, { method: "POST", body }), undefined);
  };

  it("works when the development switch is on and the build is not production", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const res = await post();
    expect(res.status).toBe(303);
    expect(setCookie(res, SESSION_COOKIE)).not.toBe("");
  });

  it("is a 404 with no session in production, whatever DEV_LOGIN says", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const res = await post();
    expect(res.status).toBe(404);
    expect(setCookie(res, SESSION_COOKIE)).toBe("");
  });

  it("is a 404 when the switch is off", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("DEV_LOGIN", "0");
    resetConfigForTests();
    try {
      expect((await post()).status).toBe(404);
    } finally {
      vi.unstubAllEnvs();
      resetConfigForTests();
    }
  });

  it("refuses a cross-site form post", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const res = await post({ origin: "https://evil.example" });
    expect(res.status).toBe(403);
  });
});

describe("host-only OAuth state cookie", () => {
  async function withAppUrl(url: string, run: () => Promise<void>) {
    const previous = process.env.APP_URL;
    process.env.APP_URL = url;
    resetConfigForTests();
    try {
      await run();
    } finally {
      process.env.APP_URL = previous;
      resetConfigForTests();
    }
  }

  it("sets a __Host- cookie with Secure and no Domain over HTTPS", async () => {
    const res = await login(req("/api/auth/login"));
    const cookie = setCookie(res, "__Host-egg_oauth");
    expect(cookie).toMatch(/^__Host-egg_oauth=/);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/Secure/i);
    expect(cookie).toMatch(/Path=\/(?:;|$)/i);
    expect(cookie).not.toMatch(/Domain=/i);
    expect(setCookie(res, "egg_oauth")).toBe("");
  });

  it("keeps the plain name on local HTTP", async () => {
    await withAppUrl("http://localhost:3000", async () => {
      const res = await login(new NextRequest("http://localhost:3000/api/auth/login"));
      const cookie = setCookie(res, "egg_oauth");
      expect(cookie).toMatch(/^egg_oauth=/);
      expect(cookie).toMatch(/Path=\/(?:;|$)/i);
      expect(setCookie(res, "__Host-egg_oauth")).toBe("");
    });
  });

  it("completes sign-in with the prefixed cookie and expires it with Secure", async () => {
    vi.mocked(completeLogin).mockResolvedValue({ id: "ident!host", name: "Rae", email: null, slackId: null });
    const res = await callback(req("/api/auth/callback?code=c&state=st", { cookie: oauth({ s: "st", v: "v" }) }));
    expect(new URL(res.headers.get("location")!).pathname).toBe("/projects");
    const cleared = setCookie(res, oauthStateCookieName());
    expect(cleared).toMatch(/Max-Age=0|Expires=/i);
    expect(cleared).toMatch(/Secure/i);
    expect(cleared).toMatch(/Path=\/(?:;|$)/i);
    expect(cleared).not.toMatch(/Domain=/i);
  });

  it("still refuses a second planted __Host- cookie", async () => {
    const cookie = `${oauth({ s: "st", v: "v" })}; ${oauth({ s: "attacker", v: "attacker" })}`;
    const res = await callback(req("/api/auth/callback?code=c&state=attacker", { cookie }));
    expect(res.headers.get("location")).toContain("error=state_mismatch");
    expect(completeLogin).not.toHaveBeenCalled();
  });

  it("binds a reauth callback to the session that started it", async () => {
    const { token } = await signedIn("ident!bound");
    const { token: other } = await signedIn("ident!bound");
    vi.mocked(completeLogin).mockResolvedValue({ id: "ident!bound", name: "Rae", email: null, slackId: null });
    const started = JSON.parse(
      valueOf(setCookie(await reauth(req("/api/auth/reauth?next=/projects", { cookie: `${SESSION_COOKIE}=${token}` })), oauthStateCookieName()))
    );
    expect(started.r).toBe(sha256Hex(token));

    // Replaying the callback in a different session must not mark that session fresh.
    const res = await callback(
      req("/api/auth/callback?code=c&state=st", { cookie: `${SESSION_COOKIE}=${other}; ${oauth({ ...started, s: "st" })}` })
    );
    expect(res.headers.get("location")).toBe(`${APP}/account?reauth=mismatch`);
    expect(await isFreshAuth(other)).toBe(false);
    expect(await isFreshAuth(token)).toBe(false);
  });

  it("marks the originating session fresh when the bound reauth completes", async () => {
    const { token } = await signedIn("ident!ok");
    vi.mocked(completeLogin).mockResolvedValue({ id: "ident!ok", name: "Rae", email: null, slackId: null });
    const started = JSON.parse(
      valueOf(setCookie(await reauth(req("/api/auth/reauth?next=/projects", { cookie: `${SESSION_COOKIE}=${token}` })), oauthStateCookieName()))
    );
    const res = await callback(
      req("/api/auth/callback?code=c&state=st", { cookie: `${SESSION_COOKIE}=${token}; ${oauth({ ...started, s: "st" })}` })
    );
    expect(res.headers.get("location")).toBe(`${APP}/projects`);
    expect(await isFreshAuth(token)).toBe(true);
  });
});
