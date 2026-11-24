import { describe, expect, it } from "vitest";
import { displayMessage, fingerprintOf, normalizeFile, normalizeMessage } from "./error-fingerprint";

describe("normalizeMessage", () => {
  it("replaces numbers with a placeholder", () => {
    expect(normalizeMessage("Timeout after 3000 ms on item 42")).toBe("Timeout after <n> ms on item <n>");
    expect(normalizeMessage("ratio 0.75")).toBe("ratio <n>");
  });

  it("replaces uuids, hex ids and mixed tokens", () => {
    expect(normalizeMessage("order 123e4567-e89b-12d3-a456-426614174000 failed")).toBe("order <id> failed");
    expect(normalizeMessage("commit deadbeef12 missing")).toBe("commit <id> missing");
    expect(normalizeMessage("token Ab3xQ9zLm0Rt8Vn2 rejected")).toBe("token <id> rejected");
  });

  it("leaves ordinary words alone", () => {
    expect(normalizeMessage("Cannot read properties of undefined")).toBe("Cannot read properties of undefined");
  });

  it("removes query strings and fragments from URLs", () => {
    expect(normalizeMessage("GET https://example.com/a?token=abc&id=7#top failed")).toBe(
      "GET https://example.com/a failed"
    );
  });

  it("collapses whitespace and caps the length", () => {
    expect(normalizeMessage("  a \n\t b  ")).toBe("a b");
    expect(normalizeMessage("x".repeat(1000))).toHaveLength(300);
  });
});

describe("normalizeFile", () => {
  it("drops the query, the line and the column", () => {
    expect(normalizeFile("https://cdn.example.com/app.js?v=9:12:5")).toBe("https://cdn.example.com/app.js");
    expect(normalizeFile("/static/app.js:40")).toBe("/static/app.js");
  });

  it("replaces hashed bundle names", () => {
    expect(normalizeFile("/_next/chunk-3f2a9c1b8e7d.js")).toBe("/_next/chunk-<id>.js");
  });

  it("gives an empty string for no file", () => {
    expect(normalizeFile(null)).toBe("");
    expect(normalizeFile(undefined)).toBe("");
  });
});

describe("fingerprintOf", () => {
  it("is 16 hex characters", () => {
    expect(fingerprintOf("boom", "/a.js")).toMatch(/^[0-9a-f]{16}$/);
  });

  it("is the same when only numbers, ids or query strings differ", () => {
    const a = fingerprintOf("User 12 not found: 3f9a2b7c1d", "https://x.test/app.js?v=1:10:3");
    const b = fingerprintOf("User 98 not found: 77aa11bb22", "https://x.test/app.js?v=2:44:9");
    expect(a).toBe(b);
  });

  it("is different when the message differs", () => {
    expect(fingerprintOf("Cannot read x", "/a.js")).not.toBe(fingerprintOf("Cannot write x", "/a.js"));
  });

  it("is different when the top frame file differs", () => {
    expect(fingerprintOf("boom", "/a.js")).not.toBe(fingerprintOf("boom", "/b.js"));
  });

  it("works without a file", () => {
    expect(fingerprintOf("boom", null)).toBe(fingerprintOf("boom", ""));
  });
});

describe("displayMessage", () => {
  it("removes query strings but keeps the numbers the reader needs", () => {
    expect(displayMessage("Failed at https://x.test/api?key=secret with 500")).toBe("Failed at https://x.test/api with 500");
  });
});
