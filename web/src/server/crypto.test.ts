import { describe, expect, it } from "vitest";
import { open, seal, safeEqual, sha256Hex } from "@/server/crypto";

describe("seal/open", () => {
  it("round-trips a value", () => {
    const sealed = seal("-----BEGIN KEY-----\nabc", "server:1");
    expect(sealed).not.toContain("BEGIN KEY");
    expect(open(sealed, "server:1")).toBe("-----BEGIN KEY-----\nabc");
  });

  it("round-trips an empty value, so a blank variable can still be deployed", () => {
    expect(open(seal("", "env:1"), "env:1")).toBe("");
  });

  it("uses a fresh IV every time", () => {
    expect(seal("same", "ctx")).not.toBe(seal("same", "ctx"));
  });

  it("refuses to open under a different context", () => {
    const sealed = seal("secret", "server:1");
    expect(() => open(sealed, "server:2")).toThrow();
  });

  it("detects tampering", () => {
    const sealed = seal("secret", "ctx");
    const parts = sealed.split(".");
    parts[3] = Buffer.from("tampered").toString("base64url");
    expect(() => open(parts.join("."), "ctx")).toThrow();
  });

  it("rejects values it did not produce", () => {
    expect(() => open("nonsense", "ctx")).toThrow(/Unrecognised/);
  });

  it("round-trips an empty value, because an env var may legitimately be empty", () => {
    const sealed = seal("", "env:p1:DEBUG:all");
    expect(open(sealed, "env:p1:DEBUG:all")).toBe("");
    // A missing ciphertext segment is still rejected: only the empty string seals to "".
    const [, iv, tag] = sealed.split(".");
    expect(() => open([ "v1", iv, tag ].join("."), "env:p1:DEBUG:all")).toThrow(/Unrecognised/);
  });
});

describe("helpers", () => {
  it("hashes deterministically", () => {
    expect(sha256Hex("a")).toBe(sha256Hex("a"));
    expect(sha256Hex("a")).not.toBe(sha256Hex("b"));
  });

  it("compares in constant time and handles length mismatch", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "abcd")).toBe(false);
  });
});
