import { connection, NextResponse } from "next/server";
import { githubConfigured, config } from "@/server/config";
import { githubAuthorizeUrl } from "@/server/github/app";
import { getCurrentUser } from "@/server/auth/current";
import { maintenanceBlocksUser } from "@/server/maintenance";

export async function GET() {
  // Each link needs a fresh state value, so never prerender this route.
  await connection();
  if (await maintenanceBlocksUser((await getCurrentUser())?.id)) {
    return NextResponse.json({ error: { code: "maintenance", message: "GitHub linking is paused during maintenance." } }, { status: 503, headers: { "Retry-After": "60" } });
  }
  if (!githubConfigured()) {
    return NextResponse.redirect(new URL("/new?github=not_configured", config().APP_URL), 303);
  }
  const { url, state } = githubAuthorizeUrl();
  const res = NextResponse.redirect(url, 303);
  res.cookies.set("egg_gh_state", state, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/api/github",
    maxAge: 600,
  });
  return res;
}
