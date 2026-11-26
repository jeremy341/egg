import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { proxy } from "@/proxy";

function request(path: string, cookie?: string) {
  return new NextRequest(`http://localhost:3100${path}`, {
    headers: cookie ? { cookie } : undefined,
  });
}

const SIGNED_IN = "egg_session=abc";

describe("docs are for signed-in people only", () => {
  it.each(["/docs", "/docs/quickstart"])("sends a signed-out visitor from %s to /login", (path) => {
    const res = proxy(request(path));
    expect(res.status).toBe(307);
    expect(new URL(res.headers.get("location")!).pathname).toBe("/login");
  });

  it.each(["/docs", "/docs/quickstart"])("lets a visitor with a session cookie read %s", (path) => {
    const res = proxy(request(path, SIGNED_IN));
    expect(res.headers.get("location")).toBeNull();
    expect(res.headers.get("x-middleware-next")).toBe("1");
  });
});

describe("pages that stay public", () => {
  it.each([
    "/",
    "/login",
    "/stats",
    "/nest-status",
    "/api/status/nest",
    "/api/public/deployments",
    "/status/abc",
    "/api/analytics/script",
    "/api/collect/x",
    "/api/v1/projects",
    "/api/mcp",
    "/api/builds/upload",
    "/api/builds/env",
  ])("lets a signed-out visitor through to %s", (path) => {
    const res = proxy(request(path));
    expect(res.headers.get("location")).toBeNull();
    expect(res.status).toBe(200);
  });
});

describe("GitHub build endpoints", () => {
  it("keeps the scoped env lookup public to bearer callers without opening the rest of /api/builds", () => {
    expect(proxy(request("/api/builds/env")).status).toBe(200);
    expect(proxy(request("/api/builds/other")).status).toBe(401);
    expect(proxy(request("/api/builds/upload/extra")).status).toBe(401);
  });
});

describe("the anonymous security report intake", () => {
  const post = (path: string) => new NextRequest(`http://localhost:3100${path}`, { method: "POST" });

  it("lets a signed-out visitor POST a report to /api/security-reports", () => {
    const res = proxy(post("/api/security-reports"));
    expect(res.status).toBe(200);
    expect(res.headers.get("x-middleware-next")).toBe("1");
  });

  it("lets a signed-out visitor read the enabled flag the public form asks for", () => {
    const res = proxy(request("/api/security-reports"));
    expect(res.headers.get("x-middleware-next")).toBe("1");
  });

  it.each(["/api/security-reports/", "/api/security-reports/anything", "/api/security-reports/x/evidence/0"])(
    "keeps %s closed to signed-out visitors",
    (path) => {
      const res = proxy(post(path));
      expect(res.status).toBe(401);
    }
  );

  it.each(["/api/admin/security-reports", "/api/admin/security-reports/abc", "/api/admin/security-reports/abc/evidence/0"])(
    "keeps the administrator inbox %s closed to signed-out visitors",
    (path) => {
      expect(proxy(request(path)).status).toBe(401);
      expect(proxy(post(path)).status).toBe(401);
    }
  );
});

describe("the proxy matcher", () => {
  it("skips static files by extension only, not any path that merely ends in those letters", async () => {
    const { config } = await import("@/proxy");
    const [pattern] = config.matcher;
    const skip = pattern.slice(pattern.indexOf("(?!") + 3, pattern.indexOf(").*)"));
    const asRegex = new RegExp(`^/(?:${skip.replace(/\//g, "\/")})`);
    expect(asRegex.test("/logo.png")).toBe(true);
    expect(asRegex.test("/icons/mark.svg")).toBe(true);
    expect(asRegex.test("/api/v1/projects/xpng")).toBe(false);
    expect(asRegex.test("/api/tokens/mysvg")).toBe(false);
  });

  it("skips the large upload route but keeps the small env route under the proxy", async () => {
    const { config } = await import("@/proxy");
    const [pattern] = config.matcher;
    const skip = pattern.slice(pattern.indexOf("(?!") + 3, pattern.indexOf(").*)"));
    const asRegex = new RegExp(`^/(?:${skip.replace(/\//g, "\/")})`);
    expect(asRegex.test("/api/builds/upload")).toBe(true);
    expect(asRegex.test("/api/builds/env")).toBe(false);
    expect(asRegex.test("/api/build")).toBe(false);
  });
});

describe("API CORS", () => {
  it("allows any origin on /api/v1 but never credentials", () => {
    const pre = proxy(new NextRequest("http://localhost:3100/api/v1/projects", { method: "OPTIONS", headers: { cookie: SIGNED_IN } }));
    const res = proxy(request("/api/v1/projects", SIGNED_IN));
    for (const r of [pre, res]) {
      expect(r.headers.get("access-control-allow-origin")).toBe("*");
      expect(r.headers.get("access-control-allow-credentials")).toBeNull();
    }
    expect(pre.status).toBe(204);
  });

  it("does not open the dashboard routes to other origins", () => {
    for (const path of ["/api/tokens", "/api/projects", "/api/auth/logout"]) {
      expect(proxy(request(path, SIGNED_IN)).headers.get("access-control-allow-origin"), path).toBeNull();
    }
  });
});
