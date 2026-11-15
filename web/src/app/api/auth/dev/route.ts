import { NextResponse, type NextRequest } from "next/server";
import {
  SESSION_COOKIE,
  createSession,
  sessionCookieOptions,
  upsertUser,
} from "@/server/auth/session";
import { config, localModeEnabled } from "@/server/config";
import { HttpError, handle } from "@/server/http";
import { clientIp, enforceRateLimit } from "@/server/rate-limit";
import { readTextLimited } from "@/server/body-limit";
import { localCredential } from "@/server/auth/local-credential";
import { verifyLocalPassword } from "@/server/auth/local-password";

/**
 * Local development only. Signs in as a made-up user so the app can be used
 * without registering a Hack Club Auth app. Disabled in production no matter
 * what the environment says.
 */
export const POST = handle(async (req: NextRequest) => {
  if (process.env.NODE_ENV === "production" || !config().DEV_LOGIN) {
    throw new HttpError(404, "Not found", "not_found");
  }
  const ip = clientIp(req.headers);
  if (ip) enforceRateLimit("signIn", ip);
  const form = new URLSearchParams(await readTextLimited(req, 1024));
  if (localModeEnabled()) {
    const credential = await localCredential();
    if (!credential || !(await verifyLocalPassword(form.get("password") ?? "", credential.passwordHash))) {
      throw new HttpError(403, "The local password is incorrect.", "forbidden");
    }
  }
  const raw = String(form.get("name") ?? "").trim() || "dev";
  const name = raw.slice(0, 40);
  const user = await upsertUser({
    id: `dev:${name.toLowerCase()}`,
    name,
    email: null,
    slackId: null,
  });
  const session = await createSession(user.id, req.headers.get("user-agent"), req.cookies.get(SESSION_COOKIE)?.value);
  const res = NextResponse.redirect(new URL("/projects", config().APP_URL), 303);
  res.cookies.set(SESSION_COOKIE, session.token, sessionCookieOptions(session.expiresAt));
  return res;
});
