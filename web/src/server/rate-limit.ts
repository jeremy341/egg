import { trustProxyEnabled } from "@/server/config";
import { HttpError } from "@/server/http";

/**
 * A small in-process sliding-window limiter, a safeguard against runaway
 * clients and abuse of the container features. It is per process (like the
 * terminal sessions) and forgets everything on restart.
 *
 * Memory is bounded twice: a key keeps at most `limit` timestamps, and the
 * table holds at most `maxKeys` keys. When it is full, expired keys go first,
 * then the oldest-inserted key (which at worst gives that one key a fresh window).
 */

export type RateResult = { allowed: true } | { allowed: false; retryAfterSeconds: number };

export class SlidingWindowLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly maxKeys = 10_000,
    private readonly now: () => number = () => Date.now()
  ) {}

  /** Record one request for `key` if it fits in `limit` per `windowMs`. */
  check(key: string, limit: number, windowMs: number): RateResult {
    const now = this.now();
    const cutoff = now - windowMs;
    const stamps = this.hits.get(key)?.filter((t) => t > cutoff) ?? [];

    if (stamps.length >= limit) {
      // Refresh so the oldest-inserted eviction order follows recent use.
      this.hits.delete(key);
      this.hits.set(key, stamps);
      const wait = stamps[0] + windowMs - now;
      return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil(wait / 1000)) };
    }

    stamps.push(now);
    this.hits.delete(key);
    if (this.hits.size >= this.maxKeys) this.makeRoom(cutoff);
    this.hits.set(key, stamps);
    return { allowed: true };
  }

  /** True when `key` has used up `limit` in the window. Records nothing. */
  isFull(key: string, limit: number, windowMs: number): boolean {
    const cutoff = this.now() - windowMs;
    return (this.hits.get(key)?.filter((t) => t > cutoff).length ?? 0) >= limit;
  }

  get size(): number {
    return this.hits.size;
  }

  clear(): void {
    this.hits.clear();
  }

  private makeRoom(cutoff: number) {
    for (const [k, stamps] of this.hits) {
      if (stamps[stamps.length - 1] <= cutoff) this.hits.delete(k);
    }
    while (this.hits.size >= this.maxKeys) {
      const oldest = this.hits.keys().next();
      if (oldest.done) break;
      this.hits.delete(oldest.value);
    }
  }
}

/**
 * The limits for the container features (per user, per minute) and for the
 * unauthenticated front doors (per client address, per minute): `signIn` for the
 * sign-in routes and `badToken` for access tokens that do not check out.
 */
export const RATE_LIMITS = {
  terminalInput: { limit: 300, windowMs: 60_000, what: "terminal input" },
  fileWrite: { limit: 60, windowMs: 60_000, what: "file changes" },
  orphanRemoval: { limit: 10, windowMs: 60_000, what: "leftover removals" },
  signIn: { limit: 20, windowMs: 60_000, what: "sign-in attempts" },
  badToken: { limit: 60, windowMs: 60_000, what: "unrecognised access tokens" },
  // GitHub builds: per project, per hour. Keyed by project id (the project the build credential belongs to).
  buildUpload: { limit: 20, windowMs: 60 * 60_000, what: "build uploads" },
  buildEnv: { limit: 30, windowMs: 60 * 60_000, what: "build variable reads" },
} as const;

export type RateBucket = keyof typeof RATE_LIMITS;

const KEY = Symbol.for("egg.rate-limiter");

/** One limiter per process, shared by separately bundled route modules. */
export function rateLimiter(): SlidingWindowLimiter {
  const g = globalThis as unknown as Record<symbol, SlidingWindowLimiter | undefined>;
  return (g[KEY] ??= new SlidingWindowLimiter());
}

/**
 * Pick the caller's address. With the proxy trusted (TRUST_PROXY), it is the
 * right-most X-Forwarded-For entry, which is the one our own proxy appended (the
 * left-most is whatever the client wrote), then X-Real-IP. With it off, the
 * headers are ignored, because anyone can send them, and the socket address is
 * used if the caller has one. Route handlers do not expose the socket, so this
 * is usually null and the address-based limits do not apply.
 */
export function pickClientIp(
  headers: Headers,
  trustProxy: boolean,
  socketAddress?: string | null
): string | null {
  if (!trustProxy) return socketAddress?.trim() || null;
  const last = headers.get("x-forwarded-for")?.split(",").pop()?.trim();
  return last || headers.get("x-real-ip")?.trim() || null;
}

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
