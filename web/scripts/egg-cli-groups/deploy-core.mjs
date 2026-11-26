// CLI group "deploy-core". Orchard source files: deploy, deploy_releases, rollout, overview.
// Each export is consumed by web/scripts/egg-cli.mjs. Owned by one child at a time.
// commands: registry entries { name, args, options?, required?, description, runner }.
// runners: async (nest, args, flags, out, deps, fail, kit) => void. Use kit for printData, table, clean, dash, json, redactSecrets, UsageError, Failure.
// optionTypes: { "option-name": "flag" | "value" } for options this group adds.
export const commands = [
  {
    name: "deploy delete",
    args: ["deployment-id"],
    required: ["confirm-name"],
    options: ["confirm-name"],
    description: "Delete a deployment after confirming its exact project slug.",
    runner: "deployDelete",
  },
  {
    name: "deploy pods",
    args: ["deployment-id"],
    options: ["live"],
    description: "List the current project containers for a deployment.",
    runner: "deployPods",
  },
  {
    name: "deploy metrics",
    args: ["deployment-id"],
    description: "Show CPU, memory, and restart measurements for a deployment.",
    runner: "deployMetrics",
  },
  {
    name: "deploy releases",
    args: ["deployment-id"],
    options: ["limit"],
    description: "List recent releases for a deployment's project.",
    runner: "deployReleases",
  },
];

const positiveInteger = (value, option, fallback, UsageError) => {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new UsageError(`--${option} needs a positive integer.`);
  }
  return parsed;
};

const releaseCollection = (data) => {
  if (Array.isArray(data)) return { key: null, entries: data };
  if (!data || typeof data !== "object") return { key: null, entries: [] };
  if (Array.isArray(data.releases)) return { key: "releases", entries: data.releases };
  const entry = Object.entries(data).find(([, value]) => Array.isArray(value));
  return entry ? { key: entry[0], entries: entry[1] } : { key: null, entries: [] };
};

export const runners = {
  async deployDelete(nest, [deploymentId], flags, out, deps, _fail, kit) {
    const { deployment } = await nest.getDeployment(deploymentId);
    const confirmationName = deployment.projectSlug;
    if (flags.confirmName !== confirmationName) {
      throw new kit.UsageError(`Pass --confirm-name with the deployment's exact project slug: ${confirmationName}`);
    }

    const data = await nest.deleteDeployment(deploymentId);
    if (data?.deleted === false) throw new kit.Failure(`Could not delete deployment ${deploymentId}.`);
    return kit.printData(data, flags, deps, out, () => `Deleted deployment ${kit.clean(deploymentId)}.\n`);
  },

  async deployPods(nest, [deploymentId], _flags, out, deps, _fail, kit) {
    const { deployment } = await nest.getDeployment(deploymentId);
    const data = await nest.listProjectContainers(deployment.projectId);
    return kit.printData(data, _flags, deps, out, (visible) => {
      const containers = visible.containers ?? [];
      if (containers.length === 0) return `No project containers for deployment ${kit.clean(deploymentId)}.\n`;
      return kit.table(
        ["CONTAINER", "NAME", "SERVICE", "STATE", "RESTARTS", "STARTED"],
        containers.map((container) => [
          kit.clean(container.id),
          kit.clean(container.name),
          kit.clean(container.service),
          kit.clean(container.state),
          kit.clean(container.restartCount),
          kit.dash(kit.clean(container.startedAt)),
        ])
      );
    });
  },

  async deployMetrics(nest, [deploymentId], flags, out, deps, _fail, kit) {
    const data = await nest.getDeploymentMetrics(deploymentId);
    return kit.printData(data, flags, deps, out, (visible) => {
      const samples = visible.samples ?? [];
      if (samples.length === 0) return `No metrics for deployment ${kit.clean(deploymentId)}.\n`;
      return kit.table(
        ["TIME", "CPU %", "MEMORY MB", "RESTARTS"],
        samples.map((sample) => [
          kit.clean(sample.at),
          kit.dash(kit.clean(sample.cpuPercent)),
          kit.dash(kit.clean(sample.memoryMb)),
          kit.clean(sample.restarts),
        ])
      );
    });
  },

  async deployReleases(nest, [deploymentId], flags, out, deps, _fail, kit) {
    const limit = positiveInteger(flags.limit, "limit", 20, kit.UsageError);
    const { deployment } = await nest.getDeployment(deploymentId);
    const data = await nest.listReleases(deployment.projectId);
    const { key, entries } = releaseCollection(data);
    const limitedEntries = entries.slice(0, limit);
    const limitedData = key === null ? limitedEntries : { ...data, [key]: limitedEntries };

    return kit.printData(limitedData, flags, deps, out, (visible) => {
      const visibleEntries = releaseCollection(visible).entries;
      if (visibleEntries.length === 0) return `No releases for deployment ${kit.clean(deploymentId)}.\n`;
      const columns = ["id", "deploymentId", "state", "createdAt"].filter((field) =>
        visibleEntries.some((entry) => entry[field] !== undefined)
      );
      if (columns.length === 0) return kit.json(visible);
      return kit.table(
        columns.map((field) => field.toUpperCase()),
        visibleEntries.map((entry) => columns.map((field) => kit.dash(kit.clean(entry[field]))))
      );
    });
  },
};

export const optionTypes = {
  "confirm-name": "value",
  live: "flag",
};
