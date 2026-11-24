/**
 * The in-process limiter, kept free of imports so the proxy (src/proxy.ts) can use it without loading the
 * database or the auth code. src/server/rate-limit.ts re-exports everything here and adds the route helpers.
 *
 * A sliding-window limiter, a safeguard against runaway clients and abuse. It is per process (like the terminal
 * sessions) and forgets everything on restart.
 *
 * Memory is bounded: a key keeps at most `limit` timestamps, and the table holds at most `maxKeys` keys. Expired
 * keys are swept at most once a minute (sweepIfDue, called on every request the proxy admits), and when the table
 * is still full the oldest-inserted key goes (at worst that key gets a fresh window).
 */

export type RateResult = { allowed: true } | { allowed: false; retryAfterSeconds: number };

type Entry = {
  /** Timestamps of counted requests, oldest first. */
  stamps: number[];
  /** The window the stamps were counted in, so a sweep can tell when the entry has expired. */
  windowMs: number;
  /** Epoch ms until which the key is banned. 0 when not banned. */
  bannedUntil: number;
};

const SWEEP_EVERY_MS = 60_000;

export class SlidingWindowLimiter {
  private readonly entries = new Map<string, Entry>();
  private lastSweep: number;

  constructor(
    private readonly maxKeys = 10_000,
    private readonly now: () => number = () => Date.now()
  ) {
    this.lastSweep = now();
  }

  /** Record one request for `key` if it fits in `limit` per `windowMs`. */
  check(key: string, limit: number, windowMs: number): RateResult {
    const now = this.now();
    const cutoff = now - windowMs;
    const old = this.entries.get(key);
    const stamps = old?.stamps.filter((t) => t > cutoff) ?? [];
    const bannedUntil = old?.bannedUntil ?? 0;

    if (stamps.length >= limit) {
      // Refresh so the oldest-inserted eviction order follows recent use.
      this.put(key, { stamps, windowMs, bannedUntil });
      const wait = stamps[0] + windowMs - now;
      return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil(wait / 1000)) };
    }

    stamps.push(now);
    this.put(key, { stamps, windowMs, bannedUntil });
    return { allowed: true };
  }

  /**
   * Count one event for `key` inside `windowMs` and return how many are counted now. Unlike check(), this always
   * records. At most `keep` timestamps are kept, so the count tops out at `keep`.
   */
  countEvent(key: string, windowMs: number, keep: number): number {
    const now = this.now();
    const cutoff = now - windowMs;
    const old = this.entries.get(key);
    const stamps = old?.stamps.filter((t) => t > cutoff) ?? [];
    stamps.push(now);
    if (stamps.length > keep) stamps.splice(0, stamps.length - keep);
    this.put(key, { stamps, windowMs, bannedUntil: old?.bannedUntil ?? 0 });
    return stamps.length;
  }

  /** Ban `key` for `durationMs` from now. Requests for it are refused until then. */
  ban(key: string, durationMs: number): void {
    const now = this.now();
    const old = this.entries.get(key);
    this.put(key, { stamps: old?.stamps ?? [], windowMs: old?.windowMs ?? 0, bannedUntil: now + durationMs });
  }

  /** Milliseconds left on a ban, or 0 when `key` is not banned. */
  banRemainingMs(key: string): number {
    const until = this.entries.get(key)?.bannedUntil ?? 0;
    return Math.max(0, until - this.now());
  }

  /** How many keys are banned right now. */
  activeBans(): number {
    const now = this.now();
    let n = 0;
    for (const e of this.entries.values()) if (e.bannedUntil > now) n++;
    return n;
  }

  /** True when `key` has used up `limit` in the window. Records nothing. */
  isFull(key: string, limit: number, windowMs: number): boolean {
    const cutoff = this.now() - windowMs;
    return (this.entries.get(key)?.stamps.filter((t) => t > cutoff).length ?? 0) >= limit;
  }

  /** Drop every key whose window and ban have ended. */
  sweep(): void {
    const now = this.now();
    for (const [k, e] of this.entries) {
      if (!this.live(e, now)) this.entries.delete(k);
    }
    this.lastSweep = now;
  }

  /** sweep(), but at most once a minute, so it can be called on every request. */
  sweepIfDue(): void {
    if (this.now() - this.lastSweep >= SWEEP_EVERY_MS) this.sweep();
  }

  get size(): number {
    return this.entries.size;
  }

  clear(): void {
    this.entries.clear();
  }

  private live(e: Entry, now: number): boolean {
    if (e.bannedUntil > now) return true;
    const last = e.stamps[e.stamps.length - 1];
    return last !== undefined && last > now - e.windowMs;
  }

  /** Store an entry at the newest position, making room first when the table is full. */
  private put(key: string, entry: Entry): void {
    // Delete first so an existing key does not count against the cap, then refresh its order.
    this.entries.delete(key);
    if (this.entries.size >= this.maxKeys) this.makeRoom();
    this.entries.set(key, entry);
  }

  private makeRoom(): void {
    this.sweep();
    while (this.entries.size >= this.maxKeys) {
      const oldest = this.entries.keys().next();
      if (oldest.done) break;
      this.entries.delete(oldest.value);
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
  // Any request that opens an SSH session to the user's container (inventory, usage, server tests, status probes,
  // logs, restarts, jobs, notification tests). Per signed-in user, per minute.
  sshSession: { limit: 10, windowMs: 60_000, what: "container sessions" },
  fileWrite: { limit: 60, windowMs: 60_000, what: "file changes" },
  orphanRemoval: { limit: 10, windowMs: 60_000, what: "leftover removals" },
  // Dashboard routes that open an SSH connection to the user's container, per signed-in user, per minute: a
  // small shared bucket for the slow container reads (file reads, journal logs, usage, opening a terminal),
  // and a tighter one for restarting the production service.
  sshCall: { limit: 10, windowMs: 60_000, what: "slow calls to your container" },
  // A bulk deployment action opens one fresh SSH session per id (up to MAX_BULK=50). Charge this bucket once per
  // id so a single request, or a burst of them, cannot open dozens of sessions inside a minute.
  bulkSsh: { limit: 20, windowMs: 60_000, what: "bulk deployment operations" },
  serviceRestart: { limit: 6, windowMs: 60_000, what: "service restarts" },
  // Resolving, reopening, ignoring or assigning error groups: database writes only, per signed-in user, per minute.
  errorTriage: { limit: 60, windowMs: 60_000, what: "error group changes" },
  signIn: { limit: 20, windowMs: 60_000, what: "sign-in attempts" },
  badToken: { limit: 60, windowMs: 60_000, what: "unrecognised access tokens" },
  // GitHub builds: per project, per hour. Keyed by project id (the project the build credential belongs to).
  buildUpload: { limit: 20, windowMs: 60 * 60_000, what: "build uploads" },
  buildEnv: { limit: 30, windowMs: 60 * 60_000, what: "build variable reads" },
  // "Test connection" in settings: it makes GitHub requests, so it is per signed-in user, per minute.
  githubCheck: { limit: 10, windowMs: 60_000, what: "GitHub connection tests" },
  // Repository detection in the new-project flow is triggered on every keystroke and reads the tree and files of a
  // repo through the shared unauthenticated GitHub API (60 requests/hour/IP), so cap it tightly per signed-in user.
  repoDetect: { limit: 10, windowMs: 60_000, what: "repository detection requests" },
  // Sending a test notification posts to an external webhook, so keep it rare: per signed-in user, per minute.
  notifyTest: { limit: 5, windowMs: 60_000, what: "notification tests" },
  // Opening the pull request that adds the build workflow makes GitHub write calls, so it is per signed-in user.
  workflowPublish: { limit: 6, windowMs: 60_000, what: "workflow pull requests" },
  // Granting or removing an administrator, per signed-in administrator. Rare by design, so a low ceiling.
  adminGrant: { limit: 10, windowMs: 60_000, what: "administrator changes" },
  // The public homepage feed, per client address. It is cached for a minute, so this only stops a flood.
  publicFeed: { limit: 60, windowMs: 60_000, what: "the public deployments feed" },
  // Every request the proxy sees (pages and API), per client address.
  ingress: { limit: 600, windowMs: 60_000, what: "requests" },
  // The public JSON data routes (/api/stats, /api/public/*, /api/status/*), per client address, on top of `ingress`.
  ingressJson: { limit: 60, windowMs: 60_000, what: "public data requests" },
  // The GitHub webhook, per client address. Checked only after the webhook's own cheap refusals. GitHub sends bursts
  // from a few addresses, so this is set well above a normal delivery rate.
  ingressWebhook: { limit: 600, windowMs: 60_000, what: "webhook deliveries" },
  // Requests whose address is unknown (TRUST_PROXY off), which all share one key. Only a high safety ceiling, because
  // one shared key cannot be banned per client without locking every user out.
  ingressGlobal: { limit: 6_000, windowMs: 60_000, what: "requests" },
  // Every session-cookie claim combined (TRUST_PROXY off): a cookie is a claim, not proof, and
  // anyone can mint unlimited fresh token-shaped cookies, so per-claim gates alone would let a
  // mint multiply the instance-wide allowance. One aggregate ceiling bounds them all; it is
  // separate from `ingressGlobal` so an anonymous flood cannot hold a signed-in browser at 429.
  ingressSessionGlobal: { limit: 6_000, windowMs: 60_000, what: "requests with a session cookie" },
} as const;

export type RateBucket = keyof typeof RATE_LIMITS;

/**
 * A temporary ban for an address that keeps getting refused. `refusals` refusals inside `windowMs` ban the address
 * for `banMs`. While banned, every request from it gets 429 before any other work.
 */
export const INGRESS_BAN = {
  refusals: 300,
  windowMs: 5 * 60_000,
  banMs: 15 * 60_000,
} as const;

const KEY = Symbol.for("egg.rate-limiter");

/**
 * One limiter PER PROCESS, shared by separately bundled route modules and the proxy.
 *
 * INVARIANT: there is no shared store, and Egg's supported self-hosted topology runs exactly ONE app container.
 * Every limit here is therefore counted once per process. N replicas multiply every limit by N and thin out the
 * bans by the same factor (refusals are spread over N independent tables), so a multi-replica deployment is not a
 * supported way to run this app. Do not "fix" that by adding a shared store: the in-process design is deliberate,
 * the same as the terminal sessions, and a network store would change every limit's behaviour on restart and outage.
 */
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

export type IngressBucket = "all" | "json" | "webhook";

export type Admission =
  | { refused: false }
  | { refused: true; banned: boolean; retryAfterSeconds: number };

/**
 * A stable identity for a request whose address is unknown: the session cookie token. The cookie name must stay in
 * step with SESSION_COOKIE in src/server/auth/session.ts; this import-free module (loaded by the proxy without the
 * auth or database code) cannot import it. Only a token-shaped value counts, so an unrelated cookie cannot claim a
 * bucket. A cookie is a claim, not proof of a valid session - validation needs the database - but it is enough to
 * keep a signed-in browser out of the shared anonymous bucket.
 */
function sessionCookieKey(headers: Headers): string | null {
  const cookie = headers.get("cookie");
  if (!cookie) return null;
  for (const part of cookie.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0 || part.slice(0, eq).trim() !== "egg_session") continue;
    const token = part.slice(eq + 1).trim();
    if (token && /^[A-Za-z0-9_-]+$/.test(token)) return `session:${token}`;
  }
  return null;
}

/**
 * Decide whether a request may run. Called by the proxy for every request it sees, and by the handlers the proxy
 * does not see (see the matcher in src/proxy.ts).
 *
 * - Address known (TRUST_PROXY on, or a socket address): a ban is checked first. Then `ingress` (and `ingressJson`
 *   for the JSON routes). Every refusal counts toward the ban. The webhook gets only `ingressWebhook` and is never
 *   banned, so a GitHub address cannot be locked out.
 * - No address, `options.userId` given (a route that has validated the session): the same per-route and ingress
 *   gates, keyed by that user id. All of a user's sessions and routes then share one bucket, and an anonymous
 *   flood on the shared key cannot hold them at 429.
 * - No address, session cookie present: the middleware cannot validate a cookie or resolve a user id without the
 *   database, so the cookie token is used as a stable per-session key. It still gets its own per-route and ingress
 *   gates instead of the shared anonymous bucket; a forged token only earns its own bucket, not anyone else's 429.
 * - No address and no identity: all such requests share the `ingress-global` ceiling only, and nothing is banned
 *   for it. The webhook is not limited at all in that case, so no one can block GitHub's deliveries by filling
 *   the shared key.
 */
export function admitRequest(
  headers: Headers,
  options: { trustProxy: boolean; bucket: IngressBucket; userId?: string | null }
): Admission {
  const limiter = rateLimiter();
  limiter.sweepIfDue();
  const address = pickClientIp(headers, options.trustProxy, null);

  // A webhook has no session, so a filled shared key must never block GitHub's deliveries.
  if (!address && options.bucket === "webhook") return { refused: false };

  // An address wins when one is known (TRUST_PROXY on). With none, prefer a validated user id, then the session
  // cookie. Only requests with none of the three fall back to the shared anonymous key.
  const identity = address ?? (options.userId ? `user:${options.userId}` : sessionCookieKey(headers));
  if (!identity) {
    const g = RATE_LIMITS.ingressGlobal;
    const r = limiter.check("ingress-global", g.limit, g.windowMs);
    return r.allowed ? { refused: false } : { refused: true, banned: false, retryAfterSeconds: r.retryAfterSeconds };
  }

  // A cookie key is a claim, not proof: anyone can mint unlimited fresh token-shaped cookies,
  // and each would otherwise earn its own private ingress (and json) budget. Every cookie-claim
  // request therefore also counts toward one aggregate ceiling across all claims, so minting can
  // widen neither a single claim nor the instance-wide allowance. The ceiling is separate from
  // the anonymous one, so a cookie-less flood cannot hold a signed-in browser at 429 either.
  if (identity.startsWith("session:")) {
    const g = RATE_LIMITS.ingressSessionGlobal;
    const r = limiter.check("ingress-session-global", g.limit, g.windowMs);
    if (!r.allowed) {
      return { refused: true, banned: false, retryAfterSeconds: r.retryAfterSeconds };
    }
  }

  if (options.bucket === "webhook") {
    const w = RATE_LIMITS.ingressWebhook;
    const r = limiter.check(`ingress-webhook:${identity}`, w.limit, w.windowMs);
    return r.allowed ? { refused: false } : { refused: true, banned: false, retryAfterSeconds: r.retryAfterSeconds };
  }

  const ban = limiter.banRemainingMs(`ban:${identity}`);
  if (ban > 0) return { refused: true, banned: true, retryAfterSeconds: Math.ceil(ban / 1000) };

  const rules: [string, { limit: number; windowMs: number }][] = [["all", RATE_LIMITS.ingress]];
  if (options.bucket === "json") rules.push(["json", RATE_LIMITS.ingressJson]);
  for (const [name, rule] of rules) {
    const r = limiter.check(`ingress-${name}:${identity}`, rule.limit, rule.windowMs);
    if (r.allowed) continue;
    const refusals = limiter.countEvent(`refused:${identity}`, INGRESS_BAN.windowMs, INGRESS_BAN.refusals);
    if (refusals >= INGRESS_BAN.refusals) limiter.ban(`ban:${identity}`, INGRESS_BAN.banMs);
    return { refused: true, banned: false, retryAfterSeconds: r.retryAfterSeconds };
  }
  return { refused: false };
}

/** The short plain message for a refused request. Shared by the proxy and the route helper. */
export function refusalText(banned: boolean, retryAfterSeconds: number): string {
  const wait = `Wait ${retryAfterSeconds} second${retryAfterSeconds === 1 ? "" : "s"} and try again.`;
  return banned
    ? `Too many requests from this address. ${wait}`
    : `Too many requests. ${wait}`;
}
