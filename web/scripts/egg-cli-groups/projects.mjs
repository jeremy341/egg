// CLI group "projects". Orchard source files: project.
// Each export is consumed by web/scripts/egg-cli.mjs. Owned by one child at a time.
// commands: registry entries { name, args, options?, required?, description, runner }.
// runners: async (nest, args, flags, out, deps, fail, kit) => void. Use kit for printData, table, clean, dash, json, redactSecrets, UsageError, Failure.
// optionTypes: { "option-name": "flag" | "value" } for options this group adds.
export const commands = [
  {
    name: "projects purge",
    args: ["project"],
    required: ["confirm"],
    options: ["confirm"],
    description: "Delete a project and its server resources after confirming its exact name.",
    runner: "projectsPurge",
  },
];

export const runners = {
  async projectsPurge(nest, [slug], flags, out, deps, fail, kit) {
    const { projects } = await nest.listProjects();
    const project = projects.find((candidate) => candidate.slug === slug) ?? projects.find((candidate) => candidate.id === slug);
    if (!project) throw new kit.Failure(`No project with the slug or id "${slug}".`);
    if (flags.confirm !== project.name) throw new kit.UsageError(`Pass --confirm with the exact project name: ${project.name}`);

    const data = await nest.deleteProject(project.id, { removeFromServer: true });
    return kit.printData(data, flags, deps, out, () => `Deleted project ${project.slug} and its server resources.\n`);
  },
};

export const optionTypes = {};
