import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { SESSION_COOKIE, createSession, deleteSession, sessionCookieOptions } from "@/server/auth/session";
import { localCredential, replaceLocalCredential } from "@/server/auth/local-credential";
import { hashLocalPassword, localPasswordProblem, verifyLocalPassword } from "@/server/auth/local-password";
import { localModeEnabled } from "@/server/config";
import { revokeOtherSessions } from "@/server/account";
import { authed, handle, HttpError, readJson } from "@/server/http";
import { enforceRateLimit } from "@/server/rate-limit";

const input = z.object({
  currentPassword: z.string().max(256),
  newPassword: z.string().max(256),
  confirmPassword: z.string().max(256),
});

/** Change the local owner's password, revoke other sessions and close terminals. */
export const POST = handle(async (req: NextRequest) => {
  const user = await authed();
  if (!localModeEnabled() || user.hackClubId !== "local:owner") {
    throw new HttpError(404, "Not found", "not_found");
  }
  enforceRateLimit("signIn", `local-password-change:${user.id}`);
  const body = await readJson(req, input);
  const current = await localCredential();
  if (!current || !(await verifyLocalPassword(body.currentPassword, current.passwordHash))) {
    throw new HttpError(403, "The current password is incorrect.", "forbidden");
  }
  const problem = localPasswordProblem(body.newPassword);
  if (problem) throw new HttpError(400, problem, "validation");
  if (body.newPassword !== body.confirmPassword) {
    throw new HttpError(400, "The passwords do not match.", "validation");
  }

  const newHash = await hashLocalPassword(body.newPassword);
  if (!(await replaceLocalCredential(current.passwordHash, newHash))) {
    throw new HttpError(409, "The password changed in another request. Try again.", "conflict");
  }
  await revokeOtherSessions(user.id, undefined);
  const session = await createSession(user.id, req.headers.get("user-agent"));
  const latest = await localCredential();
  if (latest?.passwordHash !== newHash) {
    await deleteSession(session.token);
    throw new HttpError(409, "The password changed again. Sign in with the new password.", "conflict");
  }
  const res = NextResponse.json({ changed: true });
  res.cookies.set(SESSION_COOKIE, session.token, sessionCookieOptions(session.expiresAt));
  return res;
});
