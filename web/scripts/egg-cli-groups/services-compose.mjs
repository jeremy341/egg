// CLI group "services-compose". Orchard source files: service, compose.
// Each export is consumed by web/scripts/egg-cli.mjs. Owned by one child at a time.
// commands: registry entries { name, args, options?, required?, description, runner }.
// runners: async (nest, args, flags, out, deps, fail, kit) => void. Use kit for printData, table, clean, dash, json, redactSecrets, UsageError, Failure.
// optionTypes: { "option-name": "flag" | "value" } for options this group adds.
export const commands = [
  { name: "compose list", args: [], description: "List Compose stacks in the selected project.", runner: "composeList" },
  { name: "compose show", args: ["stack-id"], description: "Show a Compose stack and its managed deployments.", runner: "composeShow" },
  { name: "compose redeploy", args: ["stack-id"], description: "Redeploy a Compose stack from its current source.", runner: "composeRedeploy" },
  {
    name: "compose delete",
    args: ["stack-id"],
    required: ["confirm"],
    options: ["confirm"],
    description: "Delete a Compose stack and its managed deployments after confirming its exact name.",
    runner: "composeDelete",
  },
];

export const runners = {
  async composeList(nest, _args, flags, out, deps, _fail, kit) {
    const data = await nest.listComposeStacks();
    return kit.printData(data, flags, deps, out, (visible) => {
      const stacks = Array.isArray(visible) ? visible : Array.isArray(visible.stacks) ? visible.stacks : [];
      if (stacks.length === 0) return "No Compose stacks yet.\n";
      return kit.table(
        ["ID", "NAME"],
        stacks.map((stack) => [kit.clean(stack.id ?? stack.projectId), kit.clean(stack.name ?? stack.slug)])
      );
    });
  },

  async composeShow(nest, [stackId], flags, out, deps, _fail, kit) {
    const data = await nest.getComposeStack(stackId);
    return kit.printData(data, flags, deps, out, (visible) => kit.clean(kit.json(visible.stack ?? visible.composeStack ?? visible)));
  },

  async composeRedeploy(nest, [stackId], flags, out, deps, _fail, kit) {
    const data = await nest.redeployComposeStack(stackId);
    return kit.printData(data, flags, deps, out, (visible) => {
      const deploymentId = visible.deployment?.id;
      return deploymentId
        ? `Queued deployment ${kit.clean(deploymentId)} for Compose stack ${kit.clean(stackId)}.\n`
        : `Queued a redeploy for Compose stack ${kit.clean(stackId)}.\n`;
    });
  },

  async composeDelete(nest, [stackId], flags, out, deps, _fail, kit) {
    const result = await nest.getComposeStack(stackId);
    const stack = result.stack ?? result.composeStack ?? result;
    const name = stack.name;
    if (typeof name !== "string" || name.length === 0) {
      throw new kit.Failure(`Compose stack ${kit.clean(stackId)} did not include a name for confirmation.`);
    }
    if (flags.confirm !== name) {
      throw new kit.UsageError(`Pass --confirm with the exact stack name: ${kit.clean(name)}`);
    }

    const data = await nest.deleteProject(stackId, { removeFromServer: true });
    return kit.printData(data, flags, deps, out, () => `Deleted Compose stack ${kit.clean(name)} and its deployments.\n`);
  },
};

export const optionTypes = {};
