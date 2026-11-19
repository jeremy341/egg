import { describe, expect, it, vi } from "vitest";
import { checkDockerCapabilities, deployDockerRelease, validateComposeSpec } from "./docker-target";

const capabilities = { engine: true, compose: true, nesting: true, cgroupLimits: true, disk: true, portMapping: true };

describe("Docker target foundation", () => {
  it("rejects unknown target capabilities before preparing a release", async () => {
    const target = { preflight: vi.fn().mockResolvedValue({ ...capabilities, nesting: null }), prepare: vi.fn(), check: vi.fn(), activate: vi.fn(), discard: vi.fn() };
    await expect(deployDockerRelease(target, { kind: "dockerfile", releaseId: "r1" })).rejects.toThrow(/nesting/i);
    expect(target.prepare).not.toHaveBeenCalled();
  });
  it("requires Compose support only for Compose workloads", () => {
    expect(checkDockerCapabilities({ ...capabilities, compose: false }, "dockerfile")).toEqual([]);
    expect(checkDockerCapabilities({ ...capabilities, compose: false }, "compose")).toContain("Compose is unavailable or unverified");
  });
  it("keeps the live release untouched when candidate health fails", async () => {
    const target = { preflight: vi.fn().mockResolvedValue(capabilities), prepare: vi.fn().mockResolvedValue(undefined), check: vi.fn().mockResolvedValue(false), activate: vi.fn(), discard: vi.fn().mockResolvedValue(undefined) };
    await expect(deployDockerRelease(target, { kind: "dockerfile", releaseId: "r1" })).rejects.toThrow(/health/i);
    expect(target.activate).not.toHaveBeenCalled();
    expect(target.discard).toHaveBeenCalledWith("r1");
  });
  it("rejects unsafe Compose services and release-local data mounts", () => {
    expect(validateComposeSpec({ services: { web: { privileged: true, volumes: ["./data:/data"], ports: ["0.0.0.0:80:80"] } } })).toEqual(expect.arrayContaining([expect.stringMatching(/privileged/), expect.stringMatching(/volume/), expect.stringMatching(/port/)]));
  });
  it("accepts explicitly selected loopback ports and declared persistent volumes", () => {
    expect(validateComposeSpec({ services: { web: { ports: ["127.0.0.1:8080:80"], volumes: ["data:/data"] }, db: {} }, volumes: { data: {} } })).toEqual([]);
  });
});

it("does not discard a candidate when activation has an ambiguous outcome", async () => {
  const target = { preflight: vi.fn().mockResolvedValue(capabilities), prepare: vi.fn().mockResolvedValue(undefined), check: vi.fn().mockResolvedValue(true), activate: vi.fn().mockRejectedValue(new Error("connection lost")), discard: vi.fn() };
  await expect(deployDockerRelease(target, { kind: "dockerfile", releaseId: "r1" })).rejects.toThrow("connection lost");
  expect(target.discard).not.toHaveBeenCalled();
});

it("rejects unrecognized Compose features and interpolation", () => {
  expect(validateComposeSpec({ services: { web: { image: "${IMAGE}", network_mode: "host" } }, include: ["other.yml"] })).toHaveLength(3);
});
