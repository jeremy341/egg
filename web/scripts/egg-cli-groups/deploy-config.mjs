// CLI group "deploy-config". Commands are limited to the SDK methods Egg exposes.
// commands: registry entries { name, args, options?, required?, description, runner }.
// runners: async (nest, args, flags, out, deps, fail, kit) => void.
import { readFileSync } from "node:fs";

export const commands = [
  { name: "deploy env get", args: ["id"], description: "Show deployment environment variable names and readable values.", runner: "deployEnvGet" },
  {
    name: "deploy env set",
    args: ["id", "assignment"],
    options: ["file", "secret"],
    description: "Set one deployment environment variable, optionally loading more from a dotenv file.",
    runner: "deployEnvSet",
  },
  {
    name: "deploy env unset",
    args: ["id", "key"],
    required: ["confirm-key"],
    options: ["confirm-key"],
    description: "Remove one deployment environment variable after confirming its exact key.",
    runner: "deployEnvUnset",
  },
  {
    name: "deploy resources set",
    args: ["id"],
    options: ["cpu", "memory"],
    description: "Update the supplied deployment CPU or memory request.",
    runner: "deployResourcesSet",
  },
  { name: "deploy volumes get", args: ["id"], description: "Show attached volume mount configuration.", runner: "deployVolumesGet" },
  {
    name: "deploy volumes set",
    args: ["id"],
    required: ["confirm-deployment"],
    options: ["volume", "confirm-deployment"],
    description: "Replace the deployment volume list after confirming its exact project name.",
    runner: "deployVolumesSet",
  },
  {
    name: "deploy strategy set",
    args: ["id"],
    required: ["type"],
    options: ["type"],
    description: "Choose rolling, recreate, or blue-green deployment updates.",
    runner: "deployStrategySet",
  },
  {
    name: "deploy pull-policy set",
    args: ["id"],
    required: ["policy"],
    options: ["policy"],
    description: "Set when deployment images are pulled for pod starts.",
    runner: "deployPullPolicySet",
  },
  {
    name: "deploy health-check set",
    args: ["id"],
    options: ["path"],
    description: "Set the supported deployment health-check path.",
    runner: "deployHealthCheckSet",
  },
  {
    name: "deploy build-root set",
    args: ["id", "mode"],
    options: ["depot", "persistent-cache"],
    description: "Set the deployment build-root mode and optional accelerators.",
    runner: "deployBuildRootSet",
  },
  {
    name: "deploy build-config set",
    args: ["id"],
    options: ["start-cmd", "root", "install-cmd", "build-cmd", "output-dir"],
    description: "Update supported deployment build and start settings.",
    runner: "deployBuildConfigSet",
  },
];

export const optionTypes = {
  file: "value",
  secret: "flag",
  "confirm-key": "value",
  cpu: "value",
  memory: "value",
  volume: "value",
  "confirm-deployment": "value",
  type: "value",
  policy: "value",
  path: "value",
  depot: "flag",
  "persistent-cache": "flag",
  "start-cmd": "value",
  root: "value",
  "install-cmd": "value",
  "build-cmd": "value",
};

function parseAssignment(input, source = "assignment") {
  const equals = input.indexOf("=");
  if (equals <= 0) throw new Error(`${source} must use KEY=VALUE.`);
  const key = input.slice(0, equals).trim();
  if (!key) throw new Error(`${source} must include a key before =.`);
  return { key, value: input.slice(equals + 1) };
}

function parseDotenv(text) {
  const result = [];
  for (const [index, raw] of text.split(/\r?\n/).entries()) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const assignment = line.startsWith("export ") ? line.slice(7).trimStart() : line;
    const parsed = parseAssignment(assignment, `file line ${index + 1}`);
    let value = parsed.value.trim();
    if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    result.push({ ...parsed, value });
  }
  return result;
}

function safeFailure(error, values, kit) {
  let message = error instanceof Error ? error.message : String(error);
  for (const value of values) {
    if (value) message = message.split(value).join("[hidden]");
  }
  return new kit.Failure(message);
}

function memoryBytes(value) {
  const match = /^(\d+(?:\.\d+)?)(B|K|KB|Ki|KiB|M|MB|Mi|MiB|G|GB|Gi|GiB|T|TB|Ti|TiB)?$/i.exec(value.trim());
  if (!match) throw new Error("--memory needs a byte value or size such as 512Mi or 1Gi.");
  const unit = (match[2] ?? "B").toLowerCase();
  const powers = {
    b: 1,
    k: 1_000,
    kb: 1_000,
    ki: 1024,
    kib: 1024,
    m: 1_000_000,
    mb: 1_000_000,
    mi: 1024 ** 2,
    mib: 1024 ** 2,
    g: 1_000_000_000,
    gb: 1_000_000_000,
    gi: 1024 ** 3,
    gib: 1024 ** 3,
    t: 1_000_000_000_000,
    tb: 1_000_000_000_000,
    ti: 1024 ** 4,
    tib: 1024 ** 4,
  };
  const bytes = Number(match[1]) * powers[unit];
  if (!Number.isSafeInteger(bytes)) throw new Error("--memory must resolve to a whole number of bytes.");
  return bytes;
}

function printSummary(data, flags, out, deps, kit, text) {
  return kit.printData(data, flags, deps, out, text);
}

export const runners = {
  async deployEnvGet(nest, [id], flags, out, deps, _fail, kit) {
    const data = await nest.getEnvVars(id);
    const safe = {
      env: (data.env ?? []).map(({ key, target, secret, value }) => ({
        key,
        target,
        value: secret ? "[secret]" : value ?? "",
      })),
    };
    return printSummary(safe, flags, out, deps, kit, (visible) => visible.env.length === 0
      ? "No environment variables.\n"
      : kit.table(["KEY", "TARGET", "VALUE"], visible.env.map((entry) => [entry.key, entry.target, entry.value])));
  },

  async deployEnvSet(nest, [id, assignment], flags, out, deps, _fail, kit) {
    let assignments;
    try {
      assignments = [parseAssignment(assignment)];
      if (flags.file !== undefined) assignments.push(...parseDotenv(readFileSync(flags.file, "utf8")));
    } catch (error) {
      throw new kit.UsageError(error instanceof Error ? error.message : String(error));
    }
    if (assignments.length === 0) throw new kit.UsageError("Provide a KEY=VALUE assignment or a dotenv file.");

    try {
      for (const { key, value } of assignments) {
        await nest.setEnvVar(id, key, { value });
        if (flags.secret) await nest.setEnvVarSecret(id, key, "all", { secret: true });
      }
    } catch (error) {
      throw safeFailure(error, assignments.map(({ value }) => value), kit);
    }

    return printSummary({ updated: assignments.map(({ key }) => key) }, flags, out, deps, kit,
      (visible) => `Updated environment variables: ${visible.updated.join(", ")}.\n`);
  },

  async deployEnvUnset(nest, [id, key], flags, out, deps, _fail, kit) {
    if (flags.confirmKey !== key) throw new kit.UsageError(`Pass --confirm-key with the exact key name: ${key}`);
    await nest.deleteEnvVar(id, key);
    return printSummary({ deleted: [key] }, flags, out, deps, kit,
      (visible) => `Removed environment variable ${visible.deleted[0]}.\n`);
  },

  async deployResourcesSet(nest, [id], flags, out, deps, _fail, kit) {
    if (flags.cpu === undefined && flags.memory === undefined) {
      throw new kit.UsageError("deploy resources set needs --cpu, --memory, or both.");
    }
    const changes = {};
    if (flags.cpu !== undefined) {
      const cpu = Number(flags.cpu);
      if (!Number.isSafeInteger(cpu) || cpu < 0) throw new kit.UsageError("--cpu needs a non-negative integer number of millicores.");
      changes.cpu = cpu;
    }
    if (flags.memory !== undefined) {
      try {
        changes.memory = memoryBytes(flags.memory);
      } catch (error) {
        throw new kit.UsageError(error instanceof Error ? error.message : String(error));
      }
    }
    const data = await nest.updateDeploymentResources(id, changes);
    return printSummary(data, flags, out, deps, kit, () => `Updated resources for deployment ${id}.\n`);
  },

  async deployVolumesGet(nest, [id], flags, out, deps, _fail, kit) {
    const data = await nest.getDeploymentVolumes(id);
    return printSummary(data, flags, out, deps, kit, (visible) => {
      const volumes = Array.isArray(visible) ? visible : visible.volumes ?? visible.deploymentVolumes ?? [];
      if (volumes.length === 0) return "No deployment volumes.\n";
      return kit.table(
        ["MOUNT PATH", "TYPE", "SIZE", "READ ONLY"],
        volumes.map((volume) => [
          volume.mountPath ?? volume.path ?? "",
          volume.type ?? volume.volumeType ?? "",
          volume.size ?? "",
          volume.readOnly ? "yes" : "no",
        ]),
      );
    });
  },

  async deployVolumesSet(nest, [id], flags, out, deps, _fail, kit) {
    const { deployment } = await nest.getDeployment(id);
    const { project } = await nest.getProject(deployment.projectId);
    if (flags.confirmDeployment !== project.name) {
      throw new kit.UsageError(`Pass --confirm-deployment with the exact deployment name: ${project.name}`);
    }
    const volumes = [];
    if (flags.volume !== undefined) {
      const equals = flags.volume.indexOf("=");
      if (equals <= 0 || equals === flags.volume.length - 1) {
        throw new kit.UsageError("--volume must use mount-path=size.");
      }
      volumes.push({ mountPath: flags.volume.slice(0, equals), size: flags.volume.slice(equals + 1) });
    }
    const data = await nest.updateDeploymentVolumes(id, { volumes });
    return printSummary(data, flags, out, deps, kit, () => `Updated volumes for deployment ${id}.\n`);
  },

  async deployStrategySet(nest, [id], flags, out, deps, _fail, kit) {
    if (!["rolling", "recreate", "blue-green"].includes(flags.type)) {
      throw new kit.UsageError("--type must be rolling, recreate, or blue-green.");
    }
    const data = await nest.updateDeploymentStrategy(id, { type: flags.type });
    return printSummary(data, flags, out, deps, kit, () => `Updated strategy for deployment ${id}.\n`);
  },

  async deployPullPolicySet(nest, [id], flags, out, deps, _fail, kit) {
    if (!["auto", "always", "if-not-present"].includes(flags.policy)) {
      throw new kit.UsageError("--policy must be auto, always, or if-not-present.");
    }
    const data = await nest.updateDeploymentPullPolicy(id, { policy: flags.policy });
    return printSummary(data, flags, out, deps, kit, () => `Updated pull policy for deployment ${id}.\n`);
  },

  async deployHealthCheckSet(nest, [id], flags, out, deps, _fail, kit) {
    if (flags.path === undefined) throw new kit.UsageError("Egg currently supports only --path for deployment health checks.");
    const data = await nest.updateDeploymentHealthCheck(id, { path: flags.path });
    return printSummary(data, flags, out, deps, kit, () => `Updated health-check path for deployment ${id}.\n`);
  },

  async deployBuildRootSet(nest, [id, mode], flags, out, deps, _fail, kit) {
    if (mode !== "on" && mode !== "off") throw new kit.UsageError("mode must be on or off.");
    const changes = { mode };
    if (flags.depot) changes.depot = true;
    if (flags.persistentCache) changes.persistentCache = true;
    const data = await nest.updateDeploymentBuildConfig(id, changes);
    return printSummary(data, flags, out, deps, kit, () => `Updated build-root settings for deployment ${id}.\n`);
  },

  async deployBuildConfigSet(nest, [id], flags, out, deps, _fail, kit) {
    const mapping = {
      startCmd: "startCommand",
      root: "rootDir",
      installCmd: "installCommand",
      buildCmd: "buildCommand",
      outputDir: "outputDir",
    };
    const changes = Object.fromEntries(
      Object.entries(mapping)
        .filter(([option]) => flags[option] !== undefined)
        .map(([option, field]) => [field, flags[option]]),
    );
    if (Object.keys(changes).length === 0) {
      throw new kit.UsageError("deploy build-config set needs at least one supported build option.");
    }
    const data = await nest.updateDeploymentBuildConfig(id, changes);
    return printSummary(data, flags, out, deps, kit, () => `Updated build configuration for deployment ${id}.\n`);
  },
};
