import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { proxy } from "@/proxy";

function request(path: string, cookie?: string) {
  return new NextRequest(`http://localhost:3100${path}`, {
    headers: cookie ? { cookie } : undefined,
  });
}

const SIGNED_IN = "nd_session=abc";

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
    "/status/abc",
    "/api/analytics/script",
    "/api/collect/x",
    "/api/v1/projects",
    "/api/mcp",
  ])("lets a signed-out visitor through to %s", (path) => {
    const res = proxy(request(path));
    expect(res.headers.get("location")).toBeNull();
    expect(res.status).toBe(200);
  });
});
