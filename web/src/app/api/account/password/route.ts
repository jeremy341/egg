import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { audit } from "@/server/audit";
import { REAUTH_WINDOW_MS, SESSION_COOKIE, isFreshAuth, sessionCookieOptions } from "@/server/auth/session";
import { localPasswordProblem } from "@/server/auth/local-password";
import {
  PASSWORD_AUTH_ERROR,
  createPasswordCredential,
  credentialAccepts,
  deletePasswordCredential,
  hasOtherSignIn,
  passwordCredential,
  prepareSetup,
  replacePasswordCredential,
  revokeAllSessions,
  setupTicketValid,
  signInEnvironment,
} from "@/server/auth/password-signin";
import { authed, handle, HttpError, readJson } from "@/server/http";
import { enforceRateLimit } from "@/server/rate-limit";

const secret = z.string().max(256);

const input = z.discriminatedUnion("action", [
  z.object({ action: z.literal("prepare") }),
  z.object({
    action: z.literal("enable"),
    recoveryKey: z.string().max(64),
    expiresAt: z.number(),
    ticket: z.string().max(128),
    savedRecoveryKey: z.boolean(),
    password: secret,
    confirmPassword: secret,
  }),
  z.object({
    action: z.literal("change"),
    currentPassword: secret,
    newPassword: secret,
    confirmPassword: secret,
  }),
  z.object({
    action: z.literal("disable"),
    currentPassword: secret.optional(),
    recoveryKey: z.string().max(64).optional(),
  }),
]);

const NO_EMAIL =
  "Your account does not share an email address, so a password cannot be used to sign in.";

/**
 * Turning on a second way to sign in (and its recovery key) needs a Hack Club
 * sign-in in the last few minutes, the same rule the permission switches use.
 * A stolen or old session cannot add a password that would outlive its revocation.
 */
async function requireFreshSignIn(req: NextRequest, userId: string) {
  if (!(await isFreshAuth(req.cookies.get(SESSION_COOKIE)?.value, Date.now(), userId))) {
    throw new HttpError(
      403,
      `Confirm with Hack Club first. Turning on password sign-in needs a sign-in in the last ${Math.round(REAUTH_WINDOW_MS / 60000)} minutes.`,
      "reauth_required"
    );
  }
}

/**
 * Turn password sign-in on or off for the signed-in person, and change the
 * password. It is off until the person turns it on. Neither the password nor
 * the recovery key is stored or logged: only salted scrypt hashes.
 */
export const POST = handle(async (req: NextRequest) => {
  const user = await authed();
  // The local-mode owner always has a password; that account is managed on its own card.
  if (user.hackClubId.startsWith("local:")) throw new HttpError(404, "Not found", "not_found");
  enforceRateLimit("signIn", `password-account:${user.id}`);
  const body = await readJson(req, input);
  const current = await passwordCredential(user.id);

  if (body.action === "prepare") {
    if (current) throw new HttpError(409, "Password sign-in is already on.", "conflict");
    if (!user.email) throw new HttpError(400, NO_EMAIL, "validation");
    await requireFreshSignIn(req, user.id);
    return NextResponse.json(prepareSetup(user.id));
  }

  if (body.action === "enable") {
    if (current) throw new HttpError(409, "Password sign-in is already on.", "conflict");
    if (!user.email) throw new HttpError(400, NO_EMAIL, "validation");
    await requireFreshSignIn(req, user.id);
    if (body.savedRecoveryKey !== true) {
      throw new HttpError(400, "Confirm that you have saved the recovery key.", "validation");
    }
    if (!setupTicketValid(user.id, body.recoveryKey, body.expiresAt, body.ticket)) {
      throw new HttpError(400, "The recovery key expired. Start again to get a new one.", "validation");
    }
    const problem = localPasswordProblem(body.password);
    if (problem) throw new HttpError(400, problem, "validation");
    if (body.password !== body.confirmPassword) {
      throw new HttpError(400, "The passwords do not match.", "validation");
    }
    if (!(await createPasswordCredential(user.id, body.password, body.recoveryKey))) {
      throw new HttpError(409, "Password sign-in is already on.", "conflict");
    }
    await audit(user.id, "account.password_enable");
    return NextResponse.json({ enabled: true });
  }

  if (!current) throw new HttpError(409, "Password sign-in is not turned on.", "conflict");

  if (body.action === "disable") {
    if (!hasOtherSignIn(user, signInEnvironment())) {
      throw new HttpError(
        409,
        "This is the only way you can sign in, so it cannot be turned off.",
        "no_other_sign_in"
      );
    }
    const proof = body.currentPassword
      ? { password: body.currentPassword }
      : { recoveryKey: body.recoveryKey };
    if (!(await credentialAccepts(current, proof))) {
      throw new HttpError(403, PASSWORD_AUTH_ERROR, "forbidden");
    }
    if (!(await deletePasswordCredential(user.id, current.passwordHash))) {
      throw new HttpError(409, "The password changed in another request. Try again.", "conflict");
    }
    await audit(user.id, "account.password_disable");
    // This browser stays signed in: only the stored password goes away.
    return NextResponse.json({ enabled: false });
  }

  // change
  if (!(await credentialAccepts(current, { password: body.currentPassword }))) {
    throw new HttpError(403, PASSWORD_AUTH_ERROR, "forbidden");
  }
  const problem = localPasswordProblem(body.newPassword);
  if (problem) throw new HttpError(400, problem, "validation");
  if (body.newPassword !== body.confirmPassword) {
    throw new HttpError(400, "The passwords do not match.", "validation");
  }
  if (!(await replacePasswordCredential(user.id, current.passwordHash, { password: body.newPassword }))) {
    throw new HttpError(409, "The password changed in another request. Try again.", "conflict");
  }
  // Every session ends, this one too: the person signs in again with the new password.
  await revokeAllSessions(user.id);
  await audit(user.id, "account.password_change");
  const res = NextResponse.json({ changed: true, signedOut: true });
  res.cookies.set(SESSION_COOKIE, "", { ...sessionCookieOptions(new Date(0)), maxAge: 0 });
  return res;
});
