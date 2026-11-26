import { NextResponse, type NextRequest } from "next/server";
import {
  SESSION_COOKIE,
  createSession,
  sessionCookieOptions,
  upsertUser,
} from "@/server/auth/session";
import { config, isLoopbackHost, localModeEnabled } from "@/server/config";
import { HttpError, handle } from "@/server/http";
import { clientIp, enforceRateLimit } from "@/server/rate-limit";

const LOCAL_OWNER_ID = "local:owner";

/** The host the browser asked for, without the port. */
function requestHostname(req: NextRequest): string {
  const host = req.headers.get("host") ?? req.nextUrl.host;
  try {
    return new URL(`http://${host}`).hostname;
  } catch {
    return "";
  }
}

/**
 * Self-hosted sign-in with no external account. Works only while LOCAL_MODE is
 * on, in any build. It signs in the one local owner, so it also refuses a
 * request that reached the server on a non-local address unless
 * LOCAL_MODE_ALLOW_REMOTE is set (the server may listen on every interface even
 * when APP_URL says localhost).
 */
export const POST = handle(async (req: NextRequest) => {
  if (!localModeEnabled()) throw new HttpError(404, "Not found", "not_found");
  if (!config().LOCAL_MODE_ALLOW_REMOTE && !isLoopbackHost(requestHostname(req))) {
    throw new HttpError(403, "Local sign-in only works from this computer", "forbidden");
  }
  const ip = clientIp(req.headers);
  if (ip) enforceRateLimit("signIn", ip);
  const user = await upsertUser({ id: LOCAL_OWNER_ID, name: "Owner", email: null, slackId: null });
  const session = await createSession(user.id, req.headers.get("user-agent"), req.cookies.get(SESSION_COOKIE)?.value);
  const res = NextResponse.redirect(new URL("/projects", config().APP_URL), 303);
  res.cookies.set(SESSION_COOKIE, session.token, sessionCookieOptions(session.expiresAt));
  return res;
});
