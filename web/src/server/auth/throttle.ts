import { NextResponse } from "next/server";
import { config } from "@/server/config";
import { HttpError } from "@/server/http";
import { clientIp, enforceRateLimit } from "@/server/rate-limit";

/**
 * Count a sign-in request against its address. Returns a redirect back to the
 * sign-in page when the address is over the limit, or null to carry on. With no
 * proxy header there is no address to count, so nothing is limited.
 */
export function throttleSignIn(req: Request): NextResponse | null {
  const ip = clientIp(req.headers);
  if (!ip) return null;
  try {
    enforceRateLimit("signIn", ip);
    return null;
  } catch (err) {
    if (!(err instanceof HttpError)) throw err;
    const url = new URL("/login", config().APP_URL);
    url.searchParams.set("error", "rate_limited");
    return NextResponse.redirect(url, { status: 303, headers: err.headers });
  }
}
