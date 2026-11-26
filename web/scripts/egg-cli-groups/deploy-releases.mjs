// CLI group "deploy-releases". Orchard source files: deploy_release.
// Each export is consumed by web/scripts/egg-cli.mjs. Owned by one child at a time.
// commands: registry entries { name, args, options?, required?, description, runner }.
// runners: async (nest, args, flags, out, deps, fail, kit) => void. Use kit for printData, table, clean, dash, json, redactSecrets, UsageError, Failure.
// optionTypes: { "option-name": "flag" | "value" } for options this group adds.
export const commands = [
  {
    name: "deploy rollback-to",
    args: ["id"],
    required: ["confirm-deployment-id"],
    options: ["confirm-deployment-id", "wait", "timeout"],
    description: "Point production at a deployment after confirming its exact id.",
    runner: "deployRollbackTo",
  },
  {
    name: "deploy image set",
    args: ["id", "image"],
    options: ["wait", "timeout"],
    description: "Set the image used by an image-based deployment.",
    runner: "deployImageSet",
  },
  {
    name: "deploy history",
    args: ["id"],
    description: "Show a deployment's image history.",
    runner: "deployHistory",
  },
  {
    name: "deploy auto-deploy status",
    args: ["id"],
    description: "Show a project's automatic deploy settings.",
    runner: "deployAutoDeployStatus",
  },
  {
    name: "deploy auto-deploy disable",
    args: ["id"],
    description: "Disable automatic deploys for a project.",
    runner: "deployAutoDeployDisable",
  },
];

export const runners = {
  async deployRollbackTo(nest, [id], flags, out, deps, _fail, kit) {
    if (flags.confirmDeploymentId !== id) {
      throw new kit.UsageError(`--confirm-deployment-id must exactly match ${id}.`);
    }
    const result = await nest.rollback(id);
    const deployment = await waitForDeployment(nest, result.deployment, flags, deps, kit);
    return kit.printData({ deployment }, flags, deps, out, (visible) => flags.wait
      ? `Rollback ${visible.deployment.id} completed in state ${visible.deployment.state}.\n`
      : `Queued a rollback to ${id} as deployment ${visible.deployment.id}.\n`);
  },

  async deployImageSet(nest, [id, image], flags, out, deps, _fail, kit) {
    const result = await nest.updateDeploymentImage(id, { image });
    if (flags.wait) {
      const deployment = await waitForDeployment(nest, result.deployment, flags, deps, kit);
      return kit.printData({ deployment }, flags, deps, out, (visible) =>
        `Image update for ${visible.deployment.id} completed in state ${visible.deployment.state}.\n`);
    }
    return kit.printData(result, flags, deps, out, (visible) =>
      `Updated image for deployment ${visible.deployment.id}.\n`);
  },

  async deployHistory(nest, [id], flags, out, deps, _fail, kit) {
    const { deployment } = await nest.getDeployment(id);
    const data = await nest.getImageHistory(deployment.projectId);
    return kit.printData(data, flags, deps, out, (visible) => {
      const entries = Array.isArray(visible)
        ? visible
        : visible.history ?? visible.entries ?? visible.imageHistory;
      if (!Array.isArray(entries)) return `Image history for deployment ${id}:\n${kit.json(visible)}`;
      if (entries.length === 0) return `No image history for deployment ${id}.\n`;
      return kit.table(["ID", "IMAGE", "CREATED"], entries.map((entry) => [
        kit.dash(entry.id),
        kit.dash(entry.image),
        kit.dash(entry.createdAt),
      ]));
    });
  },

  async deployAutoDeployStatus(nest, [id], flags, out, deps, _fail, kit) {
    const data = await nest.getAutoDeployStatus(id);
    return kit.printData(data, flags, deps, out, (visible) => {
      const settings = visible && typeof visible === "object" ? visible : { status: visible };
      const rows = Object.entries(settings).map(([key, value]) => [
        key,
        value && typeof value === "object" ? kit.json(value).trim() : kit.dash(value),
      ]);
      return kit.table(["SETTING", "VALUE"], rows);
    });
  },

  async deployAutoDeployDisable(nest, [id], flags, out, deps, _fail, kit) {
    const data = await nest.disableAutoDeploy(id);
    return kit.printData(data, flags, deps, out, () => `Disabled automatic deploys for project ${id}.\n`);
  },
};

export const optionTypes = { "confirm-deployment-id": "value" };

function parseDuration(value) {
  const match = /^(\d+)(ms|s|m|h)?$/.exec(String(value));
  if (!match) return null;
  const amount = Number(match[1]);
  const multiplier = { ms: 1, s: 1000, m: 60_000, h: 3_600_000 }[match[2] ?? "ms"];
  const duration = amount * multiplier;
  return Number.isSafeInteger(amount) && amount > 0 && Number.isSafeInteger(duration) ? duration : null;
}

async function waitForDeployment(nest, deployment, flags, deps, kit) {
  if (!flags.wait) return deployment;
  const timeoutMs = parseDuration(flags.timeout ?? "10m");
  if (timeoutMs === null) throw new kit.UsageError("--timeout needs a positive duration such as 30s or 5m.");
  const deadline = deps.now() + timeoutMs;
  while (!["ready", "error", "canceled"].includes(deployment.state)) {
    if (deps.now() >= deadline) throw new kit.TimeoutFailure(`Timed out waiting for deployment ${deployment.id}.`);
    deployment = (await nest.getDeployment(deployment.id)).deployment;
    if (["ready", "error", "canceled"].includes(deployment.state)) break;
    const remaining = deadline - deps.now();
    if (remaining <= 0) throw new kit.TimeoutFailure(`Timed out waiting for deployment ${deployment.id}.`);
    await deps.sleep(Math.min(deps.pollMs ?? 2_000, remaining));
  }
  if (deployment.state !== "ready") {
    throw new kit.Failure(`Deployment ${deployment.id} finished with state ${deployment.state}.`);
  }
  return deployment;
}
