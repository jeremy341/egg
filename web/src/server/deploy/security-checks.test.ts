import { describe, expect, it } from "vitest";
import { findSecurityChecks } from "@/server/deploy/security-checks";

const sourceProject = { deploymentMode: "native" as const, imageRef: null };

describe("project security checks", () => {
  it("flags literal secret environment values without including their contents", () => {
    const findings = findSecurityChecks({
      project: sourceProject,
      env: [{ key: "PAYMENT_API_KEY", value: "sk_live_do_not_return" }],
      domains: [],
    });

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ id: "plaintext-secret", resource: "PAYMENT_API_KEY" });
    expect(JSON.stringify(findings)).not.toContain("sk_live_do_not_return");
  });

  it("flags custom domains explicitly configured with HTTP", () => {
    const findings = findSecurityChecks({
      project: sourceProject,
      env: [],
      domains: [{ domain: "http://app.example.com" }],
    });

    expect(findings.map((finding) => finding.id)).toEqual(["http-domain"]);
  });

  it("flags movable image tags but accepts versioned tags and digests", () => {
    const movable = findSecurityChecks({
      project: { deploymentMode: "image", imageRef: "ghcr.io/example/app:latest" },
      env: [],
      domains: [],
    });
    const pinned = findSecurityChecks({
      project: { deploymentMode: "image", imageRef: `ghcr.io/example/app@sha256:${"a".repeat(64)}` },
      env: [],
      domains: [],
    });

    expect(movable.map((finding) => finding.id)).toEqual(["movable-image-tag"]);
    expect(pinned).toEqual([]);
  });

  it("returns no findings for clean configuration", () => {
    expect(findSecurityChecks({
      project: { deploymentMode: "image", imageRef: "ghcr.io/example/app:1.4.2" },
      env: [
        { key: "NODE_ENV", value: "production" },
        { key: "PAYMENT_API_KEY", value: "${PAYMENT_API_KEY}" },
      ],
      domains: [{ domain: "https://app.example.com" }, { domain: "app.example.net" }],
    })).toEqual([]);
  });
});
