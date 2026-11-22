import { NextResponse, type NextRequest } from "next/server";
import { completeLogin } from "@/server/auth/hackclub";
import {
  SESSION_COOKIE,
  createSession,
  markFreshAuth,
  sessionCookieOptions,
  upsertUser,
  userForSessionToken,
} from "@/server/auth/session";
import {
  HACK_CLUB_STATE_COOKIE,
  expireOauthCookie,
  oauthStateCookieName,
} from "@/server/auth/oauth-cookie";
import { parseOauthCookie, safeNextPath } from "@/server/auth/redirect";
import { throttleSignIn } from "@/server/auth/throttle";
import { audit } from "@/server/audit";
import { config } from "@/server/config";
import { safeEqual, sha256Hex } from "@/server/crypto";

// Clear the OAuth handshake cookie wherever it may be scoped. An old build scoped the
// unprefixed cookie to /api/auth (and to /); leaving one behind could pair it with the
// root-scoped cookie the routes now set.
function clearOauthCookies(res: NextResponse) {
  const name = oauthStateCookieName();
  // ResponseCookies keys Set-Cookie by name, so the last write wins. Clear the
  // legacy /api/auth scope first and always finish with the root-scoped cookie.
  expireOauthCookie(res, HACK_CLUB_STATE_COOKIE, "/api/auth");
  if (name !== HACK_CLUB_STATE_COOKIE) expireOauthCookie(res, HACK_CLUB_STATE_COOKIE);
  expireOauthCookie(res, name);
}

function back(error: string, to = "/login") {
  const url = new URL(to, config().APP_URL);
  url.searchParams.set(to === "/login" ? "error" : "reauth", error);
  const res = NextResponse.redirect(url, 303);
  clearOauthCookies(res);
  return res;
}

export async function GET(req: NextRequest) {
  const throttled = throttleSignIn(req);
  if (throttled) return throttled;

  const params = req.nextUrl.searchParams;
  if (params.get("error")) return back("denied");

  const code = params.get("code");
  const state = params.get("state");
  const name = oauthStateCookieName();
  const cookies = req.cookies.getAll(name);
  const header = req.headers.get("cookie") ?? "";
  const repeated = header.split(";").filter((part) => part.trimStart().startsWith(`${name}=`)).length > 1;
  // Two cookies with this name mean one was planted. RequestCookies keeps only
  // the last, so also count them in the raw header before it can decide for us.
  if (cookies.length > 1 || repeated) return back("state_mismatch");
  const raw = cookies[0]?.value;
  if (!code || !state || !raw) return back("invalid_request");

  const saved = parseOauthCookie(raw);
  if (!saved) return back("invalid_request");
  if (!safeEqual(saved.s, state)) return back("state_mismatch");

  try {
    const profile = await completeLogin(code, saved.v);

    if (saved.p === "reauth") {
      // Confirming again: the same Hack Club account must be the one signed in here.
      const token = req.cookies.get(SESSION_COOKIE)?.value;
      const user = await userForSessionToken(token);
      if (!user || !token || user.hackClubId !== profile.id) return back("mismatch", "/account");
      // The state cookie carries a hash of the session that started this
      // confirmation. Never mark a different session fresh, even if a valid
      // callback URL is replayed against it.
      if (!saved.r || !safeEqual(saved.r, sha256Hex(token))) return back("mismatch", "/account");
      await markFreshAuth(token);
      await audit(user.id, "auth.reauth");
      const next = safeNextPath(saved.n);
      const res = NextResponse.redirect(new URL(next, config().APP_URL), 303);
      clearOauthCookies(res);
      return res;
    }
    const user = await upsertUser(profile);
    const session = await createSession(
      user.id,
      req.headers.get("user-agent"),
      req.cookies.get(SESSION_COOKIE)?.value,
      { freshHackClubAuth: true }
    );
    const res = NextResponse.redirect(new URL("/projects", config().APP_URL), 303);
    res.cookies.set(SESSION_COOKIE, session.token, sessionCookieOptions(session.expiresAt));
    clearOauthCookies(res);
    return res;
  } catch (err) {
    console.error("Hack Club login failed", err);
    return back("login_failed");
  }
}
