import { type NextRequest } from "next/server";
import { authed, handle, HttpError, ok } from "@/server/http";
import { readJsonLimited } from "@/server/body-limit";
import {
  createSecurityReport,
  REPORT_BODY_LIMIT,
  reportAdminId,
} from "@/server/security-reports";
import { clientIp, enforceIngress, rateLimiter } from "@/server/rate-limit";
import { keyedDigestHex, randomToken } from "@/server/crypto";
import { getCurrentUser } from "@/server/auth/current";
import { assertAccountCanWrite } from "@/server/account-standing";

const HOUR_MS = 60 * 60_000;

/** Each signed-in account gets three attempts an hour; one account cannot lock the inbox. */
export const PER_REPORTER_LIMIT = 3;
/** The shared ceiling stops a flood of new accounts from exhausting the inbox. */
export const GLOBAL_REPORTER_LIMIT = 600;
export const GLOBAL_REPORTER_KEY = "security-reports:global";

/**
 * Reports need a signed-in Hack Club account, which stops anonymous spam. The
 * account is used only for this in-memory rate limit, keyed by a digest, and is
 * never saved with the report. The "submit without my identity" option removes
 * the name and reply address the form would otherwise keep.
 */
function reporterBucket(userId: string): string {
  return `security-reports:reporter:${keyedDigestHex("report-reporter-user", userId)}`;
}

export const GET = handle(async (req) => {
  enforceIngress(req.headers, "all");
  const res = ok({ enabled: !!reportAdminId() });
  res.headers.set("Cache-Control", "no-store");
  return res;
});

export const POST = handle(async (req: NextRequest) => {
  enforceIngress(req.headers, "all");
  const user = await authed();
  for (const [bucket, limit] of [
    [reporterBucket(user.id), PER_REPORTER_LIMIT],
    [GLOBAL_REPORTER_KEY, GLOBAL_REPORTER_LIMIT],
  ] as const) {
    const result = rateLimiter().check(bucket, limit, HOUR_MS);
    if (!result.allowed)
      throw new HttpError(
        429,
        "Too many report attempts. Please try later or use a private advisory.",
        "rate_limited",
        { "Retry-After": String(result.retryAfterSeconds) },
      );
  }
  // A signed-in account past its grace period cannot report. Anonymous reports never look up a session:
  // the cookie check decides whether there is one to look at.
  if (req.headers.get("cookie")) {
    const signedIn = await getCurrentUser();
    if (signedIn) await assertAccountCanWrite(signedIn.id);
  }
  const raw = await readJsonLimited(req, { maxBytes: REPORT_BODY_LIMIT });
  // No source is stored: the account is never linked to a report, not even as a digest.
  const reference = await createSecurityReport(raw, { source: null });
  const res = ok({ reference }, 201);
  res.headers.set("Cache-Control", "no-store");
  return res;
});
