import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { authorizeFetch, getProvider, normalizePush, validateCloneUrl, verifiedPush, verifyWebhook } from "./index";

const payload = JSON.stringify({ ref: "refs/heads/main", after: "a".repeat(40), repository: { full_name: "org/repo" }, project: { path_with_namespace: "org/repo" } });
const signature = createHmac("sha256", "secret").update(payload).digest("hex");

describe("provider adapters", () => {
  it("restricts generic Git to manual and deploy hook workflows", () => {
    expect(getProvider("git").capabilities).toEqual({ manualDeploy: true, deployHook: true, webhook: false, repositoryDiscovery: false, pullRequests: false, commitChecks: false });
    expect(getProvider("codeberg").defaultHost).toBe("codeberg.org");
    expect(getProvider("gitlab").capabilities.repositoryDiscovery).toBe(false);
  });

  it("validates clone destinations and rejects unsafe URL forms", () => {
    expect(validateCloneUrl("git", "https://example.com/team/repo.git")).toBe("https://example.com/team/repo.git");
    expect(validateCloneUrl("forgejo", "git@forge.example.com:org/repo.git")).toBe("ssh://git@forge.example.com/org/repo.git");
    for (const url of ["https://user:secret@example.com/repo", "file:///etc/passwd", "https://127.0.0.1/repo", "https://localhost/repo", "https://example.com/repo?token=secret", "https://github.com.evil.test/a/b", "https://example.com/a/../b"]) {
      expect(() => validateCloneUrl(url.includes("github.com.evil") ? "github" : "git", url)).toThrow();
    }
    expect(() => validateCloneUrl("codeberg", "https://forge.example.com/a/b")).toThrow();
  });

  it("requires explicit authorization for private fetches and does not expose secrets", async () => {
    expect(await authorizeFetch({ visibility: "public" }, async () => false)).toEqual({ kind: "public" });
    await expect(authorizeFetch({ visibility: "private", credentialId: "cred-1" }, async () => false)).rejects.toThrow();
    expect(await authorizeFetch({ visibility: "private", credentialId: "cred-1" }, async (id) => id === "cred-1")).toEqual({ kind: "credential", credentialId: "cred-1" });
  });

  it("verifies provider-specific webhook secrets against the original bytes", () => {
    expect(verifyWebhook("github", payload, { "x-hub-signature-256": `sha256=${signature}` }, "secret")).toBe(true);
    expect(verifyWebhook("forgejo", payload, { "x-forgejo-signature": signature }, "secret")).toBe(true);
    expect(verifyWebhook("codeberg", payload, { "x-gitea-signature": signature }, "secret")).toBe(true);
    expect(verifyWebhook("gitlab", payload, { "x-gitlab-token": "secret" }, "secret")).toBe(true);
    expect(verifyWebhook("gitlab", payload, { "x-gitlab-token": signature }, "secret")).toBe(false);
    expect(verifyWebhook("github", payload + " ", { "x-hub-signature-256": `sha256=${signature}` }, "secret")).toBe(false);
    expect(verifyWebhook("github", payload, { "x-hub-signature-256": `sha256=${signature}` }, "")).toBe(false);
    expect(verifyWebhook("git", payload, {}, "secret")).toBe(false);
    expect(verifiedPush("github", { "x-github-event": "push", "x-github-delivery": "d", "x-hub-signature-256": "sha256=bad" }, payload, "secret")).toBeNull();
  });

  it("normalizes verified push payloads and ignores branch deletion and other events", () => {
    const headers = { "x-github-event": "push", "x-github-delivery": "delivery-1" };
    expect(normalizePush("github", headers, payload)).toEqual({ deliveryId: "delivery-1", repository: "org/repo", branch: "main", commit: "a".repeat(40) });
    expect(normalizePush("gitlab", { "x-gitlab-event": "Push Hook", "x-gitlab-event-uuid": "gl-1" }, payload)?.branch).toBe("main");
    expect(normalizePush("forgejo", { "x-forgejo-event": "push", "x-forgejo-delivery": "f-1" }, payload)?.repository).toBe("org/repo");
    expect(normalizePush("github", { ...headers, "x-github-event": "pull_request" }, payload)).toBeNull();
    expect(normalizePush("github", headers, payload.replace("a".repeat(40), "0".repeat(40)))).toBeNull();
    expect(normalizePush("github", headers, "not json")).toBeNull();
    expect(normalizePush("github", { "x-github-event": "push" }, payload)).toBeNull();
  });
});


