import { type NextRequest } from "next/server";
import { handle, HttpError, ok } from "@/server/http";
import { readJsonLimited } from "@/server/body-limit";
import {
  createSecurityReport,
  REPORT_BODY_LIMIT,
  reportAdminId,
} from "@/server/security-reports";
import { clientIp, enforceIngress, rateLimiter } from "@/server/rate-limit";
import { sha256Hex } from "@/server/crypto";

export const GET = handle(async (req) => {
  enforceIngress(req.headers, "all");
  const res = ok({ enabled: !!reportAdminId() });
  res.headers.set("Cache-Control", "no-store");
  return res;
});
export const POST = handle(async (req: NextRequest) => {
  enforceIngress(req.headers, "all");
  // No address is saved with a report. In-memory buckets still limit abuse;
  // without a trusted peer address, anonymous clients share one bucket.
  const key = sha256Hex(clientIp(req.headers) ?? "unknown-client");
  for (const [bucket, limit] of [
    [`security-reports:${key}`, 3],
    ["security-reports:global", 30],
  ] as const) {
    const result = rateLimiter().check(bucket, limit, 60 * 60_000);
    if (!result.allowed)
      throw new HttpError(
        429,
        "Too many report attempts. Please try later or use a private advisory.",
        "rate_limited",
        { "Retry-After": String(result.retryAfterSeconds) },
      );
  }
  const raw = await readJsonLimited(req, { maxBytes: REPORT_BODY_LIMIT });
  // The address is only used as a keyed digest for the database admission check.
  const reference = await createSecurityReport(raw, {
    source: clientIp(req.headers),
  });
  const res = ok({ reference }, 201);
  res.headers.set("Cache-Control", "no-store");
  return res;
});
