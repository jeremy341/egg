import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { HttpError, assertSameOrigin, handle } from "@/server/http";

const post = (headers: Record<string, string> = {}, method = "POST") =>
  new NextRequest("http://localhost:3000/api/tokens", { method, headers });

describe("assertSameOrigin", () => {
  it("lets a write through from our own origin", () => {
    expect(() => assertSameOrigin(post({ origin: "http://localhost:3000" }))).not.toThrow();
  });

  it.each(["https://evil.example", "null", "http://localhost:3001", "http://localhost.evil.example"])(
    "blocks a write from origin %s",
    (origin) => {
      const err = (() => {
        try {
          assertSameOrigin(post({ origin }));
        } catch (e) {
          return e as HttpError;
        }
      })();
      expect(err?.status).toBe(403);
      expect(err?.code).toBe("csrf");
    }
  );

  it("blocks a write that names no Origin but the browser says is cross-site or same-site", () => {
    expect(() => assertSameOrigin(post({ "sec-fetch-site": "cross-site" }))).toThrow(HttpError);
    expect(() => assertSameOrigin(post({ "sec-fetch-site": "same-site" }))).toThrow(HttpError);
  });

  it("still allows non-browser clients and same-origin fetches that send no Origin", () => {
    expect(() => assertSameOrigin(post())).not.toThrow();
    expect(() => assertSameOrigin(post({ "sec-fetch-site": "same-origin" }))).not.toThrow();
    expect(() => assertSameOrigin(post({ "sec-fetch-site": "none" }))).not.toThrow();
  });

  it("never blocks reads", () => {
    expect(() => assertSameOrigin(post({ origin: "https://evil.example" }, "GET"))).not.toThrow();
    expect(() => assertSameOrigin(post({ "sec-fetch-site": "cross-site" }, "HEAD"))).not.toThrow();
  });
});

describe("handle", () => {
  it("answers a cross-site write with 403 before the handler runs", async () => {
    const fn = vi.fn(async () => new Response("ran"));
    const res = await handle(fn)(post({ origin: "https://evil.example" }), undefined);
    expect(res.status).toBe(403);
    expect(fn).not.toHaveBeenCalled();
  });

  it("hides the cause of an unexpected error", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const res = await handle(async () => {
      throw new Error("SQLITE_ERROR: no such table users at /srv/app/db.ts");
    })(post(), undefined);
    spy.mockRestore();
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(text).not.toMatch(/SQLITE|srv|users/);
  });
});
