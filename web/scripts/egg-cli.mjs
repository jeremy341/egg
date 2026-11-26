#!/usr/bin/env node
// The Egg command line. Use Egg from a terminal or a script without writing HTTP calls.
//
//   EGG_TOKEN=egg_... EGG_URL=https://your-egg egg projects list
//
// It has no packages to install. All requests go through the typed client in
// src/lib/sdk/egg.ts, so this file holds no HTTP code of its own. That file
// is TypeScript: Node 22.18 or newer runs it directly (Node 20 and 22 before that:
// `npx tsx scripts/egg-cli.mjs ...`).
//
// Exit codes: 0 success, 1 general error, 2 usage, 3 authentication, 4 not found,
// 6 rate limited, 7 server error, and 8 timeout. API secrets are hidden unless
// --show-secrets is explicit; bearer tokens are always hidden.

import { readFileSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { doctorCommand } from "./doctor.mjs";
import { startEgg } from "./egg-start.mjs";

import { GROUPS } from "./egg-cli-groups/index.mjs";

const FINAL_STATES = new Set(["ready", "error", "canceled"]);
const POLL_MS = 2000;

// ---------------------------------------------------------------------- usage

const BASE_OPTION_TYPES = {
  json: "flag",
  "show-secrets": "flag",
  help: "flag",
  token: "value",
  url: "value",
  name: "value",
  server: "value",
  repo: "value",
  runtime: "value",
  slug: "value",
  branch: "value",
  port: "value",
  "ports-file": "value",
  domain: "value",
  "clear-domain": "flag",
  "root-dir": "value",
  "install-command": "value",
  "build-command": "value",
  "start-command": "value",
  "output-dir": "value",
  "health-path": "value",
  "auto-deploy": "value",
  "workload-kind": "value",
  confirm: "value",
  "remove-from-server": "flag",
  wait: "flag",
  timeout: "value",
  follow: "flag",
  target: "value",
  project: "value",
  schedule: "value",
  command: "value",
  enabled: "value",
  "memory-mb": "value",
  "cpu-percent": "value",
  limit: "value",
  cursor: "value",
  dev: "flag",
};

const GLOBAL_OPTIONS = new Set(["json", "show-secrets", "help", "token", "url"]);

/** Canonical command table: parsing and help both derive their command surface from here. */
const BASE_COMMANDS = [
  { name: "whoami", args: [], description: "Show the account and token scopes.", runner: "whoami" },
  { name: "projects list", args: [], description: "List your projects.", runner: "projectsList" },
  { name: "projects show", args: ["project"], description: "Show a project by slug or id.", runner: "projectsShow" },
  {
    name: "projects create",
    args: [],
    required: ["name", "server", "repo", "runtime"],
    options: ["name", "server", "repo", "runtime", "slug", "branch", "port", "root-dir", "install-command", "build-command", "start-command", "output-dir", "health-path", "auto-deploy", "workload-kind"],
    description: "Create a project from a public GitHub repository.",
    runner: "projectsCreate",
  },
  {
    name: "projects update",
    args: ["project"],
    options: ["branch", "port", "root-dir", "install-command", "build-command", "start-command", "output-dir", "health-path", "auto-deploy"],
    description: "Update supported project settings.",
    runner: "projectsUpdate",
  },
  {
    name: "projects source",
    args: ["project"],
    options: ["repo", "branch"],
    description: "Change a project's GitHub repository or production branch.",
    runner: "projectsSource",
  },
  {
    name: "projects delete",
    args: ["project"],
    required: ["confirm"],
    options: ["confirm", "remove-from-server"],
    description: "Delete a project after confirming its exact name.",
    runner: "projectsDelete",
  },
  { name: "projects restart", args: ["project"], description: "Restart a project's production service.", runner: "serviceRestart" },
  { name: "services list", args: [], options: ["limit", "cursor"], description: "List deployable services.", runner: "servicesList" },
  { name: "services show", args: ["service"], description: "Show one service by slug or id.", runner: "projectsShow" },
  {
    name: "services create",
    args: [],
    required: ["name", "server", "repo", "runtime"],
    options: ["name", "server", "repo", "runtime", "slug", "branch", "port", "root-dir", "install-command", "build-command", "start-command", "output-dir", "health-path", "auto-deploy", "workload-kind"],
    description: "Create a service through the project API.",
    runner: "servicesCreate",
  },
  {
    name: "services update",
    args: ["service"],
    options: ["branch", "port", "root-dir", "install-command", "build-command", "start-command", "output-dir", "health-path", "auto-deploy"],
    description: "Update supported service settings.",
    runner: "servicesUpdate",
  },
  {
    name: "services configure",
    args: ["service"],
    options: ["ports-file", "domain", "clear-domain"],
    description: "Replace the service's complete port list or change its internal DNS name.",
    runner: "servicesConfigure",
  },
  {
    name: "services delete",
    args: ["service"],
    required: ["confirm"],
    options: ["confirm", "remove-from-server"],
    description: "Delete a service after confirming its exact name.",
    runner: "servicesDelete",
  },
  { name: "services logs", args: ["service"], description: "Read a service's production runtime logs.", runner: "servicesLogs" },
  { name: "services restart", args: ["service"], description: "Restart a service's production process.", runner: "serviceRestart" },
  { name: "services port", args: ["service", "port"], description: "Change the public port for a service.", runner: "servicesPort" },
  { name: "services exposure", args: ["service", "domain", "attach-or-detach"], description: "Attach or detach an owner's domain from a service.", runner: "servicesExposure" },
  { name: "deploy list", args: ["project"], description: "List a project's deployments.", runner: "deployList" },
  { name: "deploy show", args: ["deployment-id"], description: "Show one deployment.", runner: "deployShow" },
  {
    name: "deploy create",
    args: ["project"],
    options: ["branch", "wait", "timeout"],
    description: "Deploy a project's configured GitHub repository.",
    runner: "deployCreate",
  },
  {
    name: "deploy redeploy",
    args: ["deployment-id"],
    options: ["wait", "timeout"],
    description: "Build the same commit again.",
    runner: "deployRedeploy",
  },
  { name: "deploy cancel", args: ["deployment-id"], description: "Cancel a deployment that is still running.", runner: "deployCancel" },
  { name: "deploy rollout", args: ["deployment-id"], options: ["wait"], description: "Read the deployment's current rollout state.", runner: "deployRollout" },
  {
    name: "deploy rollback",
    args: ["deployment-id"],
    options: ["wait", "timeout"],
    description: "Point production back at an earlier deployment.",
    runner: "deployRollback",
  },
  { name: "deploy logs", args: ["deployment-id"], options: ["follow"], description: "Read a deployment's build log.", runner: "deployLogs" },
  { name: "deploy", args: ["project"], options: ["branch", "wait", "timeout"], description: "Alias for deploy create.", runner: "deployCreate" },
  { name: "deployments list", args: ["project"], description: "Alias for deploy list.", runner: "deployList" },
  { name: "logs", args: ["deployment-id"], options: ["follow"], description: "Alias for deploy logs.", runner: "deployLogs" },
  { name: "rollback", args: ["deployment-id"], options: ["wait", "timeout"], description: "Alias for deploy rollback.", runner: "deployRollback" },
  { name: "env list", args: ["project"], description: "List variable names and targets; values are write-only.", runner: "envList" },
  { name: "env names", args: ["project"], description: "Alias for env list.", runner: "envList" },
  { name: "env set", args: ["project", "key", "value"], options: ["target"], description: "Create or replace one environment variable.", runner: "envSet" },
  { name: "env unset", args: ["project", "key"], options: ["target"], description: "Remove an environment variable.", runner: "envUnset" },
  { name: "env add", args: ["project", "json-file"], options: ["target"], description: "Merge variables from a JSON file; omitted names are left alone.", runner: "envAdd" },
  { name: "env replace", args: ["project", "json-file"], required: ["confirm"], options: ["confirm"], description: "Replace every variable from a JSON file after confirming the project name.", runner: "envReplace" },
  { name: "env delete", args: ["project", "json-file"], required: ["confirm"], options: ["confirm", "target"], description: "Delete named variables from a JSON file after confirming the project name.", runner: "envDelete" },
  { name: "env sets list", args: [], description: "List your shared environment sets.", runner: "envSetsList" },
  { name: "env sets create", args: [], required: ["name"], options: ["name"], description: "Create a shared environment set.", runner: "envSetsCreate" },
  { name: "env sets rename", args: ["environment-id"], required: ["name"], options: ["name"], description: "Rename a shared environment set.", runner: "envSetsRename" },
  { name: "env sets delete", args: ["environment-id"], required: ["confirm"], options: ["confirm"], description: "Delete a shared environment set after confirming its name.", runner: "envSetsDelete" },
  { name: "env sets default", args: ["environment-id"], description: "Choose the shared environment applied by default.", runner: "envSetsDefault" },
  { name: "env shared list", args: ["environment-id"], description: "List shared variable names and targets; values are write-only.", runner: "envSharedList" },
  { name: "env shared add", args: ["environment-id", "json-file"], options: ["target"], description: "Add or replace shared variables from a JSON file.", runner: "envSharedAdd" },
  { name: "env shared replace", args: ["environment-id", "json-file"], required: ["confirm"], options: ["confirm"], description: "Replace all shared variables after confirming the environment name.", runner: "envSharedReplace" },
  { name: "env shared delete", args: ["environment-id", "json-file"], required: ["confirm"], options: ["confirm", "target"], description: "Delete named shared variables after confirming the environment name.", runner: "envSharedDelete" },
  { name: "jobs list", args: ["project"], description: "List the project's scheduled jobs.", runner: "jobsList" },
  { name: "jobs show", args: ["project", "job-id"], description: "Show one scheduled job.", runner: "jobsShow" },
  {
    name: "jobs create",
    args: ["project"],
    required: ["name", "schedule", "command"],
    options: ["name", "schedule", "command", "enabled"],
    description: "Create a one-command scheduled job using a five-field UTC cron schedule.",
    runner: "jobsCreate",
  },
  {
    name: "jobs update",
    args: ["project", "job-id"],
    options: ["name", "schedule", "command", "enabled"],
    description: "Change a job or pause or resume its timer.",
    runner: "jobsUpdate",
  },
  {
    name: "jobs run",
    args: ["project", "job-id"],
    required: ["confirm"],
    options: ["confirm"],
    description: "Run a scheduled command now after confirming its exact name.",
    runner: "jobsRun",
  },
  { name: "jobs runs", args: ["project", "job-id"], description: "Read the job's latest status snapshot.", runner: "jobsRuns" },
  { name: "jobs logs", args: ["project", "job-id"], description: "Read recent scheduled-job output.", runner: "jobsLogs" },
  { name: "jobs cancel", args: ["project", "job-id"], description: "Pause future runs of a scheduled job.", runner: "jobsCancel" },
  {
    name: "jobs delete",
    args: ["project", "job-id"],
    required: ["confirm"],
    options: ["confirm"],
    description: "Delete a scheduled job after confirming its exact name.",
    runner: "jobsDelete",
  },
  { name: "ops start", args: ["deployment-id"], description: "Start a stopped production service.", runner: "opsStart" },
  { name: "ops stop", args: ["deployment-id"], description: "Stop a production service without deleting its data.", runner: "opsStop" },
  { name: "ops restart", args: ["deployment-id"], description: "Restart a production service without rebuilding it.", runner: "opsRestart" },
  { name: "ops scale", args: ["deployment-id"], options: ["memory-mb", "cpu-percent"], description: "Change the current production service's CPU or memory limit.", runner: "opsScale" },
  { name: "ops volumes", args: ["deployment-id"], description: "List the Docker volumes owned by a Compose deployment.", runner: "opsVolumes" },
  { name: "domains list", args: [], description: "List your domains.", runner: "domainsList" },
  {
    name: "domains add",
    args: ["domain"],
    required: ["server", "port"],
    options: ["server", "port", "project"],
    description: "Add a domain to a server, optionally attached to a project.",
    runner: "domainsAdd",
  },
  { name: "domains remove", args: ["domain"], description: "Remove a domain by name or id.", runner: "domainsRemove" },
  { name: "domains validate", args: ["domain"], description: "Check DNS and certificate status for a domain.", runner: "domainsValidate" },
  { name: "notify channels list", args: ["project"], description: "Show the project's configured notification channel.", runner: "notifyList" },
  { name: "notify channels test", args: ["project"], description: "Send a test notification to the project channel.", runner: "notifyTest" },
  { name: "status", args: [], description: "Show CPU, memory and disk use of your servers.", runner: "status" },
  { name: "start", args: [], options: ["dev"], description: "Set up and start Egg on this computer.", local: true },
  { name: "doctor", args: [], description: "Check whether this computer can run Egg.", local: true },
];

// Command groups are merged in from web/scripts/egg-cli-groups. Base entries come first.
export const COMMANDS = [...BASE_COMMANDS, ...GROUPS.flatMap((group) => group.commands)];
const OPTION_TYPES = Object.assign({}, BASE_OPTION_TYPES, ...GROUPS.map((group) => group.optionTypes));
const LOCAL_COMMANDS = new Set(COMMANDS.filter((command) => command.local).map((command) => command.name));
const optionKey = (name) => name.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
const fail = (message) => ({ ok: false, message });

function usageFor(command) {
  const args = command.args.map((arg) => `<${arg}>`).join(" ");
  const usage = `  egg ${command.name}${args ? ` ${args}` : ""}`;
  if (!command.options?.length) return `${usage}\n    ${command.description}`;
  const describeOption = (name) => `--${name}${OPTION_TYPES[name] === "value" ? ` <${name}>` : ""}`;
  const required = new Set(command.required ?? []);
  const requiredOptions = command.options.filter((name) => required.has(name)).map(describeOption);
  const optionalOptions = command.options.filter((name) => !required.has(name)).map((name) => `[${describeOption(name)}]`);
  return [
    usage,
    `    ${command.description}`,
    ...(requiredOptions.length ? [`    Required: ${requiredOptions.join(" ")}`] : []),
    ...(optionalOptions.length ? [`    Options:  ${optionalOptions.join(" ")}`] : []),
  ].join("\n");
}

export const USAGE = `Egg command line

Usage: egg <command> [options]

Commands:
${COMMANDS.map(usageFor).join("\n")}

Global options:
  --token <token>       Use this personal access token (otherwise EGG_TOKEN)
  --url <url>           Egg address (otherwise EGG_URL)
  --json                Print JSON even in a terminal
  --show-secrets        Allow secret fields in API responses to be printed
  -h, --help            Show this help

For deploy create, redeploy and rollback, --wait polls up to --timeout (default 10m).
For deploy rollout, --wait asks the API to wait up to 60s. A timeout may be written as 30s, 5m, or 1h.
Environment JSON files keep variable values out of shell arguments. Piped output is JSON automatically.
Environment: EGG_TOKEN and EGG_URL provide the bearer token and Egg address.

Exit codes:
  0 success   1 general error   2 usage error   3 authentication error
  4 not found  6 rate limited    7 server error  8 timeout
`;

function parseDuration(value) {
  const match = /^(\d+)(ms|s|m|h)?$/.exec(String(value));
  if (!match) return null;
  const amount = Number(match[1]);
  const factor = { ms: 1, s: 1000, m: 60_000, h: 3_600_000 }[match[2] ?? "ms"];
  const duration = amount * factor;
  return Number.isSafeInteger(amount) && amount > 0 && Number.isSafeInteger(duration) ? duration : null;
}

/** Parse arguments according to COMMANDS, which is also the source for help output. */
export function parseCli(argv) {
  const flags = { json: false, showSecrets: false, help: false, wait: false, follow: false, dev: false };
  const words = [];
  let optionsEnded = false;

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (optionsEnded || !token.startsWith("-") || token === "-") {
      words.push(token);
      continue;
    }
    if (token === "--") {
      optionsEnded = true;
      continue;
    }
    const equals = token.indexOf("=");
    const name = token === "-h" ? "help" : token.slice(2, equals < 0 ? undefined : equals);
    if (!token.startsWith("--") && token !== "-h") return fail(`Unknown option ${token}.`);
    const kind = OPTION_TYPES[name];
    if (!kind) return fail(`Unknown option --${name}.`);
    const inline = equals < 0 ? undefined : token.slice(equals + 1);
    if (kind === "value") {
      const value = inline ?? argv[++i];
      if (value === undefined || value === "" || (inline === undefined && value.startsWith("--"))) {
        return fail(`--${name} needs a value.`);
      }
      flags[optionKey(name)] = value;
    } else if (inline === undefined) {
      flags[optionKey(name)] = true;
    } else {
      return fail(`--${name} does not take a value.`);
    }
  }

  if (flags.help || words[0] === "help") return { ok: true, command: "help", args: [], flags };
  if (words.length === 0) return fail("Say what to do, such as egg projects list.");

  const matches = COMMANDS.filter((candidate) => {
    const parts = candidate.name.split(" ");
    return parts.every((part, index) => words[index] === part);
  }).sort((a, b) => b.name.split(" ").length - a.name.split(" ").length);
  const spec = matches[0];
  if (!spec) {
    const group = words[0];
    const choices = COMMANDS.filter((candidate) => candidate.name.startsWith(`${group} `));
    if (choices.length > 0) return fail(`Use one of: ${choices.map((candidate) => `egg ${candidate.name}`).join(", ")}.`);
    return fail(`Unknown command "${group}".`);
  }

  const globalGiven = new Set(GLOBAL_OPTIONS);
  for (const name of Object.keys(OPTION_TYPES)) {
    const key = optionKey(name);
    const given = Object.hasOwn(flags, key) && flags[key] !== false;
    if (given && !globalGiven.has(name) && !(spec.options ?? []).includes(name)) {
      return fail(`--${name} only works with egg ${COMMANDS.find((candidate) => candidate.options?.includes(name))?.name ?? "a supported command"}.`);
    }
  }

  const pathWords = spec.name.split(" ");
  const args = words.slice(pathWords.length);
  if (args.length < spec.args.length) return fail(`egg ${spec.name} needs a ${spec.args[args.length].replaceAll("-", " ")}.`);
  if (args.length > spec.args.length) return fail(`Too many arguments for egg ${spec.name}.`);
  for (const name of spec.required ?? []) {
    if (flags[optionKey(name)] === undefined) return fail(`egg ${spec.name} needs --${name}.`);
  }
  if (flags.timeout !== undefined && !flags.wait) return fail("--timeout only works with --wait.");
  if (flags.timeout !== undefined && parseDuration(flags.timeout) === null) return fail("--timeout needs a positive duration such as 30s or 5m.");
  return { ok: true, command: spec.name, args, flags };
}

// --------------------------------------------------------------------- output

/** One cell per column, padded to the widest, with no trailing spaces. */
function table(header, rows) {
  const all = [header, ...rows];
  const widths = header.map((_, c) => Math.max(...all.map((r) => String(r[c]).length)));
  return all.map((r) => r.map((cell, c) => String(cell).padEnd(widths[c])).join("  ").trimEnd()).join("\n") + "\n";
}

/** Text from a server or a container is untrusted: drop escape and other control characters. */
const clean = (text) => String(text ?? "").replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g, "");

const dash = (value) => (value === null || value === undefined || value === "" ? "-" : value);
const json = (value) => JSON.stringify(value, null, 2) + "\n";
const pct = (used, total) => (used !== null && total ? `${Math.round((used / total) * 100)}%` : "unknown");

function describeUsage(server, usage) {
  const mem = usage.memUsedMb === null ? "unknown" : `${usage.memUsedMb} / ${usage.memTotalMb} MB (${pct(usage.memUsedMb, usage.memTotalMb)})`;
  const disk = usage.diskUsedMb === null ? "unknown" : `${usage.diskUsedMb} / ${usage.diskTotalMb} MB (${pct(usage.diskUsedMb, usage.diskTotalMb)})`;
  const load = usage.cpuLoad === null ? "unknown" : `${usage.cpuLoad.toFixed(2)}${usage.cpus ? ` (${usage.cpus} cores)` : ""}`;
  return [`${clean(server.host)} (${server.id})`, `  CPU load  ${load}`, `  Memory    ${mem}`, `  Disk      ${disk}`, `  Checked   ${usage.checkedAt}`, ""].join("\n");
}

// -------------------------------------------------------------------- running

class UsageError extends Error {}
class Failure extends Error {}
class NotFound extends Failure {}
class TimeoutFailure extends Failure {}

/** A project's slug (or id) to its id. The API wants ids. */
async function projectId(nest, slugOrId) {
  const { projects } = await nest.listProjects();
  const found = projects.find((p) => p.slug === slugOrId) ?? projects.find((p) => p.id === slugOrId);
  if (!found) throw new NotFound(`No project with the slug or id "${slugOrId}". Run egg projects list to see yours.`);
  return found.id;
}

const deploymentLine = (d) => `${d.id} (${d.env}, ${d.branch}, ${d.state})`;

function printData(data, flags, deps, out, text) {
  const visible = redactSecrets(data, flags.showSecrets);
  if (flags.json || !deps.isTTY) return out(json(visible));
  return out(text(visible));
}

const SENSITIVE_FIELD = /(secret|password|credential|private.?key|authorization|webhook.?url|api.?key|access.?token|refresh.?token)/i;

function redactSecrets(value, showSecrets, parentPath = "") {
  const secretValues = new Set();
  const isSensitive = (key, item, path) =>
    SENSITIVE_FIELD.test(key) ||
    (key.toLowerCase() === "token" && typeof item === "string") ||
    (path.endsWith("instructions.txt") && key === "value");
  const collect = (item, path = "") => {
    if (!item || typeof item !== "object") return;
    for (const [key, child] of Object.entries(item)) {
      const childPath = path ? `${path}.${key}` : key;
      if (isSensitive(key, child, path) && typeof child === "string" && child) secretValues.add(child);
      else collect(child, childPath);
    }
  };
  if (!showSecrets) collect(value);

  const visit = (item, path = "") => {
    if (Array.isArray(item)) return item.map((child) => visit(child, path));
    if (!item || typeof item !== "object") {
      if (typeof item !== "string") return item;
      return [...secretValues].reduce((text, secret) => text.split(secret).join("[redacted]"), clean(item));
    }
    return Object.fromEntries(
      Object.entries(item).map(([key, child]) => {
        const childPath = path ? `${path}.${key}` : key;
        if (!showSecrets && isSensitive(key, child, path)) return [key, "[redacted]"];
        return [key, visit(child, childPath)];
      })
    );
  };
  return visit(value, parentPath);
}

function numberOption(flags, key) {
  const value = Number(flags[key]);
  if (!Number.isSafeInteger(value) || value < 1) throw new UsageError(`--${key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)} needs a positive integer.`);
  return value;
}

function boundedIntegerOption(flags, key, minimum, maximum) {
  const value = Number(flags[key]);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new UsageError(`--${key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)} must be an integer from ${minimum} to ${maximum}.`);
  }
  return value;
}

function booleanOption(value, flag) {
  if (value === undefined) return undefined;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new UsageError(`--${flag} must be true or false.`);
}

function projectCreateInput(flags) {
  const input = {
    name: flags.name,
    serverId: flags.server,
    repoUrl: repositoryUrl(flags.repo),
    runtime: flags.runtime,
    ...(flags.slug ? { slug: flags.slug } : {}),
    ...(flags.branch ? { productionBranch: flags.branch } : {}),
    ...(flags.port !== undefined ? { port: numberOption(flags, "port") } : {}),
  };
  const fields = {
    "root-dir": "rootDir",
    "install-command": "installCommand",
    "build-command": "buildCommand",
    "start-command": "startCommand",
    "output-dir": "outputDir",
    "health-path": "healthPath",
  };
  for (const [flag, field] of Object.entries(fields)) {
    if (flags[optionKey(flag)] !== undefined) input[field] = flags[optionKey(flag)];
  }
  const autoDeploy = booleanOption(flags.autoDeploy, "auto-deploy");
  if (autoDeploy !== undefined) input.autoDeploy = autoDeploy;
  if (flags.workloadKind !== undefined) {
    if (!["web", "worker"].includes(flags.workloadKind)) throw new UsageError("--workload-kind must be web or worker.");
    input.workloadKind = flags.workloadKind;
  }
  return input;
}

function projectUpdateChanges(flags, command = "projects") {
  const changes = {};
  const names = {
    branch: "productionBranch",
    port: "port",
    "root-dir": "rootDir",
    "install-command": "installCommand",
    "build-command": "buildCommand",
    "start-command": "startCommand",
    "output-dir": "outputDir",
    "health-path": "healthPath",
  };
  for (const [flag, field] of Object.entries(names)) {
    if (flags[optionKey(flag)] !== undefined) changes[field] = flag === "port" ? numberOption(flags, flag) : flags[optionKey(flag)];
  }
  const autoDeploy = booleanOption(flags.autoDeploy, "auto-deploy");
  if (autoDeploy !== undefined) changes.autoDeploy = autoDeploy;
  if (Object.keys(changes).length === 0) throw new UsageError(`${command} update needs at least one setting to change.`);
  return changes;
}

function readJsonFile(path, label) {
  let source;
  try {
    source = readFileSync(path, "utf8");
  } catch {
    throw new UsageError(`Could not read ${label} JSON file "${path}".`);
  }
  try {
    return JSON.parse(source);
  } catch {
    throw new UsageError(`${label} file "${path}" must contain valid JSON.`);
  }
}

function fileArray(value, key, label) {
  const entries = Array.isArray(value) ? value : value && typeof value === "object" ? value[key] : undefined;
  if (!Array.isArray(entries)) throw new UsageError(`${label} file must be a JSON array or an object with a "${key}" array.`);
  return entries;
}

function envEntriesFromFile(path, targetOverride) {
  const entries = fileArray(readJsonFile(path, "Environment"), "envVars", "Environment");
  if (entries.length > 100) throw new UsageError("An environment file can contain at most 100 entries.");
  return entries.map((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry) || typeof entry.key !== "string" || typeof entry.value !== "string") {
      throw new UsageError(`Environment entry ${index + 1} needs string "key" and "value" fields.`);
    }
    const target = entry.target ?? targetOverride ?? "all";
    if (!["all", "production", "preview"].includes(target)) {
      throw new UsageError(`Environment entry ${index + 1} has an invalid target; use all, production, or preview.`);
    }
    return { key: entry.key, value: entry.value, target };
  });
}

function envKeysFromFile(path) {
  const keys = fileArray(readJsonFile(path, "Environment key"), "keys", "Environment key");
  if (keys.length === 0 || keys.length > 100 || keys.some((key) => typeof key !== "string")) {
    throw new UsageError("Environment key file must contain 1 to 100 string keys.");
  }
  return keys;
}

function servicePortsFromFile(path) {
  const ports = fileArray(readJsonFile(path, "Service port"), "ports", "Service port");
  if (ports.length > 1000) throw new UsageError("A service port file can contain at most 1000 entries.");
  return ports;
}

/** Use Egg's authenticated transport when a small SDK method omits needed query or body fields. */
function requestWithClient(nest, method, path, query = {}, body) {
  const request = Reflect.get(nest, "request");
  if (typeof request !== "function") throw new Failure("This Egg client cannot make the required confirmed API request.");
  return request.call(nest, method, path, query, body);
}

/**
 * The CLI's own route table: each registered operation it uses maps to one typed SDK call.
 * Destructive operations still need the endpoint's own confirmName, which the command passes through.
 */
const OPERATIONS = {
  list_environments: (nest) => nest.listEnvironments(),
  create_environment: (nest, a) => nest.createEnvironment({ name: a.name }),
  rename_environment: (nest, a) => nest.renameEnvironment(a.environmentId, { name: a.name }),
  delete_environment: (nest, a) => nest.deleteEnvironment(a.environmentId, a.confirmName),
  set_default_environment: (nest, a) => nest.setDefaultEnvironment(a.environmentId),
  get_shared_env_vars: (nest, a) => nest.getSharedEnvVars(a.environmentId),
  add_shared_env_vars: (nest, a) => nest.addSharedEnvVars(a.environmentId, { envVars: a.envVars }),
  set_shared_env_vars: (nest, a) =>
    nest.setSharedEnvVars(a.environmentId, { envVars: a.envVars, confirmName: a.confirmName }),
  delete_shared_env_vars: (nest, a) =>
    nest.deleteSharedEnvVars(a.environmentId, {
      keys: a.keys,
      confirmName: a.confirmName,
      ...(a.target ? { target: a.target } : {}),
    }),
  delete_service: (nest, a) =>
    nest.deleteService(a.serviceId, a.confirmName, { removeFromServer: a.removeFromServer }),
  update_service: (nest, { serviceId, ...input }) => nest.updateService(serviceId, input),
  update_deployment_github_repo: (nest, { deploymentId, ...input }) =>
    nest.updateDeploymentGithubRepo(deploymentId, input),
  get_job_run_logs: (nest, a) => nest.getJobRunLogs(a.projectId, a.jobId, a.runId),
  cancel_job_run: (nest, a) => nest.cancelJobRun(a.projectId, a.jobId, a.runId),
  start_deployment: (nest, a) => nest.startDeployment(a.deploymentId),
  stop_deployment: (nest, a) => nest.stopDeployment(a.deploymentId),
  restart_deployment: (nest, a) => nest.restartDeployment(a.deploymentId),
  scale_deployment: (nest, { deploymentId, ...input }) => nest.scaleDeployment(deploymentId, input),
  get_volumes: (nest, a) => nest.getVolumes(a.deploymentId),
};

/** Run one operation the CLI uses through the typed SDK. No compact gateway, and no blanket confirm. */
async function callRegisteredOperation(nest, operationId, args = {}) {
  const call = OPERATIONS[operationId];
  if (!call) throw new Failure(`The CLI has no route for ${operationId}.`);
  return call(nest, args);
}

function validateTarget(target) {
  if (target === undefined) return undefined;
  if (!["all", "production", "preview"].includes(target)) {
    throw new UsageError("--target must be all, production, or preview.");
  }
  return target;
}

function repositoryUrl(repo) {
  const value = repo.trim();
  return /^[\w.-]+\/[\w.-]+$/.test(value) ? `https://github.com/${value}` : value;
}

async function domainId(nest, nameOrId) {
  const { domains } = await nest.listDomains();
  const found = domains.find((domain) => domain.id === nameOrId || domain.domain === nameOrId);
  if (!found) throw new NotFound(`No domain with the name or id "${nameOrId}".`);
  return found.id;
}

async function waitForDeployment(nest, initial, flags, deps) {
  let deployment = initial;
  if (!flags.wait) return deployment;
  const timeoutMs = parseDuration(flags.timeout ?? "10m");
  const deadline = deps.now() + timeoutMs;
  while (!FINAL_STATES.has(deployment.state)) {
    if (deps.now() >= deadline) throw new TimeoutFailure(`Timed out waiting for deployment ${deployment.id}.`);
    deployment = (await nest.getDeployment(deployment.id)).deployment;
    if (FINAL_STATES.has(deployment.state)) break;
    const remaining = deadline - deps.now();
    if (remaining <= 0) throw new TimeoutFailure(`Timed out waiting for deployment ${deployment.id}.`);
    await deps.sleep(Math.min(POLL_MS, remaining));
  }
  if (deployment.state !== "ready") {
    throw new Failure(`Deployment ${deployment.id} finished with state ${deployment.state}${deployment.error ? `: ${clean(deployment.error)}` : ""}.`);
  }
  return deployment;
}

/** Print log lines newer than `after`; returns the id of the last one seen. */
async function printLogs(nest, id, after, emit) {
  let last = after;
  for await (const line of nest.deploymentLogLines(id, { after })) {
    if (line.id <= last) continue;
    last = line.id;
    emit(line);
  }
  return last;
}

const BASE_COMMAND_RUNNERS = {
  async whoami(nest, _args, flags, out, deps) {
    const me = await nest.me();
    return printData(me, flags, deps, out, (data) => [
      `User      ${clean(data.user.name)}`,
      `Token     ${clean(data.token.name)}`,
      `Scopes    ${data.token.scopes.join(", ") || "none"}`,
      `Expires   ${data.token.expiresAt}`,
      `Servers   ${data.counts.servers}`,
      `Projects  ${data.counts.projects}`,
      "",
    ].join("\n"));
  },

  async projectsList(nest, _args, flags, out, deps) {
    const data = await nest.listProjects();
    return printData(data, flags, deps, out, (visible) => visible.projects.length === 0
      ? "No projects yet.\n"
      : table(["SLUG", "NAME", "STATE", "MONITOR", "BRANCH"], visible.projects.map((p) => [p.slug, p.name, p.state ?? "none", p.monitor, p.branch])));
  },

  async projectsShow(nest, [slug], flags, out, deps) {
    const data = await nest.getProject(await projectId(nest, slug));
    return printData(data, flags, deps, out, (visible) => {
      const p = visible.project;
      return [
        `Slug      ${p.slug}`,
        `Name      ${clean(p.name)}`,
        `Repo      ${dash(p.repo)}`,
        `Branch    ${p.branch}`,
        `Runtime   ${p.runtime}`,
        `Port      ${p.port}`,
        `Start     ${dash(p.startCommand)}`,
        `Health    ${p.healthPath}`,
        `Auto      ${p.autoDeploy ? "deploys on push" : "off"}`,
        `State     ${p.state ?? "never deployed"}`,
        `Monitor   ${p.monitor}`,
        `Id        ${p.id}`,
        "",
      ].join("\n");
    });
  },

  async projectsCreate(nest, _args, flags, out, deps) {
    const data = await nest.createProject(projectCreateInput(flags));
    return printData(data, flags, deps, out, (visible) => `Created project ${visible.project.slug} (${visible.project.id}).\n`);
  },

  async projectsUpdate(nest, [slug], flags, out, deps) {
    const data = await nest.updateProject(await projectId(nest, slug), projectUpdateChanges(flags));
    return printData(data, flags, deps, out, (visible) => `Updated project ${visible.project.slug}.\n`);
  },

  async projectsSource(nest, [slug], flags, out, deps) {
    const changes = {};
    if (flags.repo !== undefined) changes.repoFullName = flags.repo;
    if (flags.branch !== undefined) changes.productionBranch = flags.branch;
    if (Object.keys(changes).length === 0) throw new UsageError("projects source needs --repo, --branch, or both.");
    const data = await callRegisteredOperation(nest, "update_deployment_github_repo", {
      deploymentId: await projectId(nest, slug),
      ...changes,
    });
    return printData(data, flags, deps, out, (visible) => `Updated GitHub source for ${visible.project.slug}.\n`);
  },

  async projectsDelete(nest, [slug], flags, out, deps) {
    const { projects } = await nest.listProjects();
    const project = projects.find((p) => p.slug === slug) ?? projects.find((p) => p.id === slug);
    if (!project) throw new NotFound(`No project with the slug or id "${slug}".`);
    if (flags.confirm !== project.name) throw new UsageError(`Pass --confirm with the exact project name: ${project.name}`);
    const data = await requestWithClient(
      nest,
      "DELETE",
      `/projects/${encodeURIComponent(project.id)}`,
      { removeFromServer: flags.removeFromServer ? true : undefined },
      { confirmName: flags.confirm }
    );
    return printData(data, flags, deps, out, () => `Deleted project ${project.slug}.\n`);
  },

  async servicesList(nest, _args, flags, out, deps) {
    const data = await requestWithClient(nest, "GET", "/services", {
      limit: flags.limit === undefined ? 25 : boundedIntegerOption(flags, "limit", 1, 100),
      cursor: flags.cursor,
    });
    return printData(data, flags, deps, out, (visible) => visible.services.length === 0
      ? "No services yet.\n"
      : `${table(["SLUG", "NAME", "STATE", "MONITOR", "BRANCH"], visible.services.map((p) => [p.slug, p.name, p.state ?? "none", p.monitor, p.branch]))}${visible.nextCursor ? `Next page: egg services list --limit ${flags.limit ?? 25} --cursor ${visible.nextCursor}\n` : ""}`);
  },

  async servicesCreate(nest, _args, flags, out, deps) {
    const data = await nest.createService(projectCreateInput(flags));
    return printData(data, flags, deps, out, (visible) => `Created service ${visible.service.slug} (${visible.service.id}).\n`);
  },

  async servicesUpdate(nest, [slug], flags, out, deps) {
    const data = await nest.updateProject(await projectId(nest, slug), projectUpdateChanges(flags, "services"));
    return printData(data, flags, deps, out, (visible) => `Updated service ${visible.project.slug}.\n`);
  },

  async servicesConfigure(nest, [slug], flags, out, deps) {
    if (flags.domain !== undefined && flags.clearDomain) {
      throw new UsageError("Use either --domain or --clear-domain, not both.");
    }
    const changes = {};
    if (flags.portsFile !== undefined) changes.ports = servicePortsFromFile(flags.portsFile);
    if (flags.domain !== undefined) changes.domain = flags.domain;
    if (flags.clearDomain) changes.domain = null;
    if (Object.keys(changes).length === 0) {
      throw new UsageError("services configure needs --ports-file, --domain, or --clear-domain.");
    }
    const data = await callRegisteredOperation(nest, "update_service", {
      serviceId: await projectId(nest, slug),
      ...changes,
    });
    return printData(data, flags, deps, out, (visible) => `Updated service configuration for ${visible.service.slug}.\n`);
  },

  async servicesDelete(nest, [slug], flags, out, deps) {
    const id = await projectId(nest, slug);
    const data = await callRegisteredOperation(nest, "delete_service", {
      serviceId: id,
      confirmName: flags.confirm,
      removeFromServer: flags.removeFromServer,
    });
    return printData(data, flags, deps, out, () => `Deleted service ${slug}.\n`);
  },

  async servicesLogs(nest, [slug], flags, out, deps) {
    const data = await nest.getLogs(await projectId(nest, slug));
    return printData(data, flags, deps, out, (visible) => visible.lines.length === 0
      ? "No runtime logs.\n"
      : `${visible.lines.map(clean).join("\n")}\n`);
  },

  async serviceRestart(nest, [slug], flags, out, deps) {
    const id = await projectId(nest, slug);
    const data = await nest.restartService(id);
    return printData(data, flags, deps, out, () => `Restarted service ${slug}.\n`);
  },

  async servicesPort(nest, [slug, rawPort], flags, out, deps) {
    const port = Number(rawPort);
    if (!Number.isSafeInteger(port) || port < 1024 || port > 65535) throw new UsageError("The service port must be an integer from 1024 to 65535.");
    const data = await nest.setServicePortPublic(await projectId(nest, slug), { port });
    return printData(data, flags, deps, out, () => `Set the public port for service ${slug} to ${port}.\n`);
  },

  async servicesExposure(nest, [slug, domain, action], flags, out, deps) {
    if (!["attach", "detach"].includes(action)) throw new UsageError("Use attach or detach as the service exposure action.");
    const data = await nest.setServiceExposure(await projectId(nest, slug), {
      domainId: await domainId(nest, domain),
      exposed: action === "attach",
    });
    return printData(data, flags, deps, out, (visible) => {
      const lines = [`${action === "attach" ? "Attached" : "Detached"} ${domain} ${action === "attach" ? "to" : "from"} ${slug}.`];
      for (const step of visible.instructions?.steps ?? []) lines.push(`- ${clean(step)}`);
      return `${lines.join("\n")}\n`;
    });
  },

  async deployList(nest, [slug], flags, out, deps) {
    const data = await nest.listDeployments(await projectId(nest, slug), { limit: 100 });
    return printData(data, flags, deps, out, (visible) => visible.deployments.length === 0
      ? "No deployments yet.\n"
      : table(["ID", "STATE", "ENV", "BRANCH", "SHA", "CREATED", "DURATION"], visible.deployments.map((d) => [
        d.id,
        d.state,
        d.env,
        d.branch,
        d.sha ? d.sha.slice(0, 7) : "-",
        d.createdAt,
        d.durationMs === null ? "-" : `${Math.round(d.durationMs / 1000)}s`,
      ])));
  },

  async deployShow(nest, [id], flags, out, deps) {
    const data = await nest.getDeployment(id);
    return printData(data, flags, deps, out, (visible) => [
      `Id        ${visible.deployment.id}`,
      `Project   ${visible.deployment.projectSlug}`,
      `State     ${visible.deployment.state}`,
      `Branch    ${visible.deployment.branch}`,
      `Commit    ${dash(visible.deployment.sha)}`,
      `Created   ${visible.deployment.createdAt}`,
      "",
    ].join("\n"));
  },

  async deployCreate(nest, [slug], flags, out, deps) {
    const result = await nest.deploy(await projectId(nest, slug), flags.branch ? { branch: flags.branch } : {});
    const deployment = await waitForDeployment(nest, result.deployment, flags, deps);
    return printData({ deployment }, flags, deps, out, () => flags.wait
      ? `Deployment ${deploymentLine(deployment)} completed.\n`
      : `Queued deployment ${deploymentLine(deployment)}.\nFollow the build: egg logs ${deployment.id} --follow\n`);
  },

  async deployRedeploy(nest, [id], flags, out, deps) {
    const result = await nest.redeploy(id);
    const deployment = await waitForDeployment(nest, result.deployment, flags, deps);
    return printData({ deployment }, flags, deps, out, () => flags.wait
      ? `Deployment ${deploymentLine(deployment)} completed.\n`
      : `Queued redeployment ${deploymentLine(deployment)}.\n`);
  },

  async deployCancel(nest, [id], flags, out, deps) {
    const data = await nest.cancelDeployment(id);
    return printData(data, flags, deps, out, (visible) => `Canceled deployment ${deploymentLine(visible.deployment)}.\n`);
  },

  async deployRollout(nest, [id], flags, out, deps) {
    const data = await nest.rollout(id, { wait: flags.wait });
    return printData(data, flags, deps, out, (visible) => {
      const rollout = visible.rollout;
      return `${deploymentLine(rollout.deployment)}${rollout.done ? " (finished)" : " (still running)"}.\n`;
    });
  },

  async deployRollback(nest, [id], flags, out, deps) {
    const result = await nest.rollback(id);
    const deployment = await waitForDeployment(nest, result.deployment, flags, deps);
    return printData({ deployment }, flags, deps, out, () => flags.wait
      ? `Rollback ${deploymentLine(deployment)} completed.\n`
      : `Queued a rollback to ${id} as deployment ${deploymentLine(deployment)}.\nFollow it: egg deploy logs ${deployment.id} --follow\n`);
  },

  async deployLogs(nest, [id], flags, out, deps) {
    const logText = (line) => `${line.at}  ${line.level.padEnd(5)}  ${clean(line.message)}\n`;
    const emit = (line) => out(flags.json || !deps.isTTY ? `${JSON.stringify(redactSecrets(line, flags.showSecrets))}\n` : logText(line));
    if (!flags.follow) {
      if (flags.json || !deps.isTTY) {
        const lines = [];
        await printLogs(nest, id, 0, (line) => lines.push(line));
        return out(json({ deploymentId: id, lines: redactSecrets(lines, flags.showSecrets) }));
      }
      await printLogs(nest, id, 0, emit);
      return;
    }
    let after = 0;
    for (;;) {
      after = await printLogs(nest, id, after, emit);
      const { deployment } = await nest.getDeployment(id);
      if (FINAL_STATES.has(deployment.state)) {
        await printLogs(nest, id, after, emit);
        if (deployment.state === "ready") return;
        throw new Failure(`Deployment ${id} finished with state ${deployment.state}${deployment.error ? `: ${clean(deployment.error)}` : ""}.`);
      }
      await deps.sleep(deps.pollMs);
    }
  },

  async envList(nest, [slug], flags, out, deps) {
    const data = await nest.listEnvNames(await projectId(nest, slug));
    return printData(data, flags, deps, out, (visible) => visible.env.length === 0
      ? "No environment variables.\n"
      : table(["KEY", "TARGET"], visible.env.map((item) => [item.key, item.target])));
  },

  async envSet(nest, [slug, key, value], flags, out, deps) {
    const target = validateTarget(flags.target);
    const data = await nest.setEnvVar(await projectId(nest, slug), key, { value, ...(target ? { target } : {}) });
    return printData(data, flags, deps, out, (visible) => `Set ${visible.env.key} (${visible.env.target}).\n`);
  },

  async envUnset(nest, [slug, key], flags, out, deps) {
    const target = validateTarget(flags.target);
    const id = await projectId(nest, slug);
    const data = await requestWithClient(
      nest,
      "DELETE",
      `/projects/${encodeURIComponent(id)}/env/${encodeURIComponent(key)}`,
      { target },
      { confirmName: key }
    );
    return printData(data, flags, deps, out, (visible) => `Removed ${visible.deleted.map((item) => item.key).join(", ") || key}.\n`);
  },

  async envAdd(nest, [slug, path], flags, out, deps) {
    const entries = envEntriesFromFile(path, validateTarget(flags.target));
    const data = await nest.addEnvVars(await projectId(nest, slug), { envVars: entries });
    return printData(data, flags, deps, out, (visible) => `Added or replaced ${visible.env.length} variable entr${visible.env.length === 1 ? "y" : "ies"}.\n`);
  },

  async envReplace(nest, [slug, path], flags, out, deps) {
    const entries = envEntriesFromFile(path);
    const data = await nest.setEnvVars(await projectId(nest, slug), { envVars: entries, confirmName: flags.confirm });
    return printData(data, flags, deps, out, (visible) => `Replaced the environment with ${visible.env.length} entr${visible.env.length === 1 ? "y" : "ies"}; removed ${visible.deleted.length}.\n`);
  },

  async envDelete(nest, [slug, path], flags, out, deps) {
    const keys = envKeysFromFile(path);
    const target = validateTarget(flags.target);
    const data = await nest.deleteEnvVars(await projectId(nest, slug), {
      keys,
      confirmName: flags.confirm,
      ...(target ? { target } : {}),
    });
    return printData(data, flags, deps, out, (visible) => `Removed ${visible.deleted.map((item) => `${item.key} (${item.target})`).join(", ") || "no entries"}.\n`);
  },

  async envSetsList(nest, _args, flags, out, deps) {
    const data = await callRegisteredOperation(nest, "list_environments");
    return printData(data, flags, deps, out, (visible) => visible.environments.length === 0
      ? "No shared environment sets.\n"
      : table(["ID", "NAME", "DEFAULT"], visible.environments.map((environment) => [
        environment.id,
        clean(environment.name),
        environment.isDefault ? "yes" : "no",
      ])));
  },

  async envSetsCreate(nest, _args, flags, out, deps) {
    const data = await callRegisteredOperation(nest, "create_environment", { name: flags.name });
    return printData(data, flags, deps, out, (visible) => `Created environment ${clean(visible.environment.name)} (${visible.environment.id}).\n`);
  },

  async envSetsRename(nest, [environmentId], flags, out, deps) {
    const data = await callRegisteredOperation(nest, "rename_environment", { environmentId, name: flags.name });
    return printData(data, flags, deps, out, (visible) => `Renamed environment ${environmentId} to ${clean(visible.environment.name)}.\n`);
  },

  async envSetsDelete(nest, [environmentId], flags, out, deps) {
    const data = await callRegisteredOperation(nest, "delete_environment", { environmentId, confirmName: flags.confirm });
    return printData(data, flags, deps, out, (visible) => `Deleted environment ${clean(visible.deleted.name)}.\n`);
  },

  async envSetsDefault(nest, [environmentId], flags, out, deps) {
    const data = await callRegisteredOperation(nest, "set_default_environment", { environmentId });
    return printData(data, flags, deps, out, (visible) => `Set ${clean(visible.environment.name)} as the default shared environment.\n`);
  },

  async envSharedList(nest, [environmentId], flags, out, deps) {
    const data = await callRegisteredOperation(nest, "get_shared_env_vars", { environmentId });
    return printData(data, flags, deps, out, (visible) => visible.env.length === 0
      ? "No shared variables.\n"
      : table(["KEY", "TARGET"], visible.env.map((entry) => [entry.key, entry.target])));
  },

  async envSharedAdd(nest, [environmentId, path], flags, out, deps) {
    const envVars = envEntriesFromFile(path, validateTarget(flags.target));
    const data = await callRegisteredOperation(nest, "add_shared_env_vars", { environmentId, envVars });
    return printData(data, flags, deps, out, (visible) => `Added or replaced ${visible.env.length} shared variable entr${visible.env.length === 1 ? "y" : "ies"}.\n`);
  },

  async envSharedReplace(nest, [environmentId, path], flags, out, deps) {
    const envVars = envEntriesFromFile(path);
    const data = await callRegisteredOperation(nest, "set_shared_env_vars", {
      environmentId,
      envVars,
      confirmName: flags.confirm,
    });
    return printData(data, flags, deps, out, (visible) => `Replaced shared variables with ${visible.env.length} entr${visible.env.length === 1 ? "y" : "ies"}; removed ${visible.deleted.length}.\n`);
  },

  async envSharedDelete(nest, [environmentId, path], flags, out, deps) {
    const keys = envKeysFromFile(path);
    const target = validateTarget(flags.target);
    const data = await callRegisteredOperation(nest, "delete_shared_env_vars", {
      environmentId,
      keys,
      confirmName: flags.confirm,
      ...(target ? { target } : {}),
    });
    return printData(data, flags, deps, out, (visible) => `Removed ${visible.deleted.length} shared variable entr${visible.deleted.length === 1 ? "y" : "ies"}.\n`);
  },

  async jobsList(nest, [slug], flags, out, deps) {
    const data = await nest.listJobs(await projectId(nest, slug));
    return printData(data, flags, deps, out, (visible) => visible.jobs.length === 0
      ? "No scheduled jobs.\n"
      : table(["ID", "NAME", "SCHEDULE (UTC)", "ENABLED", "NEXT RUN"], visible.jobs.map((job) => [
        job.id,
        clean(job.name),
        job.schedule,
        job.enabled ? "yes" : "no",
        job.nextRunAt ?? "-",
      ])));
  },

  async jobsShow(nest, [slug, jobId], flags, out, deps) {
    const data = await nest.getJob(await projectId(nest, slug), jobId);
    return printData(data, flags, deps, out, (visible) => {
      const job = visible.job;
      return [
        `Id        ${job.id}`,
        `Name      ${clean(job.name)}`,
        `Schedule  ${job.schedule} (UTC)`,
        `Enabled   ${job.enabled ? "yes" : "no"}`,
        `Next run  ${job.nextRunAt ?? "-"}`,
        `Command   ${clean(job.command)}`,
        "",
      ].join("\n");
    });
  },

  async jobsCreate(nest, [slug], flags, out, deps) {
    const enabled = booleanOption(flags.enabled, "enabled");
    const data = await nest.createJob(await projectId(nest, slug), {
      name: flags.name,
      schedule: flags.schedule,
      command: flags.command,
      ...(enabled === undefined ? {} : { enabled }),
    });
    return printData(data, flags, deps, out, (visible) => `Created scheduled job ${clean(visible.job.name)} (${visible.job.id}).\n`);
  },

  async jobsUpdate(nest, [slug, jobId], flags, out, deps) {
    const changes = {};
    for (const key of ["name", "schedule", "command"]) if (flags[key] !== undefined) changes[key] = flags[key];
    const enabled = booleanOption(flags.enabled, "enabled");
    if (enabled !== undefined) changes.enabled = enabled;
    if (Object.keys(changes).length === 0) throw new UsageError("jobs update needs at least one field to change.");
    const data = await nest.updateJob(await projectId(nest, slug), jobId, changes);
    return printData(data, flags, deps, out, (visible) => `Updated scheduled job ${clean(visible.job.name)}.\n`);
  },

  async jobsRun(nest, [slug, jobId], flags, out, deps) {
    const project = await projectId(nest, slug);
    const data = await requestWithClient(
      nest,
      "POST",
      `/projects/${encodeURIComponent(project)}/jobs/${encodeURIComponent(jobId)}/run`,
      {},
      { confirmName: flags.confirm }
    );
    return printData(data, flags, deps, out, (visible) => visible.started ? `Started scheduled job ${jobId}.\n` : `Scheduled job ${jobId} was not started.\n`);
  },

  async jobsRuns(nest, [slug, jobId], flags, out, deps) {
    const data = await nest.listJobRuns(await projectId(nest, slug), jobId);
    return printData(data, flags, deps, out, (visible) => visible.runs.length === 0
      ? `No status is available for job ${jobId}.\n`
      : table(["STATE", "EXIT CODE", "LAST ENDED"], visible.runs.map((run) => [run.state, run.exitCode ?? "-", run.lastEndedAt ?? "-"])));
  },

  async jobsLogs(nest, [slug, jobId], flags, out, deps) {
    const project = await projectId(nest, slug);
    const data = await callRegisteredOperation(nest, "get_job_run_logs", {
      projectId: project,
      jobId,
      runId: jobId,
    });
    return printData(data, flags, deps, out, (visible) => visible.lines.length === 0
      ? `No output is available for job ${jobId}.\n`
      : `${visible.lines.map(clean).join("\n")}\n`);
  },

  async jobsCancel(nest, [slug, jobId], flags, out, deps) {
    const project = await projectId(nest, slug);
    const data = await callRegisteredOperation(nest, "cancel_job_run", {
      projectId: project,
      jobId,
      runId: jobId,
    });
    return printData(data, flags, deps, out, (visible) => `${visible.note}\n`);
  },

  async jobsDelete(nest, [slug, jobId], flags, out, deps) {
    const project = await projectId(nest, slug);
    const data = await requestWithClient(
      nest,
      "DELETE",
      `/projects/${encodeURIComponent(project)}/jobs/${encodeURIComponent(jobId)}`,
      {},
      { confirmName: flags.confirm }
    );
    return printData(data, flags, deps, out, () => `Deleted scheduled job ${jobId}.\n`);
  },

  async opsStart(nest, [id], flags, out, deps) {
    const data = await callRegisteredOperation(nest, "start_deployment", { deploymentId: id });
    return printData(data, flags, deps, out, (visible) => `${clean(visible.output)}\n`);
  },

  async opsStop(nest, [id], flags, out, deps) {
    const data = await callRegisteredOperation(nest, "stop_deployment", { deploymentId: id });
    return printData(data, flags, deps, out, (visible) => `${clean(visible.output)}\n`);
  },

  async opsRestart(nest, [id], flags, out, deps) {
    const data = await callRegisteredOperation(nest, "restart_deployment", { deploymentId: id });
    return printData(data, flags, deps, out, (visible) => `${clean(visible.output)}\n`);
  },

  async opsScale(nest, [id], flags, out, deps) {
    const changes = {};
    if (flags.memoryMb !== undefined) changes.memoryMb = boundedIntegerOption(flags, "memoryMb", 128, 32768);
    if (flags.cpuPercent !== undefined) changes.cpuPercent = boundedIntegerOption(flags, "cpuPercent", 1, 6400);
    if (Object.keys(changes).length === 0) throw new UsageError("ops scale needs --memory-mb, --cpu-percent, or both.");
    const data = await callRegisteredOperation(nest, "scale_deployment", { deploymentId: id, ...changes });
    return printData(data, flags, deps, out, (visible) => `${clean(visible.output)}\n`);
  },

  async opsVolumes(nest, [id], flags, out, deps) {
    const data = await callRegisteredOperation(nest, "get_volumes", { deploymentId: id });
    return printData(data, flags, deps, out, (visible) => visible.volumes.length === 0
      ? "No Docker volumes for this deployment.\n"
      : `${visible.volumes.map(clean).join("\n")}\n`);
  },

  async domainsList(nest, _args, flags, out, deps) {
    const data = await nest.listDomains();
    return printData(data, flags, deps, out, (visible) => visible.domains.length === 0
      ? "No domains yet.\n"
      : table(["DOMAIN", "STATUS", "PROJECT", "PORT"], visible.domains.map((domain) => [domain.domain, domain.status, dash(domain.projectName), domain.port])));
  },

  async domainsAdd(nest, [domain], flags, out, deps) {
    const input = {
      serverId: flags.server,
      domain,
      port: numberOption(flags, "port"),
      ...(flags.project ? { projectId: await projectId(nest, flags.project) } : {}),
    };
    const data = await nest.addDomain(input);
    return printData(data, flags, deps, out, (visible) => {
      const lines = [`Added domain ${visible.domain.domain}.`];
      for (const step of visible.instructions?.steps ?? []) lines.push(`- ${step}`);
      if (visible.instructions?.cname) lines.push(`CNAME ${visible.instructions.cname.name} -> ${visible.instructions.cname.value}`);
      if (visible.instructions?.txt) lines.push(`TXT ${visible.instructions.txt.name} = ${visible.instructions.txt.value}`);
      return `${lines.join("\n")}\n`;
    });
  },

  async domainsRemove(nest, [name], flags, out, deps) {
    const id = await domainId(nest, name);
    const data = await nest.removeDomain(id);
    return printData(data, flags, deps, out, () => `Removed domain ${name}.\n`);
  },

  async domainsValidate(nest, [name], flags, out, deps) {
    const id = await domainId(nest, name);
    const data = await nest.verifyDomain(id);
    return printData(data, flags, deps, out, (visible) => `Domain ${name}: ${visible.status}${visible.reason ? ` (${visible.reason})` : ""}.\n`);
  },

  async notifyList(nest, [slug], flags, out, deps) {
    const data = await nest.getNotifications(await projectId(nest, slug));
    return printData(data, flags, deps, out, (visible) => {
      const item = visible.notifications;
      return item.configured ? `${item.kind} notifications (${item.on}).\n` : "No notification channel configured.\n";
    });
  },

  async notifyTest(nest, [slug], flags, out, deps) {
    const data = await nest.testNotification(await projectId(nest, slug));
    return printData(data, flags, deps, out, (visible) => visible.sent ? "Test notification sent.\n" : "Test notification was not sent.\n");
  },

  async status(nest, _args, flags, out, deps, fail$) {
    const { servers } = await nest.listServers();
    const results = [];
    for (const server of servers) {
      try {
        results.push({ server, usage: (await nest.getServerUsage(server.id)).usage });
      } catch (error) {
        results.push({ server, usage: null, error: describeError(error), failure: error });
      }
    }
    const data = { servers: results.map((result) => ({ ...result.server, usage: result.usage, ...(result.error ? { error: result.error } : {}) })) };
    if (flags.json || !deps.isTTY) out(json(redactSecrets(data, flags.showSecrets)));
    else if (results.length === 0) out("No servers yet.\n");
    else for (const result of results) if (result.usage) out(describeUsage(result.server, result.usage));
    const broken = results.filter((result) => result.error);
    if (broken.length > 0) {
      const primary = broken[0];
      const failure = Object.assign(new Error(`Could not read ${clean(primary.server.host)}: ${primary.failure?.message ?? primary.error}`), {
        status: primary.failure?.status,
        code: primary.failure?.code,
        retryAfterSeconds: primary.failure?.retryAfterSeconds,
      });
      fail$(broken.map((result) => `Could not read ${clean(result.server.host)}: ${result.error}`).join("\n"), failure);
    }
  },
};

function describeError(error) {
  const status = error && typeof error.status === "number" ? error.status : null;
  const code = error && typeof error.code === "string" ? error.code : null;
  const message = error && typeof error.message === "string" ? error.message : String(error);
  const where = status ? `HTTP ${status}, ${code}` : code;
  const wait = error && error.retryAfterSeconds ? ` Try again in ${error.retryAfterSeconds} seconds.` : "";
  return `${message}${where ? ` (${where})` : ""}${wait}`;
}

function exitCodeFor(error) {
  if (error instanceof UsageError) return 2;
  if (error instanceof TimeoutFailure || error?.code === "timeout" || error?.status === 408) return 8;
  if (error instanceof NotFound || error?.status === 404) return 4;
  if (error?.status === 401 || error?.code === "missing_token") return 3;
  if (error?.status === 429) return 6;
  if (typeof error?.status === "number" && error.status >= 500) return 7;
  return 1;
}

async function loadClient() {
  // web/package.json has no "type" field, so Node warns once that it reparses the client as
  // an ES module. The warning is noise for someone using the CLI: drop that one warning only.
  const emit = process.emitWarning;
  process.emitWarning = (warning, ...rest) => {
    const code = typeof rest[0] === "object" && rest[0] !== null ? rest[0].code : rest[1];
    if (code !== "MODULE_TYPELESS_PACKAGE_JSON") emit.call(process, warning, ...rest);
  };
  try {
    return (await import("../src/lib/sdk/egg.ts")).Egg;
  } catch {
    throw new Failure(
      "This Node cannot run the TypeScript client. Use Node 22.18 or newer, or run: npx tsx scripts/egg-cli.mjs <command>"
    );
  } finally {
    process.emitWarning = emit;
  }
}

/**
 * Run the CLI and return the exit code. Everything it touches is passed in, so tests can
 * give it a fake fetch and capture the output: `{ env, fetch, stdout, stderr, sleep, pollMs }`.
 */
const COMMAND_RUNNERS = Object.assign({}, BASE_COMMAND_RUNNERS, ...GROUPS.map((group) => group.runners));
const KIT = { printData, table, clean, dash, json, redactSecrets, UsageError, Failure, NotFound, TimeoutFailure };

export async function run(argv, deps = {}) {
  const env = deps.env ?? process.env;
  const stdout = deps.stdout ?? process.stdout;
  const stderr = deps.stderr ?? process.stderr;
  const isTTY = deps.isTTY ?? stdout.isTTY ?? false;
  const jsonMode = (flags) => Boolean(flags?.json || !isTTY);
  const parsed = parseCli(argv);
  const token = (parsed.ok ? parsed.flags.token : undefined) ?? env.EGG_TOKEN ?? "";
  const selectedToken = String(token).trim();
  const secrets = [selectedToken, String(env.EGG_TOKEN ?? "").trim()];
  if (parsed.ok && parsed.command === "env set") secrets.push(parsed.args[2]);
  const hide = (text) => secrets.filter(Boolean).reduce((result, secret) => result.split(secret).join("[hidden]"), clean(text));
  const out = (text) => void stdout.write(hide(text));
  const err = (text) => void stderr.write(hide(text.endsWith("\n") ? text : `${text}\n`));
  const full = {
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    now: () => Date.now(),
    pollMs: POLL_MS,
    ...deps,
    isTTY,
  };
  const printError = (error, flags = {}) => {
    const code = exitCodeFor(error);
    const message = error instanceof Error ? error.message : String(error);
    if (jsonMode(flags)) {
      const status = typeof error?.status === "number" ? error.status : 0;
      err(`${JSON.stringify({ error: { status, code, message: clean(message) } })}\n`);
    } else {
      err(`Error: ${error instanceof UsageError ? message : describeError(error)}\n`);
    }
    return code;
  };

  if (!parsed.ok) {
    return printError(new UsageError(parsed.message));
  }
  if (parsed.command === "help") {
    out(USAGE);
    return 0;
  }

  // Commands marked offline: true run without a token or server, and get no client.
  const offline = COMMANDS.find((command) => command.name === parsed.command && command.offline);
  if (offline) {
    try {
      let deferredOffline = null;
      await COMMAND_RUNNERS[offline.runner](null, parsed.args, parsed.flags, out, full, (message, error) => {
        deferredOffline = error ?? new Failure(message);
      }, KIT);
      if (deferredOffline) throw deferredOffline;
      return 0;
    } catch (error) {
      return printError(error, parsed.flags);
    }
  }
  if (LOCAL_COMMANDS.has(parsed.command)) {
    // `deps.local` lets tests replace the machine-touching parts of these two commands.
    const local = { out, ...deps.local };
    try {
      return parsed.command === "start" ? await startEgg({ dev: Boolean(parsed.flags.dev), ...local }) : await doctorCommand(local);
    } catch (error) {
      return printError(error, parsed.flags);
    }
  }

  try {
    const baseUrl = String(parsed.flags.url ?? env.EGG_URL ?? "").trim();
    if (!selectedToken) throw Object.assign(new Failure("Set EGG_TOKEN or pass --token with your personal access token."), { code: "missing_token" });
    if (!baseUrl) throw new UsageError("Set EGG_URL or pass --url with your Egg address, such as https://deploy.example.com.");
    const Egg = await loadClient();
    const nest = new Egg({ token: selectedToken, baseUrl, fetch: deps.fetch, timeoutMs: deps.timeoutMs });
    const spec = COMMANDS.find((command) => command.name === parsed.command);
    let deferredFailure = null;
    await COMMAND_RUNNERS[spec.runner](nest, parsed.args, parsed.flags, out, full, (message, error) => {
      deferredFailure = error ?? new Failure(message);
    }, KIT);
    if (deferredFailure) throw deferredFailure;
    return 0;
  } catch (error) {
    return printError(error, parsed.flags);
  }
}

// ------------------------------------------------------------------ entry point

function isMain() {
  try {
    return Boolean(process.argv[1]) && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isMain()) {
  run(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (error) => {
      process.stderr.write(`Error: ${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    }
  );
}
