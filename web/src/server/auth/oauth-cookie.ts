import type { NextResponse } from "next/server";
import { config } from "@/server/config";

/**
 * Single source of truth for the short-lived OAuth handshake cookies.
 *
 * A sibling subdomain can plant a parent-domain cookie (`Domain=example.com`)
 * with the same name as our host-only state cookie. The callback's duplicate
 * check only notices a *second* cookie, so one planted cookie carrying the
 * attacker's state and PKCE verifier is enough to sign the victim into the
 * attacker's account. Over HTTPS we use the `__Host-` prefix: browsers only
 * accept such a cookie when it is Secure, Path=/ and has no Domain, and only
 * from the exact host that set it. A sibling can no longer plant one for the
 * parent host. Plain HTTP (local development) keeps the legacy names because
 * `__Host-` requires Secure and would be ignored there.
 */

/** Legacy, unprefixed cookie names. Kept for local HTTP and for clearing old cookies. */
export const HACK_CLUB_STATE_COOKIE = "egg_oauth";
export const GITHUB_STATE_COOKIE = "egg_gh_state";

/** True when APP_URL says the app is served over HTTPS. */
export function appServedOverHttps(): boolean {
  try {
    return new URL(config().APP_URL).protocol === "https:";
  } catch {
    return false;
  }
}

/** The name to use for a state cookie with the given legacy base name. */
export function oauthCookieName(base: string): string {
  return appServedOverHttps() ? `__Host-${base}` : base;
}

/** Hack Club login / reauth state cookie. */
export function oauthStateCookieName(): string {
  return oauthCookieName(HACK_CLUB_STATE_COOKIE);
}

/** GitHub App account-linking state cookie. */
export function githubStateCookieName(): string {
  return oauthCookieName(GITHUB_STATE_COOKIE);
}

/** Attributes shared by every short-lived OAuth state cookie. */
export function oauthCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    // Required by __Host-; keep the previous production-only behaviour for
    // plain HTTP local development.
    secure: appServedOverHttps() || process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 600,
  };
}

/** Expire a state cookie with the same scope it was set with. */
export function expireOauthCookie(res: NextResponse, name: string, path = "/") {
  const { secure } = oauthCookieOptions();
  res.cookies.delete({ name, path, secure });
}
