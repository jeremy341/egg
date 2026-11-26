import { connection, NextResponse, type NextRequest } from "next/server";
import { createAuthRequest } from "@/server/auth/hackclub";
import { OAUTH_COOKIE, SESSION_COOKIE, markFreshAuth, userForSessionToken } from "@/server/auth/session";
import { safeNextPath } from "@/server/auth/redirect";
import { throttleSignIn } from "@/server/auth/throttle";
import { config, hackClubConfigured, localModeEnabled } from "@/server/config";

/**
 * Confirm with Hack Club again, to unlock the terminal and file changes. Only a
 * signed-in session can start this; the callback then checks that the same
 * Hack Club account signed in before it marks the session as freshly confirmed.
 */
export async function GET(req: NextRequest) {
  await connection();
  const throttled = throttleSignIn(req);
  if (throttled) return throttled;
  const home = config().APP_URL;
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (!(await userForSessionToken(token))) {
    return NextResponse.redirect(new URL("/login", home), 303);
  }
  // Only same-site relative paths, so this cannot send people elsewhere.
  const next = safeNextPath(req.nextUrl.searchParams.get("next"));

  if (!hackClubConfigured()) {
    // The development sign-in and local mode already skip Hack Club, so the confirmation
    // is skipped the same way. Only local mode does this in a production build.
    if (localModeEnabled() || (config().DEV_LOGIN && process.env.NODE_ENV !== "production")) {
      await markFreshAuth(token!);
      return NextResponse.redirect(new URL(next, home), 303);
    }
    return NextResponse.redirect(new URL("/account?reauth=not_configured", home), 303);
  }

  const auth = createAuthRequest();
  const res = NextResponse.redirect(auth.url, 303);
  res.cookies.set(
    OAUTH_COOKIE,
    JSON.stringify({ s: auth.state, v: auth.codeVerifier, p: "reauth", n: next }),
    {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/api/auth",
      maxAge: 600,
    }
  );
  return res;
}
