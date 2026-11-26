import { afterEach, describe, expect, it, vi } from "vitest";
import {
  accessProtectionConfigSchema,
  hashAccessPassword,
  isExcludedAccessPath,
  verifyAccessPassword,
  issueAccessSession,
  verifyAccessSession,
} from "@/server/access-protection";

describe("access protection configuration", () => {
  it("accepts each supported mode and defaults excluded paths", () => {
    for (const mode of ["off", "egg"] as const) {
      expect(accessProtectionConfigSchema.parse({ mode })).toEqual({ mode, excludedPaths: [] });
    }
    expect(accessProtectionConfigSchema.parse({ mode: "password", passwordHash: "hash" }).mode).toBe("password");
    expect(accessProtectionConfigSchema.parse({ mode: "basic-auth", username: "deploy", passwordHash: "hash" }).mode).toBe("basic-auth");
  });

  it("rejects missing mode credentials, unknown fields, and invalid exclusions", () => {
    expect(accessProtectionConfigSchema.safeParse({ mode: "password" }).success).toBe(false);
    expect(accessProtectionConfigSchema.safeParse({ mode: "basic-auth", username: "", passwordHash: "hash" }).success).toBe(false);
    expect(accessProtectionConfigSchema.safeParse({ mode: "off", extra: true }).success).toBe(false);
    expect(accessProtectionConfigSchema.safeParse({ mode: "egg", excludedPaths: ["hooks"] }).success).toBe(false);
  });

  it("matches exact and subtree exclusions without matching sibling prefixes", () => {
    const exclusions = ["/health", "/api/webhooks/**"];
    expect(isExcludedAccessPath("/health", exclusions)).toBe(true);
    expect(isExcludedAccessPath("/health?ready=1", exclusions)).toBe(true);
    expect(isExcludedAccessPath("/api/webhooks/github/receive", exclusions)).toBe(true);
    expect(isExcludedAccessPath("/api/webhooks", exclusions)).toBe(true);
    expect(isExcludedAccessPath("/api/webhooks-extra", exclusions)).toBe(false);
    expect(isExcludedAccessPath("/healthz", exclusions)).toBe(false);
  });

  it("hashes passwords and verifies only the matching password", async () => {
    const encoded = await hashAccessPassword("a-long-enough-project-password");
    expect(encoded).not.toContain("a-long-enough-project-password");
    expect(await verifyAccessPassword("a-long-enough-project-password", encoded)).toBe(true);
    expect(await verifyAccessPassword("wrong-password", encoded)).toBe(false);
    await expect(hashAccessPassword("short")).rejects.toThrow();
  });
});

describe("signed access sessions", () => {
  it("verifies an unexpired session for its project and rejects tampering, wrong project, and expiry", () => {
    vi.stubEnv("APP_SECRET", "test-secret-with-at-least-thirty-two-characters");
    const token = issueAccessSession("project-1", "owner-1", 1_800_000_000_000);
    expect(verifyAccessSession(token, "project-1", 1_800_000_001_000)).toMatchObject({ projectId: "project-1", userId: "owner-1" });
    expect(verifyAccessSession(token, "project-2", 1_800_000_001_000)).toBeNull();
    expect(verifyAccessSession(`${token}x`, "project-1", 1_800_000_001_000)).toBeNull();
    expect(verifyAccessSession(token, "project-1", 1_801_000_000_000)).toBeNull();
  });
});

afterEach(() => vi.unstubAllEnvs());
