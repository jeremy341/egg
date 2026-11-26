// CLI group "bindings-env". Orchard source files: deploy_bindings, env, env_pull.
// Each export is consumed by web/scripts/egg-cli.mjs. Owned by one child at a time.
// commands: registry entries { name, args, options?, required?, description, runner }.
// runners: async (nest, args, flags, out, deps, fail, kit) => void. Use kit for printData, table, clean, dash, json, redactSecrets, UsageError, Failure.
// optionTypes: { "option-name": "flag" | "value" } for options this group adds.
import { readFileSync } from "node:fs";

export const commands = [
  { name: "env get", args: ["name-or-id"], description: "Show one shared environment set by name or id.", runner: "envGet" },
  { name: "env get-default", args: [], description: "Show the default shared environment set.", runner: "envGetDefault" },
  {
    name: "env create",
    args: [],
    required: ["name"],
    options: ["name", "slug"],
    description: "Create an account-wide shared environment set.",
    runner: "envCreate",
  },
  {
    name: "env sets remove",
    args: ["name-or-id"],
    required: ["confirm"],
    options: ["confirm"],
    description: "Delete a shared environment set after confirming its exact name.",
    runner: "envSetsRemove",
  },
  { name: "env set-default", args: ["name-or-id"], description: "Set the default shared environment by name or id.", runner: "envSetDefault" },
  {
    name: "env vars get",
    args: ["environment-name-or-id"],
    options: ["show-values"],
    description: "List shared variable names and targets; Egg never returns their values.",
    runner: "envVarsGet",
  },
  {
    name: "env vars set",
    args: ["environment-name-or-id", "KEY=VALUE"],
    options: ["file", "secret"],
    description: "Merge one inline assignment and optional dotenv entries into a shared environment.",
    runner: "envVarsSet",
  },
  {
    name: "env vars unset",
    args: ["environment-name-or-id", "KEY"],
    required: ["confirm"],
    options: ["confirm"],
    description: "Remove one shared variable after confirming its environment name.",
    runner: "envVarsUnset",
  },
];

export const optionTypes = {
  slug: "value",
  "show-values": "flag",
  file: "value",
  secret: "flag",
};

async function environments(nest) {
  const data = await nest.listEnvironments();
  return data.environments;
}

async function findEnvironment(nest, nameOrId, kit) {
  const list = await environments(nest);
  const found = list.find((environment) => environment.id === nameOrId)
    ?? list.find((environment) => environment.name === nameOrId);
  if (!found) throw new kit.Failure(`No shared environment named or identified by "${kit.clean(nameOrId)}".`);
  return found;
}

async function defaultEnvironment(nest, kit) {
  const list = await environments(nest);
  const found = list.find((environment) => environment.isDefault);
  if (!found) throw new kit.Failure("There is no default shared environment. Run egg env sets list.");
  return found;
}

function printEnvironment(environment, flags, out, deps, kit) {
  return kit.printData({ environment }, flags, deps, out, (visible) => kit.table(
    ["ID", "NAME", "DEFAULT"],
    [[visible.environment.id, kit.clean(visible.environment.name), visible.environment.isDefault ? "yes" : "no"]],
  ));
}

function parseAssignment(entry, kit, source) {
  const split = entry.indexOf("=");
  if (split < 1) throw new kit.UsageError(`${source} entries must use KEY=VALUE.`);
  const key = entry.slice(0, split).trim();
  const value = entry.slice(split + 1);
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
    throw new kit.UsageError(`${source} contains an invalid environment key.`);
  }
  return { key, value, target: "all" };
}

function parseDotenv(contents, kit) {
  const entries = [];
  for (const [index, line] of contents.split(/\r?\n/).entries()) {
    let value = line.trim();
    if (!value || value.startsWith("#")) continue;
    if (value.startsWith("export ")) value = value.slice(7).trimStart();
    const split = value.indexOf("=");
    if (split < 1) throw new kit.UsageError(`Dotenv line ${index + 1} must use KEY=VALUE.`);

    const key = value.slice(0, split).trim();
    let entryValue = value.slice(split + 1).trim();
    if (entryValue.length >= 2 && ((entryValue[0] === "\"" && entryValue.at(-1) === "\"")
      || (entryValue[0] === "'" && entryValue.at(-1) === "'"))) {
      const quote = entryValue[0];
      entryValue = entryValue.slice(1, -1);
      if (quote === "\"") entryValue = entryValue.replace(/\\n/g, "\n").replace(/\\r/g, "\r").replace(/\\\"/g, "\"").replace(/\\\\/g, "\\");
    } else {
      entryValue = entryValue.replace(/\s+#.*$/, "").trimEnd();
    }
    entries.push(parseAssignment(`${key}=${entryValue}`, kit, `Dotenv line ${index + 1}`));
  }
  return entries;
}

function uniqueEntries(entries, kit) {
  const seen = new Set();
  for (const entry of entries) {
    const key = `${entry.key}\u0000${entry.target}`;
    if (seen.has(key)) throw new kit.UsageError(`Variable ${entry.key} appears more than once.`);
    seen.add(key);
  }
  if (entries.length > 100) throw new kit.UsageError("An environment update can contain at most 100 entries.");
  return entries;
}

function readDotenv(path, kit) {
  let contents;
  try {
    contents = readFileSync(path, "utf8");
  } catch {
    throw new kit.UsageError(`Cannot read dotenv file "${kit.clean(path)}".`);
  }
  return parseDotenv(contents, kit);
}

export const runners = {
  async envGet(nest, [nameOrId], flags, out, deps, _fail, kit) {
    const environment = await findEnvironment(nest, nameOrId, kit);
    return printEnvironment(environment, flags, out, deps, kit);
  },

  async envGetDefault(nest, _args, flags, out, deps, _fail, kit) {
    const environment = await defaultEnvironment(nest, kit);
    return printEnvironment(environment, flags, out, deps, kit);
  },

  async envCreate(nest, _args, flags, out, deps, _fail, kit) {
    if (flags.slug !== undefined) throw new kit.UsageError("Egg shared environments do not support custom slugs.");
    const data = await nest.createEnvironment({ name: flags.name });
    return kit.printData(data, flags, deps, out, (visible) => `Created shared environment ${kit.clean(visible.environment.name)} (${visible.environment.id}).\n`);
  },

  async envSetsRemove(nest, [nameOrId], flags, out, deps, _fail, kit) {
    const environment = await findEnvironment(nest, nameOrId, kit);
    if (flags.confirm !== environment.name) {
      throw new kit.UsageError(`--confirm must exactly match the shared environment name "${kit.clean(environment.name)}".`);
    }
    const data = await nest.deleteEnvironment(environment.id, flags.confirm);
    return kit.printData(data, flags, deps, out, (visible) => `Deleted shared environment ${kit.clean(visible.deleted.name)}.\n`);
  },

  async envSetDefault(nest, [nameOrId], flags, out, deps, _fail, kit) {
    const selected = await findEnvironment(nest, nameOrId, kit);
    const data = await nest.setDefaultEnvironment(selected.id);
    return kit.printData(data, flags, deps, out, (visible) => `Set ${kit.clean(visible.environment.name)} as the default shared environment.\n`);
  },

  async envVarsGet(nest, [nameOrId], flags, out, deps, _fail, kit) {
    if (flags.showValues) throw new kit.UsageError("Egg's shared-variable endpoint never returns values.");
    const selected = await findEnvironment(nest, nameOrId, kit);
    const data = await nest.getSharedEnvVars(selected.id);
    return kit.printData(data, flags, deps, out, (visible) => visible.env.length === 0
      ? "No shared variables.\n"
      : kit.table(["KEY", "TARGET"], visible.env.map((entry) => [kit.clean(entry.key), kit.dash(entry.target)])));
  },

  async envVarsSet(nest, [nameOrId, assignment], flags, out, deps, _fail, kit) {
    if (flags.secret) throw new kit.UsageError("Egg's shared-variable endpoint does not support a secret marker.");
    const entries = [
      ...(flags.file ? readDotenv(flags.file, kit) : []),
      parseAssignment(assignment, kit, "Inline"),
    ];
    const envVars = uniqueEntries(entries, kit);
    const selected = await findEnvironment(nest, nameOrId, kit);
    const data = await nest.addSharedEnvVars(selected.id, { envVars });
    return kit.printData(data, flags, deps, out, (visible) => `Added or replaced ${visible.env.length} shared variable entr${visible.env.length === 1 ? "y" : "ies"}.\n`);
  },

  async envVarsUnset(nest, [nameOrId, key], flags, out, deps, _fail, kit) {
    const selected = await findEnvironment(nest, nameOrId, kit);
    if (flags.confirm !== selected.name) {
      throw new kit.UsageError(`--confirm must exactly match the shared environment name "${kit.clean(selected.name)}".`);
    }
    const data = await nest.deleteSharedEnvVars(selected.id, { keys: [key], confirmName: flags.confirm });
    return kit.printData(data, flags, deps, out, (visible) => `Removed ${visible.deleted.length} shared variable entr${visible.deleted.length === 1 ? "y" : "ies"}.\n`);
  },
};
