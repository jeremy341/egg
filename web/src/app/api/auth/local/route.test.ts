import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { resetConfigForTests } from "@/server/config";
import { SESSION_COOKIE, createSession, upsertUser, userForSessionToken } from "@/server/auth/session";
import { rateLimiter } from "@/server/rate-limit";
import { useFreshDb } from "@/server/test/db";
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
beforeEach(() => rateLimiter().clear());
afterEach(() => {
  vi.unstubAllEnvs();
  resetConfigForTests();
});

function env(vars: Record<string, string | undefined>) {
  for (const [k, v] of Object.entries(vars)) vi.stubEnv(k, v as string);
  resetConfigForTests();
}
const post = (url = "http://localhost:3000/api/auth/local", headers: Record<string, string> = {}) =>
  local(new NextRequest(url, { method: "POST", headers }), undefined);
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
    const res = await post();
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("http://localhost:3000/projects");
    const token = decodeURIComponent(cookie(res).split(";")[0].split("=").slice(1).join("="));
    expect((await userForSessionToken(token))?.hackClubId).toBe("local:owner");
  });

  it("signs in as the same owner every time", async () => {
    env({ LOCAL_MODE: "1" });
    const a = decodeURIComponent(cookie(await post()).split(";")[0].split("=")[1]);
    const b = decodeURIComponent(cookie(await post()).split(";")[0].split("=")[1]);
    const [ua, ub] = await Promise.all([userForSessionToken(a), userForSessionToken(b)]);
    expect(ua?.id).toBe(ub?.id);
  });

  it("refuses a request that arrives on a non-local host", async () => {
    env({ LOCAL_MODE: "1" });
    const res = await post("http://192.168.1.20:3000/api/auth/local", { host: "192.168.1.20:3000" });
    expect(res.status).toBe(403);
    expect(cookie(res)).toBe("");
  });

  it("allows that host with the explicit override", async () => {
    env({ LOCAL_MODE: "1", LOCAL_MODE_ALLOW_REMOTE: "1", APP_URL: "https://egg.example.com" });
    const res = await post("https://egg.example.com/api/auth/local", { host: "egg.example.com" });
    expect(res.status).toBe(303);
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
