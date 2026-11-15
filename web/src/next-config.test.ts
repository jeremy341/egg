import { afterEach, describe, expect, it, vi } from "vitest";
import nextConfig from "../next.config";

afterEach(() => vi.unstubAllEnvs());

async function headersFor(source = "/:path*") {
  const rules = await nextConfig.headers!();
  const rule = rules.find((r) => r.source === source);
  expect(rule, `a header rule for ${source}`).toBeDefined();
  return Object.fromEntries(rule!.headers.map((h) => [h.key.toLowerCase(), h.value]));
}

describe("security headers", () => {
  it("covers every route with the baseline headers", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const h = await headersFor();
    expect(h["x-content-type-options"]).toBe("nosniff");
    expect(h["referrer-policy"]).toBe("strict-origin-when-cross-origin");
    expect(h["permissions-policy"]).toContain("camera=()");
    expect(h["x-frame-options"]).toBe("DENY");
  });

  it("forbids framing, plugins, base-tag and form-target tricks in the CSP", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const csp = (await headersFor())["content-security-policy"];
    for (const part of [
      "default-src 'self'",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "object-src 'none'",
      "connect-src 'self'",
    ]) {
      expect(csp).toContain(part);
    }
  });

  it("allows eval only outside production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    expect((await headersFor())["content-security-policy"]).not.toContain("'unsafe-eval'");
    vi.stubEnv("NODE_ENV", "development");
    expect((await headersFor())["content-security-policy"]).toContain("'unsafe-eval'");
  });

  it("keeps 'unsafe-inline' for scripts: the prerendered shell cannot carry a request nonce", async () => {
    vi.stubEnv("NODE_ENV", "production");
    expect((await headersFor())["content-security-policy"]).toContain("script-src 'self' 'unsafe-inline'");
  });

  it("sends HSTS in production only", async () => {
    vi.stubEnv("NODE_ENV", "production");
    expect((await headersFor())["strict-transport-security"]).toMatch(/^max-age=\d+; includeSubDomains$/);
    vi.stubEnv("NODE_ENV", "development");
    expect((await headersFor())["strict-transport-security"]).toBeUndefined();
  });
});
