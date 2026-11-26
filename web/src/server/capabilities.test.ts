import { describe, expect, it, vi } from "vitest";
import { RUNTIMES } from "@/server/db/schema";
import { probeTargetCapabilities } from "./capabilities";

function session(stdout: string, code = 0) {
  return { script: vi.fn().mockResolvedValue({ stdout, code, stderr: "" }) };
}

const fullOk = "engine=1\ncompose=1\nnative=1\nnode=1\npython=1\ncgroup=2\nroot=/var/lib/docker\nfree=8192\nproxy=1\n";
const noDocker = "engine=0\ncompose=0\nnative=1\nnode=1\npython=1\ncgroup=\nroot=\nfree=\nproxy=0\n";

describe("target capabilities", () => {
  it("enables the container modes when Docker answers with cgroup v2, disk space and the port proxy", async () => {
    const result = await probeTargetCapabilities(session(fullOk) as never);
    expect(result.deploymentModes).toEqual({ native: true, dockerfile: true, compose: true, image: true });
    expect(result.docker.available).toBe(true);
    expect(result.docker.composeAvailable).toBe(true);
    expect(result.docker.reason).toBeNull();
    expect(result.runtimes).toEqual([...RUNTIMES]);
  });

  it("enables Dockerfile but not Compose when the Compose CLI is missing", async () => {
    const target = session(fullOk.replace("compose=1", "compose=0"));
    const result = await probeTargetCapabilities(target as never);
    expect(result.deploymentModes.dockerfile).toBe(true);
    expect(result.deploymentModes.compose).toBe(false);
    expect(result.docker.reason).toMatch(/Compose CLI is not installed/i);
  });

  it("keeps the container modes off with the honest reason when the engine cannot run them", async () => {
    const variants = [
      { stdout: fullOk.replace("cgroup=2", "cgroup=1"), hint: "cgroup" },
      { stdout: fullOk.replace("free=8192", "free=512"), hint: "free" },
      { stdout: fullOk.replace("proxy=1", "proxy=0"), hint: "port proxy" },
      { stdout: noDocker, hint: "engine" },
    ];
    for (const variant of variants) {
      const result = await probeTargetCapabilities(session(variant.stdout) as never);
      expect(result.deploymentModes.dockerfile).toBe(false);
      expect(result.deploymentModes.compose).toBe(false);
      expect(result.docker.available).toBe(false);
      expect(result.docker.reason).toMatch(new RegExp(variant.hint, "i"));
    }
  });

  it("distinguishes an unreachable daemon from an unverified target", async () => {
    const result = await probeTargetCapabilities(session(noDocker) as never);
    expect(result.docker.reason).toMatch(/engine.*unavailable/i);
    expect(result.deploymentModes.native).toBe(true);
    expect(result.runtimes).toEqual([...RUNTIMES]);
  });

  it("fails closed on a nonzero or malformed probe result", async () => {
    for (const fake of [session(fullOk, 1), session("noise\n")]) {
      const result = await probeTargetCapabilities(fake as never);
      expect(result.deploymentModes).toEqual({ native: false, dockerfile: false, compose: false, image: false });
      expect(result.docker.available).toBe(false);
    }
  });
});
