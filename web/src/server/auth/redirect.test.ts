import { describe, expect, it } from "vitest";
import { parseOauthCookie, safeNextPath } from "@/server/auth/redirect";

describe("safeNextPath", () => {
  it.each(["/account", "/projects/abc?tab=env", "/account#keys"])("keeps the local path %s", (p) => {
    expect(safeNextPath(p)).toBe(p);
  });

  it.each([
    "//evil.example",
    String.raw`/\evil.example`,
    String.raw`/\/evil.example`,
    "/\t/evil.example",
    "/\n/evil.example",
    "/\r/evil.example",
    String.raw`\\evil.example`,
    "https://evil.example",
    "javascript:alert(1)",
    "evil.example",
    "",
    "/%2F/evil.example/../..",
    "/ok\u0000",
  ])("falls back to /account for %j", (p) => {
    const out = safeNextPath(p);
    expect(new URL(out, "https://app.example").origin).toBe("https://app.example");
    if (!p.startsWith("/%2F")) expect(out).toBe("/account");
  });

  it("falls back for non-strings and null", () => {
    expect(safeNextPath(null)).toBe("/account");
    expect(safeNextPath(undefined)).toBe("/account");
    expect(safeNextPath(42 as never)).toBe("/account");
  });

  it("uses the caller's fallback", () => {
    expect(safeNextPath("//x", "/projects")).toBe("/projects");
  });
});

describe("parseOauthCookie", () => {
  it("reads a well-formed cookie", () => {
    expect(parseOauthCookie(JSON.stringify({ s: "a", v: "b" }))).toEqual({ s: "a", v: "b" });
    expect(parseOauthCookie(JSON.stringify({ s: "a", v: "b", p: "reauth", n: "/x" }))).toEqual({
      s: "a",
      v: "b",
      p: "reauth",
      n: "/x",
    });
  });

  it.each(["null", "42", "[]", "not json", "{}", '{"s":1,"v":"b"}', '{"s":"a"}', '{"s":"","v":"b"}', '{"s":"a","v":"b","p":"x"}'])(
    "refuses %s",
    (raw) => {
      expect(parseOauthCookie(raw)).toBeNull();
    }
  );
});
