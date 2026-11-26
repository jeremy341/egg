import { NextRequest } from "next/server";
import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import nextConfig from "../next.config";
import { config as proxyConfig, proxy } from "@/proxy";
import { backendMetricsSnapshot } from "@/server/backend-metrics";
import { INGRESS_BAN, RATE_LIMITS, rateLimiter } from "@/server/rate-limit-core";

const T0 = Date.UTC(2026, 10, 14, 12, 0, 0);
const MINUTE = 60_000;

function req(path = "/", headers: Record<string, string> = {}) {
  return new NextRequest(`http://localhost:3100${path}`, { headers });
}
/** A request as it arrives through a proxy: the proxy appends the address it saw as the right-most entry. */
const via = (ip: string, forged?: string) => ({ "x-forwarded-for": forged ? `${forged}, ${ip}` : ip });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(T0);
  rateLimiter().clear();
  vi.stubEnv("TRUST_PROXY", "1");
  vi.stubEnv("EGG_BACKEND_METRICS", "1");
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("per-address limit on pages and API", () => {
  it("lets 600 requests a minute through from one address, then refuses with 429 and Retry-After", () => {
    for (let i = 0; i < RATE_LIMITS.ingress.limit; i++) expect(proxy(req("/", via("203.0.113.9"))).status).toBe(200);
    const res = proxy(req("/", via("203.0.113.9")));
    expect(res.status).toBe(429);
    expect(Number(res.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(res.headers.get("content-type")).toMatch(/^text\/plain/);
    expect(res.headers.get("location")).toBeNull();
    expect(res.headers.get("x-middleware-next")).toBeNull();
  });

  it("does not affect other addresses", () => {
    for (let i = 0; i < RATE_LIMITS.ingress.limit + 1; i++) proxy(req("/", via("203.0.113.9")));
    expect(proxy(req("/", via("203.0.113.10"))).status).toBe(200);
  });

  it("gives the public JSON routes their own 60 a minute on top of the general limit", () => {
    for (let i = 0; i < RATE_LIMITS.ingressJson.limit; i++) expect(proxy(req("/api/stats", via("203.0.113.9"))).status).toBe(200);
    expect(proxy(req("/api/stats", via("203.0.113.9"))).status).toBe(429);
    expect(proxy(req("/api/public/deployments", via("203.0.113.9"))).status).toBe(429);
    // The page routes from the same address are still under their own, larger, limit.
    expect(proxy(req("/", via("203.0.113.9"))).status).toBe(200);
  });

  it("refuses the JSON status routes too", () => {
    for (let i = 0; i < RATE_LIMITS.ingressJson.limit; i++) proxy(req("/api/status/nest", via("203.0.113.9")));
    expect(proxy(req("/api/status/nest", via("203.0.113.9"))).status).toBe(429);
  });

  it("leaves _next/static files out of the proxy, so they are not limited", () => {
    const proxied = (p: string) => unstable_doesMiddlewareMatch({ config: proxyConfig, nextConfig, url: p });
    expect(proxied("/_next/static/chunks/a.js")).toBe(false);
  });
});

describe("temporary ban", () => {
  it("bans an address after 300 refusals within 5 minutes, for 15 minutes, before any other work", async () => {
    const ip = "203.0.113.20";
    for (let i = 0; i < RATE_LIMITS.ingress.limit; i++) proxy(req("/", via(ip)));
    for (let i = 0; i < INGRESS_BAN.refusals; i++) expect(proxy(req("/", via(ip))).status).toBe(429);

    // A refused request from the banned address is the ban message, with the ban's time left.
    const banned = proxy(req("/", via(ip)));
    expect(banned.status).toBe(429);
    expect(await banned.text()).toMatch(/from this address/);
    expect(Number(banned.headers.get("retry-after"))).toBe(INGRESS_BAN.banMs / 1000);

    // Even a sign-in page or a public route is refused, and it stays refused for the whole ban.
    vi.setSystemTime(T0 + INGRESS_BAN.banMs - 1000);
    expect(proxy(req("/login", via(ip))).status).toBe(429);
    expect(proxy(req("/api/stats", via(ip))).status).toBe(429);
  });

  it("lifts the ban when its time is up", () => {
    const ip = "203.0.113.21";
    for (let i = 0; i < RATE_LIMITS.ingress.limit + INGRESS_BAN.refusals; i++) proxy(req("/", via(ip)));
    expect(proxy(req("/", via(ip))).status).toBe(429);
    vi.setSystemTime(T0 + INGRESS_BAN.banMs + 1);
    expect(proxy(req("/", via(ip))).status).toBe(200);
  });

  it("does not ban an address whose refusals are spread over more than 5 minutes", async () => {
    const ip = "203.0.113.22";
    for (let i = 0; i < RATE_LIMITS.ingress.limit + 50; i++) proxy(req("/", via(ip))); // 50 refusals
    vi.setSystemTime(T0 + INGRESS_BAN.windowMs + 1000); // the first 50 are now older than 5 minutes
    for (let i = 0; i < RATE_LIMITS.ingress.limit + 50; i++) proxy(req("/", via(ip))); // 50 more
    const res = proxy(req("/", via(ip)));
    expect(res.status).toBe(429);
    expect(await res.text()).not.toMatch(/from this address/);
  });
});

describe("the client address is read correctly", () => {
  it("a forged left-most X-Forwarded-For entry cannot dodge the limit", () => {
    for (let i = 0; i < RATE_LIMITS.ingress.limit; i++) {
      expect(proxy(req("/", via("203.0.113.30", `10.0.${i >> 8}.${i & 255}`))).status).toBe(200);
    }
    // Every request carried a new forged address, and all of them count against the real one.
    expect(proxy(req("/", via("203.0.113.30", "10.9.9.9"))).status).toBe(429);
  });

  it("a forged left-most entry cannot get another address banned", () => {
    // The client sends 400 requests that all claim to be 198.51.100.1 but arrive through 203.0.113.31.
    for (let i = 0; i < RATE_LIMITS.ingress.limit + INGRESS_BAN.refusals; i++) proxy(req("/", via("203.0.113.31", "198.51.100.1")));
    expect(proxy(req("/", via("203.0.113.31"))).status).toBe(429);
    // The address the client forged is not banned, and so is not refused.
    expect(proxy(req("/", via("198.51.100.1"))).status).toBe(200);
  });

  it("with TRUST_PROXY off the headers are ignored: one shared ceiling, no per-address limit, no ban", () => {
    vi.stubEnv("TRUST_PROXY", "");
    for (let i = 0; i < 400; i++) {
      // Each request forges a different address: none of it counts, because the headers are not read.
      expect(proxy(req("/", via(`198.51.100.${i % 250}`))).status).toBe(200);
    }
    expect(rateLimiter().activeBans()).toBe(0);
  });

  it("with TRUST_PROXY off, the shared ceiling refuses once it is used up, and nothing is banned", async () => {
    vi.stubEnv("TRUST_PROXY", "");
    for (let i = 0; i < RATE_LIMITS.ingressGlobal.limit; i++) proxy(req("/"));
    const res = proxy(req("/"));
    expect(res.status).toBe(429);
    expect(await res.text()).toMatch(/^Too many requests\. /);
    expect(rateLimiter().activeBans()).toBe(0);
  });
});

describe("counters", () => {
  it("counts requests and refusals per minute and reports active bans", () => {
    // The counters are module state, so start in a minute no earlier test used.
    vi.setSystemTime(T0 + 60 * MINUTE);
    for (let i = 0; i < RATE_LIMITS.ingress.limit + 2; i++) proxy(req("/", via("203.0.113.40")));
    const now = backendMetricsSnapshot().ingress;
    expect(now).toMatchObject({ requestsThisMinute: RATE_LIMITS.ingress.limit + 2, refusedThisMinute: 2, activeBans: 0 });

    vi.setSystemTime(T0 + 61 * MINUTE);
    proxy(req("/", via("203.0.113.41")));
    expect(backendMetricsSnapshot().ingress).toMatchObject({
      requestsThisMinute: 1,
      refusedThisMinute: 0,
      requestsLastMinute: RATE_LIMITS.ingress.limit + 2,
      refusedLastMinute: 2,
    });
  });

  it("reports a ban once it is set", () => {
    for (let i = 0; i < RATE_LIMITS.ingress.limit + INGRESS_BAN.refusals; i++) proxy(req("/", via("203.0.113.50")));
    expect(backendMetricsSnapshot().ingress.activeBans).toBe(1);
  });
});
