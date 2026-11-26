import { RUNTIMES } from "@/server/db/schema";
import type { NestSession } from "@/server/ssh/connection";

/**
 * Runs only on the SSH target. Docker info reads the target's local daemon; it
 * never contacts an environment-selected remote daemon or Egg's Docker socket.
 * Beyond the flags, the probe also reads what the daemon itself says: its
 * cgroup version, where it stores images, and the free space there. Port
 * publishing is covered by checking the userland proxy binary the daemon
 * installs for `-p 127.0.0.1:` mappings.
 */
export const TARGET_CAPABILITIES_SCRIPT = `
set +e
if docker --host unix:///var/run/docker.sock info >/dev/null 2>&1; then echo engine=1; else echo engine=0; fi
if docker compose version >/dev/null 2>&1; then echo compose=1; else echo compose=0; fi
if systemctl show --property=Version --value >/dev/null 2>&1 && command -v tar >/dev/null 2>&1; then echo native=1; else echo native=0; fi
if command -v node >/dev/null 2>&1; then echo node=1; else echo node=0; fi
if command -v python3 >/dev/null 2>&1; then echo python=1; else echo python=0; fi
echo "cgroup=$(docker info --format '{{.CgroupVersion}}' 2>/dev/null || true)"
echo "root=$(docker info --format '{{.DockerRootDir}}' 2>/dev/null || true)"
root=$(docker info --format '{{.DockerRootDir}}' 2>/dev/null || echo /var/lib/docker)
echo "free=$(df -Pm "$root" 2>/dev/null | awk 'NR==2 {print $4}')"
if command -v docker-proxy >/dev/null 2>&1 || [ -e /usr/libexec/docker/docker-proxy ] || [ -e /usr/lib/docker/docker-proxy ] || [ -e /usr/local/libexec/docker/docker-proxy ] || [ -e /usr/bin/docker-proxy ]; then echo proxy=1; else echo proxy=0; fi
`;

/** The smallest free space at Docker's storage root that still allows image builds, in MB. */
export const DOCKER_DISK_FLOOR_MB = 1024;

export type TargetCapabilities = {
  deploymentModes: { native: boolean; dockerfile: boolean; compose: boolean; image: boolean };
  docker: { available: boolean; composeAvailable: boolean; reason: string | null };
  runtimes: string[];
};

export async function probeTargetCapabilities(session: Pick<NestSession, "script">): Promise<TargetCapabilities> {
  const result = await session.script(TARGET_CAPABILITIES_SCRIPT, { timeoutMs: 20_000, maxOutputBytes: 4096 });
  const flags = new Map<string, string>();
  let malformed = result.code !== 0;
  for (const line of result.stdout.trim().split(/\r?\n/)) {
    const match = /^(engine|compose|native|node|python|cgroup|root|free|proxy)=(.*)$/.exec(line);
    if (!match || flags.has(match[1])) malformed = true;
    else flags.set(match[1], match[2]);
  }
  if (["engine", "compose", "native", "node", "python", "cgroup", "root", "free", "proxy"].some((key) => !flags.has(key))) malformed = true;
  const yes = (key: string) => !malformed && flags.get(key) === "1";
  const native = yes("native");
  const engine = yes("engine");
  // Only what the daemon itself reports decides the container modes: cgroup v2
  // for the limits, the storage root's free space, and the port proxy binary.
  const cgroupLimits = engine && flags.get("cgroup") === "2";
  const freeMb = Number(flags.get("free"));
  const disk = engine && Number.isInteger(freeMb) && freeMb >= DOCKER_DISK_FLOOR_MB;
  const portMapping = engine && yes("proxy");
  const composeCli = yes("compose");
  const dockerfile = engine && cgroupLimits && disk && portMapping;
  const compose = dockerfile && composeCli;
  const problems: string[] = [];
  if (malformed) {
    problems.push("Target capability probe returned an incomplete or invalid response.");
  } else if (!engine) {
    problems.push("Docker engine is unavailable or inaccessible on the target.");
  } else {
    if (!cgroupLimits) problems.push(`the daemon reports cgroup version ${JSON.stringify(flags.get("cgroup") || "unknown")}, and container modes need cgroup v2`);
    if (!disk) problems.push(Number.isInteger(freeMb) && freeMb > 0 ? `${freeMb} MB is free at Docker's storage root, and image builds need at least ${DOCKER_DISK_FLOOR_MB} MB` : `the free space at Docker's storage root (${flags.get("root") || "unknown"}) could not be read`);
    if (!portMapping) problems.push("the daemon's port proxy (docker-proxy) could not be found, so loopback port publishing is unverified");
    if (!composeCli) problems.push("the Docker Compose CLI is not installed");
  }
  let reason: string | null = null;
  if (dockerfile) {
    reason = compose ? null : "The Docker engine is usable, but the Docker Compose CLI is not installed, so Compose stacks stay unavailable.";
  } else {
    reason = problems.length > 0 ? problems.join("; ") : "Docker deployment is not verified on this target.";
  }
  return {
    // An image app pulls with the same Docker engine, so it is available wherever Docker is.
    deploymentModes: { native, dockerfile, compose, image: dockerfile },
    docker: { available: dockerfile, composeAvailable: compose, reason },
    runtimes: [...RUNTIMES],
  };
}
