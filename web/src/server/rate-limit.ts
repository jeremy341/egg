import { trustProxyEnabled } from "@/server/config";
import { HttpError } from "@/server/http";
import {
  RATE_LIMITS,
  admitRequest,
  pickClientIp,
  rateLimiter,
  refusalText,
  type IngressBucket,
  type RateBucket,
} from "@/server/rate-limit-core";

/**
 * The limiter itself lives in rate-limit-core.ts (no imports, so the proxy can use it). It is re-exported here so
 * route code keeps importing everything from one place.
 *
 * A small in-process sliding-window limiter, a safeguard against runaway
 * clients and abuse of the container features. It is per process (like the
 * terminal sessions) and forgets everything on restart.
 */
export {
  INGRESS_BAN,
  RATE_LIMITS,
  SlidingWindowLimiter,
  admitRequest,
  pickClientIp,
  rateLimiter,
  type Admission,
  type IngressBucket,
  type RateBucket,
  type RateResult,
} from "@/server/rate-limit-core";

/** The caller's address under the TRUST_PROXY setting, or null when there is none to trust. */
export function clientIp(headers: Headers, socketAddress?: string | null): string | null {
  return pickClientIp(headers, trustProxyEnabled(), socketAddress);
}

function tooMany(what: string, retryAfterSeconds: number) {
  const seconds = retryAfterSeconds;
  return new HttpError(
    429,
    `Too many requests for ${what}. Wait ${seconds} second${seconds === 1 ? "" : "s"} and try again.`,
    "rate_limited",
    { "Retry-After": String(seconds) }
  );
}

/** Throw 429 if this key is already at the cap, without counting anything. */
export function assertRateRoom(bucket: RateBucket, key: string): void {
  const { limit, windowMs, what } = RATE_LIMITS[bucket];
  const limiter = rateLimiter();
  if (!limiter.isFull(`${bucket}:${key}`, limit, windowMs)) return;
  // A full key refuses without recording, so ask the limiter for the wait time.
  const probe = limiter.check(`${bucket}:${key}`, limit, windowMs);
  if (!probe.allowed) throw tooMany(what, probe.retryAfterSeconds);
}

/** Count one request for this user in this bucket, or throw 429 with a Retry-After header. */
export function enforceRateLimit(bucket: RateBucket, userId: string): void {
  const { limit, windowMs, what } = RATE_LIMITS[bucket];
  const result = rateLimiter().check(`${bucket}:${userId}`, limit, windowMs);
  if (result.allowed) return;
  throw tooMany(what, result.retryAfterSeconds);
}

/**
 * The per-address gate for a route the proxy does not see (the matcher in src/proxy.ts skips it). Call it after
 * the route's own cheap refusals. Throws 429 with Retry-After when refused.
 */
export function enforceIngress(headers: Headers, bucket: IngressBucket): void {
  const adm = admitRequest(headers, { trustProxy: trustProxyEnabled(), bucket });
  if (!adm.refused) return;
  throw new HttpError(429, refusalText(adm.banned, adm.retryAfterSeconds), "rate_limited", {
    "Retry-After": String(adm.retryAfterSeconds),
  });
}
