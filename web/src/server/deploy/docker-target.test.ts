import { describe, expect, it, vi } from "vitest";
import { checkDockerCapabilities, composeMainVolumes, deployDockerRelease, parseComposeMount, validateComposeSpec, validateResolvedCompose } from "./docker-target";

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

describe("Compose volume mounts", () => {
  it("parses a declared volume at an absolute path, with an optional :ro", () => {
    expect(parseComposeMount("data:/var/lib/app")).toEqual({ volume: "data", target: "/var/lib/app", readOnly: false });
    expect(parseComposeMount("data:/var/lib/app:ro")).toEqual({ volume: "data", target: "/var/lib/app", readOnly: true });
    expect(parseComposeMount("data:/var/lib/app/")).toEqual({ volume: "data", target: "/var/lib/app/", readOnly: false });
  });
  it("refuses every other shape", () => {
    expect(parseComposeMount("data:/app:/junk")).toBeNull();
    expect(parseComposeMount("data:/app:ro:rw")).toBeNull();
    expect(parseComposeMount("./data:/app")).toBeNull();
    expect(parseComposeMount("data:app")).toBeNull();
    expect(parseComposeMount("data:/")).toBeNull();
    expect(parseComposeMount("data:/../etc")).toBeNull();
    expect(parseComposeMount("data:/app//deep")).toBeNull();
    expect(parseComposeMount({ long: "syntax" })).toBeNull();
    expect(parseComposeMount("data")).toBeNull();
  });
  it("validates an unrenderable mount instead of deploying it as something else", () => {
    const input = (volumes: unknown[]) => ({ services: { web: { image: "img", volumes } }, volumes: { data: {} } });
    expect(validateResolvedCompose(input(["data:/app:/junk"]), { service: "web", containerPort: null, project: "egg-demo" }).errors)
      .toEqual([expect.stringMatching(/declared named volumes/)]);
    expect(validateComposeSpec(input(["data:/app:/junk"]))).toEqual([expect.stringMatching(/volume mount/)]);
  });
  it("renders exactly what was validated", () => {
    const resolved = { services: { web: { image: "img", volumes: ["data:/app:ro", "data:/storage"] } }, volumes: { data: {} } };
    expect(validateResolvedCompose(resolved, { service: "web", containerPort: null, project: "egg-demo" }).errors).toEqual([]);
    expect(composeMainVolumes(resolved, "web", "egg-demo")).toEqual(["egg-demo_data:/app:ro", "egg-demo_data:/storage"]);
  });
  it("never renders a mount the shared parse refused", () => {
    expect(() => composeMainVolumes({ services: { web: { image: "img", volumes: ["data:/app:/junk"] } } }, "web", "egg-demo"))
      .toThrow(/Invalid volume mount/);
  });
});

describe("resolved Compose volumes", () => {
  const opts = { service: "web", containerPort: null, project: "egg-demo" };
  // Exactly what `docker compose -p egg-demo config --format json` emits for
  // a plain declared volume and its mounts.
  const resolved = (volumes: unknown, mounts: unknown[]) => ({
    services: { web: { image: "img", volumes: mounts } },
    volumes,
  });

  it("accepts the real long-syntax mounts and Egg-derived volume names", () => {
    const input = resolved({ data: { name: "egg-demo_data" } }, [{ type: "volume", source: "data", target: "/app", volume: {} }]);
    expect(validateResolvedCompose(input, opts).errors).toEqual([]);
    expect(composeMainVolumes(input, "web", "egg-demo")).toEqual(["egg-demo_data:/app"]);
  });

  it("refuses a declared volume pointing at another project's data", () => {
    expect(validateResolvedCompose(resolved({ data: { name: "egg-victim_data" } }, []), opts).errors)
      .toEqual([expect.stringMatching(/Invalid volume/)]);
  });

  it("refuses hand-written volume fields like driver_opts and labels", () => {
    expect(validateResolvedCompose(resolved({ data: { name: "egg-demo_data", driver_opts: { type: "none", device: "/", o: "bind" } } }, []), opts).errors)
      .toEqual([expect.stringMatching(/Invalid volume/)]);
    expect(validateResolvedCompose(resolved({ data: { name: "egg-demo_data", driver: "localfs" } }, []), opts).errors)
      .toEqual([expect.stringMatching(/Invalid volume/)]);
  });

  it("still tolerates a volume whose resolved name was omitted", () => {
    expect(validateResolvedCompose(resolved({ data: {} }, []), opts).errors).toEqual([]);
  });

  it("refuses volumes_from and bind-style long mounts", () => {
    const withFrom = { services: { web: { image: "img", volumes_from: ["db"] }, db: { image: "img" } }, volumes: {} };
    expect(validateResolvedCompose(withFrom, opts).errors).toEqual([expect.stringMatching(/volumes_from/)]);
    const bind = resolved({ data: { name: "egg-demo_data" } }, [{ type: "bind", source: "/etc", target: "/etc" }]);
    expect(validateResolvedCompose(bind, opts).errors)
      .toEqual([expect.stringMatching(/declared named volumes/)]);
  });
});
