// CLI group "pods-console". Orchard source files: pod, console, up, ui, open, top.
// Each export is consumed by web/scripts/egg-cli.mjs. Owned by one child at a time.
// commands: registry entries { name, args, options?, required?, description, runner }.
// runners: async (nest, args, flags, out, deps, fail, kit) => void. Use kit for printData, table, clean, dash, json, redactSecrets, UsageError, Failure.
// optionTypes: { "option-name": "flag" | "value" } for options this group adds.
export const commands = [
  {
    name: "pod list",
    args: [],
    options: ["namespace"],
    description: "List project-scoped containers; Egg does not support Kubernetes namespace selection.",
    runner: "podList",
  },
  {
    name: "pod get",
    args: ["name"],
    options: ["namespace"],
    description: "Show safe details for a uniquely named project container.",
    runner: "podGet",
  },
  {
    name: "top",
    args: ["id"],
    options: ["db", "once"],
    description: "Show a one-shot project health snapshot with --once; live and database monitoring are unavailable.",
    runner: "top",
  },
];

function rejectNamespace(flags, kit) {
  if (flags.namespace !== undefined) {
    throw new kit.UsageError("Egg exposes project-scoped containers, not Kubernetes namespaces; --namespace is unsupported.");
  }
}

async function projectList(nest) {
  const { projects } = await nest.listProjects();
  return projects;
}

async function projectFor(nest, slugOrId, kit) {
  const projects = await projectList(nest);
  const project = projects.find((entry) => entry.slug === slugOrId) ?? projects.find((entry) => entry.id === slugOrId);
  if (!project) throw new kit.Failure(`No project with the slug or id "${kit.clean(slugOrId)}".`);
  return project;
}

export const runners = {
  async podList(nest, _args, flags, out, deps, _fail, kit) {
    rejectNamespace(flags, kit);
    const projects = await projectList(nest);
    const containers = [];
    for (const project of projects) {
      const result = await nest.listProjectContainers(project.id);
      for (const container of result.containers) {
        containers.push({ project: project.slug, ...container });
      }
    }
    const data = { containers };
    return kit.printData(data, flags, deps, out, (visible) => visible.containers.length === 0
      ? "No project containers.\n"
      : kit.table(
        ["PROJECT", "CONTAINER", "SERVICE", "STATE", "RESTARTS", "STARTED"],
        visible.containers.map((container) => [
          kit.clean(container.project),
          kit.clean(container.name),
          kit.clean(container.service),
          kit.clean(container.state),
          container.restartCount,
          kit.dash(container.startedAt),
        ])
      ));
  },

  async podGet(nest, [name], flags, out, deps, _fail, kit) {
    rejectNamespace(flags, kit);
    const projects = await projectList(nest);
    const matches = [];
    for (const project of projects) {
      const result = await nest.listProjectContainers(project.id);
      for (const container of result.containers) {
        if (container.name === name || container.id === name) matches.push({ project, container });
      }
    }
    if (matches.length === 0) throw new kit.Failure(`No project container named "${kit.clean(name)}" was found.`);
    if (matches.length > 1) {
      const ids = matches.map(({ project, container }) => `${project.slug ?? project.id}/${container.id}`).join(", ");
      throw new kit.UsageError(`Container name "${kit.clean(name)}" is ambiguous; use a full container id (${kit.clean(ids)}).`);
    }
    const [{ project, container: summary }] = matches;
    const result = await nest.getProjectContainer(project.id, summary.id);
    const data = { projectId: project.id, projectSlug: project.slug, container: result.container };
    return kit.printData(data, flags, deps, out, (visible) => kit.table(
      ["FIELD", "VALUE"],
      [
        ["PROJECT", kit.clean(visible.projectSlug)],
        ["NAME", kit.clean(visible.container.name)],
        ["ID", kit.clean(visible.container.id)],
        ["SERVICE", kit.clean(visible.container.service)],
        ["STATE", kit.clean(visible.container.state)],
        ["IMAGE", kit.clean(visible.container.image)],
        ["STARTED", kit.dash(visible.container.startedAt)],
        ["RESTARTS", visible.container.restartCount],
        ["CREATED", kit.dash(visible.container.createdAt)],
      ]
    ));
  },

  async top(nest, [slugOrId], flags, out, deps, _fail, kit) {
    if (flags.db) throw new kit.UsageError("Egg project health does not provide database activity metrics.");
    if (!flags.once) throw new kit.UsageError("Egg cannot keep a live pod monitor open; pass --once for a project health snapshot.");
    const project = await projectFor(nest, slugOrId, kit);
    const data = await nest.getProjectHealth(project.id);
    return kit.printData(data, flags, deps, out, (visible) => {
      const status = visible.status;
      return kit.table(
        ["FIELD", "VALUE"],
        [
          ["PROJECT", kit.clean(project.slug ?? project.id)],
          ["STATE", kit.clean(status.state)],
          ["DETAIL", kit.dash(kit.clean(status.detail))],
          ["PID", kit.dash(status.pid)],
          ["UPTIME_SECONDS", kit.dash(status.uptimeSeconds)],
          ["MEMORY_MB", kit.dash(status.memoryMb)],
          ["CPU_NS", kit.dash(status.cpuNs)],
          ["RESTARTS", kit.dash(status.restarts)],
          ["HTTP_CODE", kit.dash(status.http?.code)],
          ["HTTP_MS", kit.dash(status.http?.ms)],
          ["CHECKED_AT", kit.clean(status.checkedAt)],
          ["CACHED", String(visible.cached)],
        ]
      );
    });
  },
};

export const optionTypes = {
  namespace: "value",
  db: "flag",
  once: "flag",
};
