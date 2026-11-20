/** Docker target contracts only. This module does not access a Docker daemon. */
export type DockerMode = "dockerfile" | "compose";
export type Capability = boolean | null;
export interface DockerCapabilities {
  engine: Capability;
  compose: Capability;
  nesting: Capability;
  cgroupLimits: Capability;
  disk: Capability;
  portMapping: Capability;
}
export interface DockerRelease { kind: DockerMode; releaseId: string }

/** Implementations execute on the target, never through a control-plane socket.
 * prepare and check must leave the active release and its data untouched.
 * activate must atomically route traffic to the healthy candidate, or restore the
 * previous route before reporting failure. An ambiguous failure requires reconciliation.
 * discard removes only candidate resources and must never remove persistent data.
 */
export interface DockerTarget {
  preflight(release: DockerRelease): Promise<DockerCapabilities>;
  prepare(release: DockerRelease): Promise<void>;
  check(release: DockerRelease): Promise<boolean>;
  activate(release: DockerRelease): Promise<void>;
  discard(releaseId: string): Promise<void>;
}

export function checkDockerCapabilities(c: DockerCapabilities, mode: DockerMode): string[] {
  const required: [keyof DockerCapabilities, string][] = [
    ["engine", "Docker engine"], ["nesting", "Nesting"], ["cgroupLimits", "Cgroup limits"],
    ["disk", "Disk capacity"], ["portMapping", "Port mapping"],
  ];
  if (mode === "compose") required.push(["compose", "Compose"]);
  return required.filter(([key]) => c[key] !== true).map(([, label]) => `${label} is unavailable or unverified`);
}

export async function deployDockerRelease(target: DockerTarget, release: DockerRelease): Promise<void> {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(release.releaseId)) throw new Error("Invalid release id");
  const errors = checkDockerCapabilities(await target.preflight(release), release.kind);
  if (errors.length) throw new Error(errors.join("; "));
  try {
    await target.prepare(release);
    if (!(await target.check(release))) throw new Error("Candidate health check failed");
  } catch (error) {
    try { await target.discard(release.releaseId); } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], "Candidate failed and cleanup failed");
    }
    throw error;
  }
  // Do not discard after an activation error: its outcome may be unknown.
  await target.activate(release);
}

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const name = /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/;

export type ComposeMount = { volume: string; target: string; readOnly: boolean };

/**
 * The one parse of a Compose volume entry, shared by validation and rendering,
 * so a mount can never validate as one thing and deploy as another. Short
 * syntax only: a volume by name at an absolute container path, with an
 * optional :ro. Anything else — extra segments, syntactic binds, `.` parts —
 * is invalid.
 */
export function parseComposeMount(mount: unknown): ComposeMount | null {
  if (typeof mount === "string") {
    const parts = mount.split(":");
    if (parts.length < 2 || parts.length > 3) return null;
    const [volume, target, mode] = parts.length === 3 ? parts : [...parts, ""];
    if (mode !== undefined && mode !== "" && mode !== "ro") return null;
    if (!name.test(volume)) return null;
    const clean = target.endsWith("/") ? target.slice(0, -1) : target;
    if (!clean.startsWith("/")) return null;
    if (clean.slice(1).split("/").some((part) => !/^[a-zA-Z0-9_.-]+$/.test(part) || part === "." || part === "..")) return null;
    return { volume, target, readOnly: mode === "ro" };
  }
  // `docker compose config` also emits the long syntax; accept only a named
  // volume mount so a bind or tmpfs can never ride along hidden inside it.
  if (record(mount)) {
    if (mount.type !== "volume" || typeof mount.source !== "string" || !name.test(mount.source)) return null;
    if (mount.bind !== undefined || mount.tmpfs !== undefined) return null;
    if (mount.read_only !== undefined && typeof mount.read_only !== "boolean") return null;
    const sub = mount.volume;
    if (sub !== undefined && !record(sub)) return null;
    if (record(sub)) for (const key of Object.keys(sub)) if (key !== "nocopy") return null;
    const clean = typeof mount.target === "string" && mount.target.endsWith("/") ? mount.target.slice(0, -1) : typeof mount.target === "string" ? mount.target : "";
    if (!clean.startsWith("/")) return null;
    if (clean.slice(1).split("/").some((part) => !/^[a-zA-Z0-9_.-]+$/.test(part) || part === "." || part === "..")) return null;
    return { volume: mount.source, target: typeof mount.target === "string" ? mount.target : "", readOnly: mount.read_only === true };
  }
  return null;
}

/** Validate a deliberately narrow, already-parsed Compose subset before any deploy.
 * Callers must not execute the original YAML: use a canonical representation of
 * this validated subset and prohibit interpolation, includes and extensions.
 */
export function validateComposeSpec(input: unknown): string[] {
  const errors: string[] = [];
  if (!record(input) || !record(input.services) || Object.keys(input.services).length === 0) return ["Compose requires services"];
  for (const key of Object.keys(input)) if (!["services", "volumes"].includes(key)) errors.push(`Unsupported Compose field: ${key}`);
  const volumes = input.volumes === undefined ? {} : input.volumes;
  if (!record(volumes)) return [...errors, "Invalid volumes"];
  for (const [key, value] of Object.entries(volumes)) {
    if (!name.test(key) || !record(value) || Object.keys(value).length) errors.push(`Invalid volume: ${key}`);
  }
  for (const [service, value] of Object.entries(input.services)) {
    if (!name.test(service) || !record(value)) { errors.push(`Invalid service: ${service}`); continue; }
    for (const key of Object.keys(value)) if (!["image", "ports", "volumes"].includes(key)) errors.push(`Unsupported ${service} field: ${key}`);
    if (value.image !== undefined && (typeof value.image !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9._/:@-]*$/.test(value.image))) errors.push(`Invalid image: ${service}`);
    if (value.ports !== undefined) {
      if (!Array.isArray(value.ports)) errors.push(`Invalid port list: ${service}`);
      else for (const port of value.ports) {
        const match = typeof port === "string" && /^127\.0\.0\.1:(\d{1,5}):(\d{1,5})$/.exec(port);
        if (!match || [match[1], match[2]].some(n => Number(n) < 1 || Number(n) > 65535)) errors.push(`Invalid port: ${service}`);
      }
    }
    if (value.volumes !== undefined) {
      if (!Array.isArray(value.volumes)) errors.push(`Invalid volume list: ${service}`);
      else for (const mount of value.volumes) {
        const parsed = parseComposeMount(mount);
        if (!parsed || !Object.hasOwn(volumes, parsed.volume)) errors.push(`Invalid volume mount: ${service}`);
      }
    }
  }
  return errors;
}

const COMPOSE_SERVICE = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/;

/**
 * Validate the canonical, resolved Compose form that `docker compose config`
 * emitted on the target. The original file is never executed; what runs is this
 * resolved output, so validating it bounds exactly what a deploy may do.
 *
 * The supported subset: services with prebuilt images, loopback-only host
 * ports, no build steps, no privileged options, and named volumes declared at
 * the top level. The main service gets its port from Egg and publishes nothing
 * itself; aux services stay private to the project's Compose network except
 * for their loopback ports.
 */
export function validateResolvedCompose(
  input: unknown,
  main: { service: string; containerPort: number | null; project: string }
): { errors: string[]; aux: string[] } {
  const errors: string[] = [];
  if (!record(input) || !record(input.services) || Object.keys(input.services).length === 0) {
    return { errors: ["Compose requires services"], aux: [] };
  }
  for (const key of Object.keys(input)) if (!["services", "volumes", "networks", "name"].includes(key)) errors.push(`Unsupported Compose field: ${key}`);
  const volumes = record(input.volumes ?? {}) ? (input.volumes as Record<string, unknown>) : {};
  const declared = new Set(Object.keys(volumes));
  if (input.volumes !== undefined && !record(input.volumes)) errors.push("Invalid volumes");
  for (const [name, value] of Object.entries(volumes)) {
    if (!COMPOSE_SERVICE.test(name) || !record(value) || value.external === true) { errors.push(`Invalid volume: ${name}`); continue; }
    // Config resolves a declared volume's physical name to `<project>_<key>`. A
    // name pointing anywhere else would let an aux service mount another
    // project's data volume, so a foreign name is refused outright.
    if (typeof value.name === "string" && value.name !== `${main.project}_${name}`) {
      errors.push(`Invalid volume: ${name}`);
    }
    for (const field of Object.keys(value)) {
      if (field !== "name" && field !== "driver") errors.push(`Invalid volume: ${name}`);
      if (field === "driver" && value.driver !== "local") errors.push(`Invalid volume: ${name}`);
    }
  }
  const services = Object.keys(input.services).filter((s) => COMPOSE_SERVICE.test(s));
  if (!services.includes(main.service)) errors.push(`The service ${main.service} is not defined`);
  const aux: string[] = [];
  for (const [service, value] of Object.entries(input.services)) {
    if (!COMPOSE_SERVICE.test(service) || !record(value)) { errors.push(`Invalid service: ${service}`); continue; }
    if (value.build !== undefined && value.build !== null) errors.push(`Service ${service} builds an image. Compose services must use prebuilt images.`);
    if (typeof value.image !== "string" || value.image.length === 0) errors.push(`Service ${service} needs an image`);
    for (const forbidden of ["privileged", "cap_add", "devices", "network_mode", "pid", "ipc", "userns_mode", "security_opt", "extends", "profiles", "volumes_from"] as const) {
      if (value[forbidden] !== undefined && value[forbidden] !== null && value[forbidden] !== false) errors.push(`Service ${service} uses ${forbidden}, which Egg does not support`);
    }
    const restart = typeof value.restart === "string" ? value.restart : "";
    if (service === main.service && restart && restart !== "no") errors.push(`Service ${service} sets its own restart policy; Egg manages the main service`);
    if (service !== main.service) aux.push(service);
    const ports = value.ports;
    if (ports !== undefined && ports !== null) {
      if (!Array.isArray(ports)) errors.push(`Invalid port list: ${service}`);
      else for (const entry of ports) {
        const target = typeof entry === "string" ? entry : record(entry) ? `${entry.host_ip ?? ""}:${entry.published}:${entry.target}` : "";
        if (service === main.service) {
          if (ports.length > 0) errors.push(`Service ${service} must not publish ports; Egg maps the project's listen port to it`);
        } else if (!/^127\.0\.0\.1:(\d{1,5}):(\d{1,5})$/.test(target) || [target.split(":")[1], target.split(":")[2]].some((n) => Number(n) < 1 || Number(n) > 65535)) {
          errors.push(`Service ${service} must bind its host ports to 127.0.0.1 only`);
        }
      }
    }
    if (Array.isArray(value.volumes)) {
      for (const mount of value.volumes) {
        const parsed = parseComposeMount(mount);
        if (!parsed || /[\/\.]/.test(parsed.volume) || !declared.has(parsed.volume)) {
          errors.push(`Service ${service} mounts ${typeof mount === "string" ? mount : "a volume"} outside the declared named volumes`);
        }
      }
    } else if (value.volumes !== undefined && value.volumes !== null) {
      errors.push(`Invalid volume list: ${service}`);
    }
    if (value.environment !== undefined && value.environment !== null && !record(value.environment)) errors.push(`Invalid environment: ${service}`);
  }
  return { errors, aux };
}

/**
 * The `docker create` volume flags for the main Compose service. Compose itself
 * prefixes named volumes with the project, so the mount uses the same real
 * name the aux services would see.
 */
export function composeMainVolumes(input: unknown, mainService: string, project: string): string[] {
  if (!record(input) || !record(input.services) || !record((input.services as Record<string, unknown>)[mainService])) return [];
  const service = (input.services as Record<string, unknown>)[mainService] as Record<string, unknown>;
  if (!Array.isArray(service.volumes)) return [];
  return service.volumes
    .map((mount) => {
      // The same parse the Compose subset was validated with, so what runs is
      // exactly what was allowed. An unparseable mount never reaches docker.
      const parsed = parseComposeMount(mount);
      if (!parsed) throw new Error("Invalid volume mount");
      return `${project}_${parsed.volume}:${parsed.target}${parsed.readOnly ? ":ro" : ""}`;
    });
}
