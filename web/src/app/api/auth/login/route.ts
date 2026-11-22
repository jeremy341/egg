import { connection, NextResponse, type NextRequest } from "next/server";
import { createAuthRequest } from "@/server/auth/hackclub";
import { throttleSignIn } from "@/server/auth/throttle";
import { oauthCookieOptions, oauthStateCookieName } from "@/server/auth/oauth-cookie";
import { config, hackClubConfigured } from "@/server/config";

export async function GET(req: NextRequest) {
  // Each login needs a fresh state value, so never prerender this route.
  await connection();
  const throttled = throttleSignIn(req);
  if (throttled) return throttled;
  if (!hackClubConfigured()) {
    return NextResponse.redirect(
      new URL("/login?error=not_configured", config().APP_URL),
      303
    );
  }
  const auth = createAuthRequest();
  const res = NextResponse.redirect(auth.url, 303);
  res.cookies.set(
    oauthStateCookieName(),
    JSON.stringify({ s: auth.state, v: auth.codeVerifier }),
    oauthCookieOptions()
  );
  return res;
}
