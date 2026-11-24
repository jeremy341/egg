import { type NextRequest } from "next/server";
import { handle, HttpError, ok } from "@/server/http";
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

/** Each reporter gets three attempts an hour; one source cannot lock the inbox. */
export const PER_REPORTER_LIMIT = 3;
/**
 * The shared ceiling is deliberately high: it stops a flood of rotated cookies
 * or X-Forwarded-For values from exhausting the inbox, while one source's three
 * attempts are a tiny fraction of it. The durable caps live in the database
 * admission transaction (createSecurityReport), which is still enforced below.
 */
export const GLOBAL_REPORTER_LIMIT = 600;
export const GLOBAL_REPORTER_KEY = "security-reports:global";

/** A dedicated, short-lived anonymous cookie. A session cookie is not required to report. */
const REPORTER_COOKIE = "egg_report_key";
const REPORTER_TOKEN = /^[A-Za-z0-9_-]{16,128}$/;
const COOKIE_MAX_AGE_SECONDS = 24 * 60 * 60;

type Reporter = { bucket: string; source: string | null; newCookie?: string };

/**
 * A stable key for the reporter, without storing an address.
 *
 * - TRUST_PROXY on: the right-most X-Forwarded-For entry is set by our own
 *   proxy, so it is stable for a caller and cannot be rotated at will.
 * - No trusted address: use a dedicated anonymous cookie. A first-time caller
 *   gets a fresh token and a Set-Cookie on the response; later calls present it
 *   and keep the same bucket. Cookies are claims, so the global ceiling bounds
 *   how many can be minted into new buckets.
 */
function reporterFor(headers: Headers): Reporter {
  const address = clientIp(headers);
  if (address) {
    return {
      bucket: `security-reports:reporter:${keyedDigestHex("report-reporter-addr", address)}`,
      source: address,
    };
  }
  const cookie = headers
    .get("cookie")
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${REPORTER_COOKIE}=`));
  const token = cookie?.slice(REPORTER_COOKIE.length + 1);
  if (token && REPORTER_TOKEN.test(token)) {
    return {
      bucket: `security-reports:reporter:${keyedDigestHex("report-reporter-cookie", token)}`,
      source: token,
    };
  }
  const fresh = randomToken(24);
  return {
    bucket: `security-reports:reporter:${keyedDigestHex("report-reporter-cookie", fresh)}`,
    source: fresh,
    newCookie: `${REPORTER_COOKIE}=${fresh}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${COOKIE_MAX_AGE_SECONDS}`,
  };
}

export const GET = handle(async (req) => {
  enforceIngress(req.headers, "all");
  const res = ok({ enabled: !!reportAdminId() });
  res.headers.set("Cache-Control", "no-store");
  return res;
});

export const POST = handle(async (req: NextRequest) => {
  enforceIngress(req.headers, "all");
  const reporter = reporterFor(req.headers);
  const cookieHeaders: Record<string, string> = reporter.newCookie ? { "Set-Cookie": reporter.newCookie } : {};
  for (const [bucket, limit] of [
    [reporter.bucket, PER_REPORTER_LIMIT],
    [GLOBAL_REPORTER_KEY, GLOBAL_REPORTER_LIMIT],
  ] as const) {
    const result = rateLimiter().check(bucket, limit, HOUR_MS);
    if (!result.allowed)
      throw new HttpError(
        429,
        "Too many report attempts. Please try later or use a private advisory.",
        "rate_limited",
        { "Retry-After": String(result.retryAfterSeconds), ...cookieHeaders },
      );
  }
  // A signed-in account past its grace period cannot report. Anonymous reports never look up a session:
  // the cookie check decides whether there is one to look at.
  if (req.headers.get("cookie")) {
    const signedIn = await getCurrentUser();
    if (signedIn) await assertAccountCanWrite(signedIn.id);
  }
  const raw = await readJsonLimited(req, { maxBytes: REPORT_BODY_LIMIT });
  // The reporter identity is only used as a keyed digest for the database
  // admission check. No raw address or cookie is saved with the report.
  const reference = await createSecurityReport(raw, {
    source: reporter.source,
  });
  const res = ok({ reference }, 201);
  for (const [name, value] of Object.entries(cookieHeaders)) res.headers.set(name, value);
  res.headers.set("Cache-Control", "no-store");
  return res;
});
