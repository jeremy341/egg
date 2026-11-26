// CLI group "github-git". Orchard source files: github, git, link.
// Each export is consumed by web/scripts/egg-cli.mjs. Owned by one child at a time.
// commands: registry entries { name, args, options?, required?, description, runner }.
// runners: async (nest, args, flags, out, deps, fail, kit) => void. Use kit for printData, table, clean, dash, json, redactSecrets, UsageError, Failure.
// optionTypes: { "option-name": "flag" | "value" } for options this group adds.
export const commands = [
  {
    name: "github repos",
    args: [],
    description: "List repositories available as deployment sources.",
    runner: "githubRepos",
  },
  {
    name: "github contents",
    args: ["owner/repo", "path"],
    options: ["branch"],
    description: "List files and directories at a repository path.",
    runner: "githubContents",
  },
  {
    name: "github dockerfile-info",
    args: ["owner/repo", "dockerfile-path"],
    options: ["branch"],
    description: "Summarize build metadata from a repository Dockerfile.",
    runner: "githubDockerfileInfo",
  },
];

function dockerfileText(value) {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = dockerfileText(item);
      if (found !== null) return found;
    }
    return null;
  }

  for (const [key, child] of Object.entries(value)) {
    if (["content", "text", "dockerfile"].includes(key.toLowerCase()) && typeof child === "string") return child;
  }
  for (const child of Object.values(value)) {
    if (child && typeof child === "object") {
      const found = dockerfileText(child);
      if (found !== null) return found;
    }
  }
  return null;
}

function dockerfileMetadata(text, repo, path, branch) {
  const lines = text.replace(/\\\r?\n[ \t]*/g, " ").split(/\r?\n/);
  const instructions = lines
    .map((line) => /^\s*([a-z]+)\s+(.+?)\s*$/i.exec(line))
    .filter(Boolean)
    .map((match) => ({ name: match[1].toUpperCase(), value: match[2] }));
  const names = (instruction) => {
    const value = instruction.value.trim();
    if (instruction.name === "ENV" && !value.includes("=")) return [value.split(/\s+/, 1)[0]];
    return value.split(/\s+/).map((item) => item.split("=", 1)[0]).filter(Boolean);
  };

  return {
    repo,
    path,
    branch: branch ?? null,
    stages: instructions.filter(({ name }) => name === "FROM").length,
    workingDirectories: instructions.filter(({ name }) => name === "WORKDIR").map(({ value }) => value),
    exposedPorts: instructions
      .filter(({ name }) => name === "EXPOSE")
      .flatMap(({ value }) => value.split(/\s+/).map((port) => port.split("/", 1)[0])),
    buildArgs: instructions.filter(({ name }) => name === "ARG").flatMap(names),
    environmentNames: instructions.filter(({ name }) => name === "ENV").flatMap(names),
    runSteps: instructions.filter(({ name }) => name === "RUN").length,
    hasEntrypoint: instructions.some(({ name }) => name === "ENTRYPOINT"),
    hasCommand: instructions.some(({ name }) => name === "CMD"),
  };
}

export const runners = {
  async githubRepos(nest, _args, flags, out, deps, _fail, kit) {
    const data = await nest.listGithubRepos();
    return kit.printData(data, flags, deps, out, kit.json);
  },

  async githubContents(nest, [repo, path], flags, out, deps, _fail, kit) {
    const data = await nest.getRepoContents({ repo, path, branch: flags.branch });
    return kit.printData(data, flags, deps, out, kit.json);
  },

  async githubDockerfileInfo(nest, [repo, path], flags, out, deps, _fail, kit) {
    const response = await nest.getRepoContents({ repo, path, branch: flags.branch });
    const content = dockerfileText(response);
    if (content === null) throw new kit.Failure("The GitHub contents response did not include Dockerfile text.");

    const data = dockerfileMetadata(content, repo, path, flags.branch);
    return kit.printData(data, flags, deps, out, (visible) => [
      `Repository ${kit.clean(visible.repo)}`,
      `Dockerfile ${kit.clean(visible.path)}`,
      `Branch ${kit.dash(visible.branch)}`,
      `Stages ${visible.stages}`,
      `Working directories ${visible.workingDirectories.join(", ") || "none"}`,
      `Exposed ports ${visible.exposedPorts.join(", ") || "none"}`,
      `Build args ${visible.buildArgs.join(", ") || "none"}`,
      `Environment names ${visible.environmentNames.join(", ") || "none"}`,
      `Run steps ${visible.runSteps}`,
      `Entrypoint ${visible.hasEntrypoint ? "yes" : "no"}`,
      `Command ${visible.hasCommand ? "yes" : "no"}`,
      "",
    ].join("\n"));
  },
};

export const optionTypes = {};
