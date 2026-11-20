import { NextResponse, type NextRequest } from "next/server";
import { completeLogin } from "@/server/auth/hackclub";
import {
  OAUTH_COOKIE,
  SESSION_COOKIE,
  createSession,
  markFreshAuth,
  sessionCookieOptions,
  upsertUser,
  userForSessionToken,
} from "@/server/auth/session";
import { parseOauthCookie, safeNextPath } from "@/server/auth/redirect";
import { throttleSignIn } from "@/server/auth/throttle";
import { audit } from "@/server/audit";
import { config } from "@/server/config";
import { safeEqual } from "@/server/crypto";

// Clear the OAuth handshake cookie wherever it may be scoped. An old build scoped it to
// /api/auth; leaving that one behind would pair it with the root-scoped cookie the routes
// now set, and the planted-cookie check below would refuse every callback until it expired.
function clearOauthCookies(res: NextResponse) {
  res.cookies.delete({ name: OAUTH_COOKIE, path: "/" });
  res.cookies.delete({ name: OAUTH_COOKIE, path: "/api/auth" });
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
  const cookies = req.cookies.getAll(OAUTH_COOKIE);
  const header = req.headers.get("cookie") ?? "";
  const repeated = header.split(";").filter((part) => part.trimStart().startsWith(`${OAUTH_COOKIE}=`)).length > 1;
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
