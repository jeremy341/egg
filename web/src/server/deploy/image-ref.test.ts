import { describe, expect, it } from "vitest";
import { parseImageRef, registryHostError, registryHostOf } from "@/server/deploy/image-ref";

const DIGEST = "sha256:" + "a".repeat(64);

function ok(raw: string) {
  const r = parseImageRef(raw);
  if (!r.ok) throw new Error(`expected ${raw} to parse: ${r.reason}`);
  return r.ref;
}

describe("image reference format", () => {
  it("puts a bare name on Docker Hub under library, with no tag it is movable", () => {
    expect(ok("nginx")).toEqual({ host: "docker.io", repository: "library/nginx", tag: null, digest: null, movableTag: true });
  });

  it("reads a host, a repository and a tag", () => {
    expect(ok("ghcr.io/owner/app:1.2.0")).toEqual({ host: "ghcr.io", repository: "owner/app", tag: "1.2.0", digest: null, movableTag: false });
  });

  it("treats the tag latest as movable", () => {
    expect(ok("nginx:latest").movableTag).toBe(true);
  });

  it("accepts a digest, which never moves", () => {
    expect(ok(`ghcr.io/owner/app@${DIGEST}`)).toMatchObject({ digest: DIGEST, movableTag: false });
  });

  it("accepts a tag and a digest together", () => {
    expect(ok(`registry.example.com:5000/team/web:v3@${DIGEST}`)).toMatchObject({ host: "registry.example.com:5000", tag: "v3", repository: "team/web" });
  });

  it("accepts localhost and an IPv4 host with a port", () => {
    expect(ok("localhost:5000/app:dev").host).toBe("localhost:5000");
    expect(ok("10.0.0.5:5000/app").host).toBe("10.0.0.5:5000");
  });

  it("refuses an empty reference, spaces and a scheme", () => {
    expect(parseImageRef("  ").ok).toBe(false);
    expect(parseImageRef("nginx 1.27").ok).toBe(false);
    expect(parseImageRef("https://ghcr.io/owner/app").ok).toBe(false);
  });

  it("refuses an uppercase repository name", () => {
    expect(parseImageRef("ghcr.io/Owner/app").ok).toBe(false);
  });

  it("refuses a tag that starts with a dash or is too long", () => {
    expect(parseImageRef("nginx:-bad").ok).toBe(false);
    expect(parseImageRef(`nginx:${"a".repeat(129)}`).ok).toBe(false);
  });

  it("refuses a digest that is not sha256 with 64 hex characters", () => {
    expect(parseImageRef("nginx@sha256:abc").ok).toBe(false);
    expect(parseImageRef(`nginx@md5:${"a".repeat(32)}`).ok).toBe(false);
  });

  it("refuses a reference longer than 255 characters", () => {
    expect(parseImageRef(`a/${"b".repeat(260)}`).ok).toBe(false);
  });

  it("gives the registry host for a reference, and throws on a bad one", () => {
    expect(registryHostOf("ghcr.io/owner/app:1")).toBe("ghcr.io");
    expect(registryHostOf("nginx")).toBe("docker.io");
    expect(() => registryHostOf("")).toThrow();
  });
});

describe("registry host", () => {
  it("accepts a domain, localhost, an IPv4 address, and a port", () => {
    for (const host of ["ghcr.io", "registry.example.com:5000", "localhost", "192.168.1.10:5000"]) {
      expect(registryHostError(host)).toBeNull();
    }
  });

  it("refuses a scheme, a path, an empty host and a bad port", () => {
    expect(registryHostError("https://ghcr.io")).not.toBeNull();
    expect(registryHostError("ghcr.io/owner")).not.toBeNull();
    expect(registryHostError("")).not.toBeNull();
    expect(registryHostError("ghcr.io:99999")).not.toBeNull();
    expect(registryHostError("999.1.1.1")).not.toBeNull();
  });
});
