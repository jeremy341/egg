import { connection, NextResponse } from "next/server";
import { githubConfigured, config } from "@/server/config";
import { githubAuthorizeUrl } from "@/server/github/app";
import { getCurrentUser } from "@/server/auth/current";
import { createOAuthStateBinding } from "@/server/auth/oauth-state";
import { githubStateCookieName, oauthCookieOptions } from "@/server/auth/oauth-cookie";
import { maintenanceBlocksUser } from "@/server/maintenance";

export async function GET() {
  // Each link needs a fresh state value, so never prerender this route.
  await connection();
  const user = await getCurrentUser();
  if (await maintenanceBlocksUser(user?.id)) {
    return NextResponse.json({ error: { code: "maintenance", message: "GitHub linking is paused during maintenance." } }, { status: 503, headers: { "Retry-After": "60" } });
  }
  if (!user) return NextResponse.redirect(new URL("/login", config().APP_URL), 303);
  if (!githubConfigured()) {
    return NextResponse.redirect(new URL("/new?github=not_configured", config().APP_URL), 303);
  }
  const { url, state } = githubAuthorizeUrl();
  const res = NextResponse.redirect(url, 303);
  res.cookies.set(githubStateCookieName(), createOAuthStateBinding(user.id, state), oauthCookieOptions());
  return res;
}
