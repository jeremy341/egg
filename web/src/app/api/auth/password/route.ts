import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, createSession, deleteSession, sessionCookieOptions } from "@/server/auth/session";
import { authenticatePasswordAccount, normalizeEmail, passwordCredential } from "@/server/auth/password-signin";
import { config } from "@/server/config";
import { sha256Hex } from "@/server/crypto";
import { HttpError, handle } from "@/server/http";
import { readTextLimited } from "@/server/body-limit";
import { clientIp, enforceRateLimit } from "@/server/rate-limit";

function back(code: string, headers?: Record<string, string>) {
  const url = new URL("/login", config().APP_URL);
  url.searchParams.set("method", "password");
  url.searchParams.set("error", code);
  return NextResponse.redirect(url, { status: 303, headers });
}

/**
 * Sign in with the optional password. An unknown email, an account with no
 * password turned on and a wrong password all end the same way, after the same
 * work, so the page never says whether an account exists.
 */
export const POST = handle(async (req: NextRequest) => {
  const form = new URLSearchParams(await readTextLimited(req, 2048));
  const email = normalizeEmail(form.get("email"));
  const password = form.get("password") ?? "";
  try {
    // Route handlers do not expose the socket address, so without a trusted proxy
    // the first bucket is shared. The second slows guessing against one account.
    enforceRateLimit("signIn", clientIp(req.headers) ?? "password:unknown-client");
    enforceRateLimit("signIn", `password-email:${sha256Hex(email)}`);
  } catch (err) {
    if (!(err instanceof HttpError)) throw err;
    return back("rate_limited", err.headers);
  }
  const account = await authenticatePasswordAccount(email, { password });
  if (!account) return back("password_invalid");

  const session = await createSession(account.userId, req.headers.get("user-agent"), req.cookies.get(SESSION_COOKIE)?.value);
  // A change, reset or turn-off that landed while we were checking wins.
  const latest = await passwordCredential(account.userId);
  if (latest?.passwordHash !== account.credential.passwordHash) {
    await deleteSession(session.token);
    return back("password_invalid");
  }
  const res = NextResponse.redirect(new URL("/projects", config().APP_URL), 303);
  res.cookies.set(SESSION_COOKIE, session.token, sessionCookieOptions(session.expiresAt));
  return res;
});
