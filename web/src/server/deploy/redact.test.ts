import { describe, expect, it } from "vitest";
import { maskSecrets, secretNeedles } from "@/server/deploy/redact";

describe("secret masking", () => {
  it("masks a value and ignores very short ones", () => {
    const n = secretNeedles(["hunter2-long", "abc"]);
    expect(maskSecrets("token=hunter2-long abc", n)).toBe("token=*** abc");
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
