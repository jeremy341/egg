import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { resetConfigForTests } from "@/server/config";
import { createOAuthStateBinding } from "@/server/auth/oauth-state";

const APP = "https://deploy.example.com";
const USER = { id: "usr_1", name: "Sam", email: null, hackClubId: "ident!sam" };
const STATE = "random-oauth-state";

vi.mock("next/server", async (orig) => ({
  ...(await orig<typeof import("next/server")>()),
  connection: async () => undefined,
}));
vi.mock("@/server/auth/current", () => ({ getCurrentUser: vi.fn() }));
vi.mock("@/server/maintenance", () => ({ maintenanceBlocksUser: vi.fn(async () => false) }));
vi.mock("@/server/github/app", () => ({
  githubAuthorizeUrl: vi.fn(() => ({ url: "https://github.com/login/oauth/authorize?state=x", state: STATE })),
  installationsForCode: vi.fn(async () => []),
  saveInstallations: vi.fn(async () => undefined),
}));

import { getCurrentUser } from "@/server/auth/current";
import { saveInstallations } from "@/server/github/app";
import { GET as connect } from "@/app/api/github/connect/route";
import { GET as callback } from "@/app/api/github/callback/route";

beforeAll(() => {
  process.env.APP_URL = APP;
  process.env.GITHUB_APP_ID = "1";
  process.env.GITHUB_APP_PRIVATE_KEY = "test-private-key";
  process.env.GITHUB_APP_CLIENT_ID = "client-id";
  process.env.GITHUB_APP_CLIENT_SECRET = "client-secret";
  process.env.GITHUB_WEBHOOK_SECRET = "webhook-secret";
  resetConfigForTests();
});
afterAll(() => {
  process.env.APP_URL = "http://localhost:3000";
  for (const key of [
    "GITHUB_APP_ID",
    "GITHUB_APP_PRIVATE_KEY",
    "GITHUB_APP_CLIENT_ID",
    "GITHUB_APP_CLIENT_SECRET",
    "GITHUB_WEBHOOK_SECRET",
  ]) delete process.env[key];
  resetConfigForTests();
});
beforeEach(() => {
  vi.mocked(getCurrentUser).mockResolvedValue(USER);
  vi.mocked(saveInstallations).mockClear();
});

const req = (path: string, cookie?: string) =>
  new NextRequest(`${APP}${path}`, { headers: cookie ? { cookie } : {} });
const setCookie = (res: Response, name: string) => res.headers.getSetCookie().find((c) => c.startsWith(`${name}=`)) ?? "";
const valueOf = (cookie: string) => decodeURIComponent(cookie.split(";")[0].split("=").slice(1).join("="));
const stateCookie = (value: string) => `egg_gh_state=${encodeURIComponent(value)}`;
const bound = (userId: string, state = STATE) => createOAuthStateBinding(userId, state);

describe("GitHub linking state", () => {
  it("sets a user-bound state cookie at the root path", async () => {
    const res = await connect();
    const cookie = setCookie(res, "egg_gh_state");
    expect(cookie).toMatch(/Path=\/(?:;|$)/i);
    expect(valueOf(cookie)).toBe(bound(USER.id));
  });

  it("completes linking for the user the state was bound to", async () => {
    const res = await callback(req(`/api/github/callback?code=c&state=${STATE}`, stateCookie(bound(USER.id))));
    expect(res.headers.get("location")).toBe(`${APP}/new?github=connected`);
    expect(saveInstallations).toHaveBeenCalledWith(USER.id, []);
  });

  it("rejects a state bound to a different session user", async () => {
    const res = await callback(req(`/api/github/callback?code=c&state=${STATE}`, stateCookie(bound("usr_other"))));
    expect(res.headers.get("location")).toBe(`${APP}/new?github=invalid_state`);
    expect(saveInstallations).not.toHaveBeenCalled();
  });

  it("rejects a forged state binding", async () => {
    const res = await callback(req(`/api/github/callback?code=c&state=${STATE}`, stateCookie(`${bound(USER.id)}x`)));
    expect(res.headers.get("location")).toBe(`${APP}/new?github=invalid_state`);
    expect(saveInstallations).not.toHaveBeenCalled();
  });

  it("rejects a tossed second state cookie instead of letting it win", async () => {
    const cookie = `${stateCookie(bound(USER.id))}; ${stateCookie(bound(USER.id, "attacker-state"))}`;
    const res = await callback(req(`/api/github/callback?code=c&state=attacker-state`, cookie));
    expect(res.headers.get("location")).toBe(`${APP}/new?github=invalid_state`);
    expect(setCookie(res, "egg_gh_state")).toMatch(/Max-Age=0|Expires=/i);
    expect(saveInstallations).not.toHaveBeenCalled();
  });
});
