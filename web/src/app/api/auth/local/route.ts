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
import { matchesLocalSecret } from "@/server/auth/local-secret";
import { createLocalCredential, localCredential, replaceLocalCredential } from "@/server/auth/local-credential";
import { hashLocalPassword, localPasswordProblem, verifyLocalPassword } from "@/server/auth/local-password";
import { revokeOtherSessions } from "@/server/account";
import { deleteSession } from "@/server/auth/session";

const LOCAL_OWNER_ID = "local:owner";

function signInError(c: ReturnType<typeof config>, code: string) {
  const url = new URL("/login", c.APP_URL);
  url.searchParams.set("error", code);
  return NextResponse.redirect(url, 303);
}

/**
 * Self-hosted sign-in with a separate local secret. Host is client-controlled
 * and is not an authentication boundary, so possession of the setup-generated
 * secret is required even when the server is reachable over the network.
 */
export const POST = handle(async (req: NextRequest) => {
  if (!localModeEnabled()) throw new HttpError(404, "Not found", "not_found");
  const c = config();
  const ip = clientIp(req.headers);
  // Route handlers do not expose the socket address. With no trusted proxy,
  // use a shared bucket so requests still face a bounded scrypt workload.
  enforceRateLimit("signIn", ip ?? "local-mode:unknown-client");
  const form = new URLSearchParams(await readTextLimited(req, 2048));
  const flow = form.get("flow") ?? "login";
  const current = await localCredential();
  let verifiedHash: string | null = null;
  let owner: Awaited<ReturnType<typeof upsertUser>> | null = null;
  if (flow === "setup" || flow === "reset") {
    const recoveryKey = form.get("recoveryKey") ?? "";
    if (!c.LOCAL_MODE_SECRET || !matchesLocalSecret(c.LOCAL_MODE_SECRET, recoveryKey, c.APP_SECRET)) {
      return signInError(c, "local_recovery");
    }
    const newPassword = form.get("newPassword") ?? "";
    const confirmation = form.get("confirmPassword") ?? "";
    const problem = localPasswordProblem(newPassword);
    if (problem) return signInError(c, "local_password_invalid");
    if (newPassword !== confirmation) return signInError(c, "local_password_mismatch");

    const passwordHash = await hashLocalPassword(newPassword);
    if (flow === "setup") {
      if (current) return signInError(c, "local_password_conflict");
      const inserted = await createLocalCredential(passwordHash);
      if (!inserted) {
        const winner = await localCredential();
        if (!winner || !(await verifyLocalPassword(newPassword, winner.passwordHash))) {
          return signInError(c, "local_password_conflict");
        }
        verifiedHash = winner.passwordHash;
      } else {
        verifiedHash = passwordHash;
      }
    } else {
      if (!current) return signInError(c, "local_password_conflict");
      if (!(await replaceLocalCredential(current.passwordHash, passwordHash))) {
        return signInError(c, "local_password_conflict");
      }
      owner = await upsertUser({ id: LOCAL_OWNER_ID, name: "Owner", email: null, slackId: null });
      await revokeOtherSessions(owner.id, undefined);
      verifiedHash = passwordHash;
    }
  } else if (flow === "login") {
    const password = form.get("password") ?? "";
    if (!current || !(await verifyLocalPassword(password, current.passwordHash))) {
      return signInError(c, "local_password");
    }
    verifiedHash = current.passwordHash;
  } else {
    return signInError(c, "local_password_conflict");
  }
  const user = owner ?? await upsertUser({ id: LOCAL_OWNER_ID, name: "Owner", email: null, slackId: null });
  const session = await createSession(user.id, req.headers.get("user-agent"), req.cookies.get(SESSION_COOKIE)?.value);
  if (verifiedHash) {
    const latest = await localCredential();
    if (latest?.passwordHash !== verifiedHash) {
      await deleteSession(session.token);
      return signInError(c, "local_password");
    }
  }
  const res = NextResponse.redirect(new URL("/projects", c.APP_URL), 303);
  res.cookies.set(SESSION_COOKIE, session.token, sessionCookieOptions(session.expiresAt));
  return res;
});
