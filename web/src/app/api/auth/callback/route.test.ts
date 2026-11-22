import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { resetConfigForTests } from "@/server/config";
import { rateLimiter } from "@/server/rate-limit";
import { useFreshDb } from "@/server/test/db";

// Only the call out to Hack Club is replaced; the route, sessions and database are real.
vi.mock("@/server/auth/hackclub", async (orig) => ({
  ...(await orig<typeof import("@/server/auth/hackclub")>()),
  completeLogin: vi.fn(),
}));
vi.mock("next/server", async (orig) => ({
  ...(await orig<typeof import("next/server")>()),
  connection: async () => undefined,
}));

import { completeLogin } from "@/server/auth/hackclub";
import { GET as callback } from "@/app/api/auth/callback/route";

const APP = "https://deploy.example.com";
const stateCookie = (name: string, value: object) =>
  `${name}=${encodeURIComponent(JSON.stringify(value))}`;
const setCookie = (res: Response, name: string) =>
  res.headers.getSetCookie().find((c) => c.startsWith(`${name}=`)) ?? "";
const req = (url: string, cookie?: string) =>
  new NextRequest(url, { headers: cookie ? { cookie } : {} });

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

describe("login callback state cookie scope", () => {
  it("ignores a lone plain-named cookie planted by a sibling over HTTPS", async () => {
    const planted = stateCookie("egg_oauth", { s: "attacker", v: "verifier" });
    const res = await callback(req(`${APP}/api/auth/callback?code=c&state=attacker`, planted));
    expect(res.headers.get("location")).toContain("error=invalid_request");
    expect(completeLogin).not.toHaveBeenCalled();
  });

  it("uses the __Host- cookie and rejects a second one even when it arrives last", async () => {
    const good = stateCookie("__Host-egg_oauth", { s: "good", v: "verifier" });
    const bad = stateCookie("__Host-egg_oauth", { s: "attacker", v: "verifier" });
    const res = await callback(req(`${APP}/api/auth/callback?code=c&state=attacker`, `${good}; ${bad}`));
    expect(res.headers.get("location")).toContain("error=state_mismatch");
    expect(setCookie(res, "__Host-egg_oauth")).toMatch(/Max-Age=0|Expires=/i);
    expect(completeLogin).not.toHaveBeenCalled();
  });

  it("still accepts a plain cookie over local HTTP", async () => {
    const previous = process.env.APP_URL;
    process.env.APP_URL = "http://localhost:3000";
    resetConfigForTests();
    try {
      vi.mocked(completeLogin).mockResolvedValue({ id: "ident!local", name: "Rae", email: null, slackId: null });
      const res = await callback(
        req("http://localhost:3000/api/auth/callback?code=c&state=st", stateCookie("egg_oauth", { s: "st", v: "v" }))
      );
      expect(new URL(res.headers.get("location")!).pathname).toBe("/projects");
      expect(completeLogin).toHaveBeenCalledWith("c", "v");
    } finally {
      process.env.APP_URL = previous;
      resetConfigForTests();
    }
  });
});
