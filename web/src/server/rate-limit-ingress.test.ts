import { beforeEach, describe, expect, it, vi } from "vitest";
import { INGRESS_BAN, RATE_LIMITS, SlidingWindowLimiter, admitRequest, rateLimiter, refusalText } from "@/server/rate-limit-core";
import { enforceIngress } from "@/server/rate-limit";

function clock(start = 1_000_000) {
  let t = start;
  return { now: () => t, advance: (ms: number) => void (t += ms) };
}

describe("limiter memory bounds", () => {
  it("counts events inside the window and keeps only the last `keep` of them", () => {
    const c = clock();
    const l = new SlidingWindowLimiter(100, c.now);
    expect(l.countEvent("r", 1000, 3)).toBe(1);
    expect(l.countEvent("r", 1000, 3)).toBe(2);
    expect(l.countEvent("r", 1000, 3)).toBe(3);
    expect(l.countEvent("r", 1000, 3)).toBe(3); // topped out: the stored list does not grow
    c.advance(1000);
    expect(l.countEvent("r", 1000, 3)).toBe(1); // the earlier ones have left the window
  });

  it("bans a key for the given time and reports the time left", () => {
    const c = clock();
    const l = new SlidingWindowLimiter(100, c.now);
    l.ban("b", 5000);
    expect(l.banRemainingMs("b")).toBe(5000);
    expect(l.activeBans()).toBe(1);
    c.advance(5000);
    expect(l.banRemainingMs("b")).toBe(0);
    expect(l.activeBans()).toBe(0);
  });

  it("sweeps expired keys only once a minute, and keeps a banned key until its ban ends", () => {
    const c = clock();
    const l = new SlidingWindowLimiter(100, c.now);
    l.check("a", 5, 1000);
    l.ban("b", 90_000);
    c.advance(2000);
    l.sweepIfDue();
    expect(l.size).toBe(2); // not a minute yet
    c.advance(58_000); // t = 60 s
    l.sweepIfDue();
    expect(l.size).toBe(1); // "a" expired; "b" is still banned
    expect(l.banRemainingMs("b")).toBe(30_000);
    c.advance(60_000);
    l.sweepIfDue();
    expect(l.size).toBe(0);
  });

  it("never holds more keys than the cap when bans and counters fill it", () => {
    const l = new SlidingWindowLimiter(50, clock().now);
    for (let i = 0; i < 1000; i++) {
      l.ban(`ban:${i}`, 60_000);
      l.countEvent(`refused:${i}`, 60_000, 100);
    }
    expect(l.size).toBeLessThanOrEqual(50);
  });

  it("evicts the oldest-inserted key when the table is full of live keys", () => {
    const l = new SlidingWindowLimiter(3, clock().now);
    l.ban("first", 60_000);
    l.ban("second", 60_000);
    l.ban("third", 60_000);
    l.ban("fourth", 60_000);
    expect(l.size).toBe(3);
    expect(l.banRemainingMs("first")).toBe(0);
    expect(l.banRemainingMs("fourth")).toBe(60_000);
  });
});

describe("admitRequest", () => {
  const h = (init: Record<string, string> = {}) => new Headers(init);
  const xff = (ip: string) => h({ "x-forwarded-for": ip });

  beforeEach(() => {
    rateLimiter().clear();
  });

  it("uses the same limits as RATE_LIMITS: 600 a minute for all, 60 more for the JSON routes", () => {
    expect(RATE_LIMITS.ingress).toMatchObject({ limit: 600, windowMs: 60_000 });
    expect(RATE_LIMITS.ingressJson).toMatchObject({ limit: 60, windowMs: 60_000 });
    expect(RATE_LIMITS.ingressWebhook).toMatchObject({ limit: 600, windowMs: 60_000 });
    expect(INGRESS_BAN).toEqual({ refusals: 300, windowMs: 5 * 60_000, banMs: 15 * 60_000 });
  });

  it("refuses from the address that the proxy appended, right-most, when TRUST_PROXY is on", () => {
    for (let i = 0; i < RATE_LIMITS.ingress.limit; i++) admitRequest(xff("6.6.6.6, 203.0.113.9"), { trustProxy: true, bucket: "all" });
    expect(admitRequest(xff("6.6.6.6, 203.0.113.9"), { trustProxy: true, bucket: "all" }).refused).toBe(true);
    expect(admitRequest(xff("203.0.113.10"), { trustProxy: true, bucket: "all" }).refused).toBe(false);
  });

  it("gives an unknown address only the shared global ceiling, and never bans it", () => {
    for (let i = 0; i < RATE_LIMITS.ingressGlobal.limit; i++) {
      expect(admitRequest(h(), { trustProxy: false, bucket: "all" }).refused).toBe(false);
    }
    const over = admitRequest(h({ "x-forwarded-for": "203.0.113.9" }), { trustProxy: false, bucket: "all" });
    expect(over).toEqual({ refused: true, banned: false, retryAfterSeconds: expect.any(Number) });
    expect(rateLimiter().activeBans()).toBe(0);
  });

  it("never limits or bans the webhook when the address is unknown, so no one can block GitHub's deliveries", () => {
    for (let i = 0; i < RATE_LIMITS.ingressGlobal.limit + 10; i++) {
      expect(admitRequest(h(), { trustProxy: false, bucket: "webhook" }).refused).toBe(false);
    }
  });

  it("limits the webhook to 600 a minute per address, and does not count its refusals toward a ban", () => {
    for (let i = 0; i < RATE_LIMITS.ingressWebhook.limit; i++) admitRequest(xff("192.30.252.1"), { trustProxy: true, bucket: "webhook" });
    for (let i = 0; i < 150; i++) {
      const r = admitRequest(xff("192.30.252.1"), { trustProxy: true, bucket: "webhook" });
      expect(r).toMatchObject({ refused: true, banned: false });
    }
    // Still not banned: a page request from the same address is judged on its own limit only.
    expect(admitRequest(xff("192.30.252.1"), { trustProxy: true, bucket: "all" })).toEqual({ refused: false });
  });

  it("refusal text says whether the address is banned, and is short and plain", () => {
    expect(refusalText(false, 1)).toBe("Too many requests. Wait 1 second and try again.");
    expect(refusalText(true, 900)).toBe("Too many requests from this address. Wait 900 seconds and try again.");
  });

  it("the route helper throws a 429 with Retry-After", () => {
    rateLimiter().clear();
    const forged = () => h({ "x-forwarded-for": "198.51.100.7" });
    vi.stubEnv("TRUST_PROXY", "1");
    try {
      for (let i = 0; i < RATE_LIMITS.ingress.limit; i++) enforceIngress(forged(), "all");
      let err: unknown;
      try {
        enforceIngress(forged(), "all");
      } catch (e) {
        err = e;
      }
      expect(err).toMatchObject({ status: 429, code: "rate_limited" });
      expect((err as { headers: Record<string, string> }).headers["Retry-After"]).toMatch(/^\d+$/);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
