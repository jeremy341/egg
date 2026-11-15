import { describe, expect, it } from "vitest";
import { maskSecrets, secretNeedles } from "@/server/deploy/redact";

describe("secret masking", () => {
  it("masks a value", () => {
    const n = secretNeedles(["hunter2-long"]);
    expect(maskSecrets("token=hunter2-long", n)).toBe("token=***");
  });

  it("masks a value under four characters where it stands alone, not inside other words", () => {
    const n = secretNeedles(["abc", "42"]);
    expect(maskSecrets("pw=abc and abcdef, port 42; v42 4200 (42)", n)).toBe("pw=*** and abcdef, port ***; v42 4200 (***)");
  });

  it("does not mask a one-character value, which would garble every line", () => {
    expect(secretNeedles(["1", " ", ""])).toEqual([]);
  });

  it("masks the base64 form of a secret, padded, unpadded and URL-safe", () => {
    const secret = "p@ss?word>>~";
    const b64 = Buffer.from(secret).toString("base64");
    expect(b64).toMatch(/[+/=]/);
    const n = secretNeedles([secret]);
    expect(maskSecrets(`Authorization: Basic ${b64}`, n)).toBe("Authorization: Basic ***");
    expect(maskSecrets(`x=${b64.replace(/=+$/, "")}`, n)).toBe("x=***");
    const url = b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    expect(maskSecrets(`jwt ${url}`, n)).toBe("jwt ***");
  });

  it("masks the base64 form of a short secret", () => {
    const n = secretNeedles(["ab"]);
    expect(maskSecrets("YWI= and ab", n)).toBe("*** and ***");
  });

  it("masks the percent-encoded form of a secret", () => {
    const secret = "a b&c=d/é";
    const n = secretNeedles([secret]);
    expect(maskSecrets("GET /?q=" + encodeURIComponent(secret), n)).toBe("GET /?q=***");
    expect(maskSecrets("body=" + encodeURIComponent(secret).replace(/%20/g, "+"), n)).toBe("body=***");
  });

  it("does not list an encoded form that equals the value, so plain secrets stay as they were", () => {
    expect(secretNeedles(["hunter2long"]).filter((x) => x === "hunter2long")).toHaveLength(1);
  });

  it("masks each line of a multi-line secret, because output is stored line by line", () => {
    const key = "-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0B\nAQEFAASCBKcwggSjAgEAAoIBAQDx\n-----END PRIVATE KEY-----";
    const n = secretNeedles([key]);
    const lines = key.split("\n").map((l) => maskSecrets(l, n));
    expect(lines.join("\n")).not.toContain("MIIEvQIBADANBgkqhkiG9w0B");
    expect(lines.join("\n")).not.toContain("AQEFAASCBKcwggSjAgEAAoIBAQDx");
  });

  it("masks the longest match first", () => {
    const n = secretNeedles(["secretvalue", "secretvalue-and-more"]);
    expect(maskSecrets("x secretvalue-and-more y", n)).toBe("x *** y");
  });
});
