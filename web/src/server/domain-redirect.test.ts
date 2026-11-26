import { describe, expect, it } from "vitest";
import { isRedirectStatus, parseRedirectTarget, redirectResponse, REDIRECT_STATUSES } from "@/server/domain-redirect";

const SOURCE = "old.example.com";

describe("redirect statuses", () => {
  it("offers exactly 307, 308, 301 and 302", () => {
    expect([...REDIRECT_STATUSES].sort()).toEqual([301, 302, 307, 308]);
    expect(isRedirectStatus(200)).toBe(false);
    expect(isRedirectStatus(303)).toBe(false);
  });

  for (const status of [307, 308, 301, 302] as const) {
    it(`answers with ${status} and a Location on the target`, () => {
      const r = redirectResponse({ origin: "https://new.example.com", status, path: "/docs", query: "" });
      expect(r.status).toBe(status);
      expect(r.location).toBe("https://new.example.com/docs");
    });
  }
});

describe("path and query are kept", () => {
  const origin = "https://new.example.com";

  it("keeps a deep path and a query exactly as sent", () => {
    const r = redirectResponse({ origin, status: 301, path: "/a/b/c", query: "x=1&y=two%20words" });
    expect(r.location).toBe("https://new.example.com/a/b/c?x=1&y=two%20words");
  });

  it("keeps a trailing slash and does not add one", () => {
    expect(redirectResponse({ origin, status: 308, path: "/blog/", query: "" }).location).toBe("https://new.example.com/blog/");
    expect(redirectResponse({ origin, status: 308, path: "/blog", query: "" }).location).toBe("https://new.example.com/blog");
  });

  it("keeps the root path and adds no query mark when there is no query", () => {
    expect(redirectResponse({ origin, status: 302, path: "/", query: "" }).location).toBe("https://new.example.com/");
    expect(redirectResponse({ origin, status: 302, path: "", query: "" }).location).toBe("https://new.example.com/");
  });

  it("does not double the question mark if one is passed in", () => {
    expect(redirectResponse({ origin, status: 307, path: "/x", query: "?a=1" }).location).toBe("https://new.example.com/x?a=1");
  });

  it("keeps a path that begins with two slashes on the chosen origin", () => {
    expect(redirectResponse({ origin, status: 307, path: "//evil.test/x", query: "" }).location).toBe("https://new.example.com//evil.test/x");
  });

  it("refuses a request path that does not start with a slash", () => {
    expect(() => redirectResponse({ origin, status: 307, path: "x", query: "" })).toThrow(/must start with/);
  });
});

describe("redirect target validation", () => {
  it("accepts an https origin and returns it without a trailing slash", () => {
    expect(parseRedirectTarget("https://new.example.com/", SOURCE)).toEqual({ ok: true, origin: "https://new.example.com" });
    expect(parseRedirectTarget("https://new.example.com", SOURCE)).toEqual({ ok: true, origin: "https://new.example.com" });
  });

  it("keeps an explicit port", () => {
    expect(parseRedirectTarget("http://new.example.com:8080", SOURCE)).toEqual({ ok: true, origin: "http://new.example.com:8080" });
  });

  it("refuses other schemes", () => {
    expect(parseRedirectTarget("ftp://new.example.com", SOURCE).ok).toBe(false);
    expect(parseRedirectTarget("javascript:alert(1)", SOURCE).ok).toBe(false);
  });

  it("refuses a target with a path, query or fragment", () => {
    for (const raw of ["https://new.example.com/docs", "https://new.example.com?a=1", "https://new.example.com#x"]) {
      expect(parseRedirectTarget(raw, SOURCE).ok).toBe(false);
    }
  });

  it("refuses a login in the target", () => {
    expect(parseRedirectTarget("https://user:pw@new.example.com", SOURCE).ok).toBe(false);
  });

  it("refuses an IP address and a bare word", () => {
    expect(parseRedirectTarget("https://203.0.113.5", SOURCE).ok).toBe(false);
    expect(parseRedirectTarget("https://localhost", SOURCE).ok).toBe(false);
  });

  it("refuses redirecting a domain to itself", () => {
    expect(parseRedirectTarget("https://OLD.example.com", SOURCE).ok).toBe(false);
  });

  it("refuses text that is not an address", () => {
    expect(parseRedirectTarget("new example", SOURCE).ok).toBe(false);
  });
});
