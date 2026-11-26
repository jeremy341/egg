import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { audit } from "@/server/audit";
import { localPasswordProblem } from "@/server/auth/local-password";
import {
  PASSWORD_AUTH_ERROR,
  authenticatePasswordAccount,
  generateRecoveryKey,
  normalizeEmail,
  replacePasswordCredential,
  revokeAllSessions,
} from "@/server/auth/password-signin";
import { sha256Hex } from "@/server/crypto";
import { HttpError, handle, readJson } from "@/server/http";
import { clientIp, enforceRateLimit } from "@/server/rate-limit";

const input = z.object({
  email: z.string().max(254),
  recoveryKey: z.string().max(64),
  newPassword: z.string().max(256),
  confirmPassword: z.string().max(256),
});

/**
 * Reset a lost password with the recovery key. A good reset sets the new
 * password, issues a new recovery key (shown once, in this response) and ends
 * every session; nobody is signed in by it. Every failure about the account
 * or the key is the same 403, whether or not the account exists.
 */
export const POST = handle(async (req: NextRequest) => {
  const body = await readJson(req, input);
  const email = normalizeEmail(body.email);
  enforceRateLimit("signIn", clientIp(req.headers) ?? "password:unknown-client");
  enforceRateLimit("signIn", `password-email:${sha256Hex(email)}`);

  const problem = localPasswordProblem(body.newPassword);
  if (problem) throw new HttpError(400, problem, "validation");
  if (body.newPassword !== body.confirmPassword) {
    throw new HttpError(400, "The passwords do not match.", "validation");
  }

  const account = await authenticatePasswordAccount(email, { recoveryKey: body.recoveryKey });
  if (!account) throw new HttpError(403, PASSWORD_AUTH_ERROR, "forbidden");

  const recoveryKey = generateRecoveryKey();
  const replaced = await replacePasswordCredential(account.userId, account.credential.passwordHash, {
    password: body.newPassword,
    newRecoveryKey: recoveryKey,
  });
  if (!replaced) throw new HttpError(403, PASSWORD_AUTH_ERROR, "forbidden");
  await revokeAllSessions(account.userId);
  await audit(account.userId, "account.password_reset");
  return NextResponse.json({ reset: true, recoveryKey });
});
