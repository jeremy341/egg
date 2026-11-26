import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, createSession, deleteSession, sessionCookieOptions } from "@/server/auth/session";
import { authenticatePasswordAccount, normalizeEmail, passwordCredential } from "@/server/auth/password-signin";
import { config } from "@/server/config";
import { sha256Hex } from "@/server/crypto";
import { HttpError, handle } from "@/server/http";
import { readTextLimited } from "@/server/body-limit";
import { clientIp, enforceRateLimit, rateLimiter } from "@/server/rate-limit";

function back(code: string, headers?: Record<string, string>) {
  const url = new URL("/login", config().APP_URL);
  url.searchParams.set("method", "password");
  url.searchParams.set("error", code);
  return NextResponse.redirect(url, { status: 303, headers });
}

/** The shared, slow ceiling on password attempts for one account, whichever address they come from. */
const PASSWORD_ATTEMPTS = { limit: 60, windowMs: 60 * 60_000 };

function enforcePasswordCeiling(digest: string) {
  const result = rateLimiter().check(`password-email-slow:${digest}`, PASSWORD_ATTEMPTS.limit, PASSWORD_ATTEMPTS.windowMs);
  if (result.allowed) return;
  const seconds = result.retryAfterSeconds;
  throw new HttpError(
    429,
    `Too many requests for password sign-in for this account. Wait ${seconds} second${seconds === 1 ? "" : "s"} and try again.`,
    "rate_limited",
    { "Retry-After": String(seconds) }
  );
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
  const ip = clientIp(req.headers);
  const address = ip ?? "password:unknown-client";
  const digest = sha256Hex(email);
  try {
    // Without a trusted proxy every request would share one address key, so key
    // the first bucket by email instead. The second slows guessing against one
    // account, but is keyed by address and email together so guessing cannot
    // lock the account from another address; the slow ceiling is the shared cap.
    enforceRateLimit("signIn", ip ?? digest);
    enforceRateLimit("signIn", `password-email:${address}:${digest}`);
    enforcePasswordCeiling(digest);
  } catch (err) {
    if (!(err instanceof HttpError)) throw err;
    return back("rate_limited", err.headers);
  }
  const account = await authenticatePasswordAccount(email, { password });
  if (!account) return back("password_invalid");

  // The session this browser already has ends only once the sign-in is certain,
  // so a raced sign-in that fails never loses it.
  const oldToken = req.cookies.get(SESSION_COOKIE)?.value;
  const session = await createSession(account.userId, req.headers.get("user-agent"));
  // A change, reset or turn-off that landed while we were checking wins.
  const latest = await passwordCredential(account.userId);
  if (latest?.passwordHash !== account.credential.passwordHash) {
    await deleteSession(session.token);
    return back("password_invalid");
  }
  await deleteSession(oldToken);
  const res = NextResponse.redirect(new URL("/projects", config().APP_URL), 303);
  res.cookies.set(SESSION_COOKIE, session.token, sessionCookieOptions(session.expiresAt));
  return res;
});
