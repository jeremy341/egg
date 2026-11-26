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

import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { doctorCommand } from "./doctor.mjs";
import { startEgg } from "./egg-start.mjs";

const FINAL_STATES = new Set(["ready", "error", "canceled"]);
const POLL_MS = 2000;

// ---------------------------------------------------------------------- usage

const OPTION_TYPES = {
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
  "root-dir": "value",
  "install-command": "value",
  "build-command": "value",
  "start-command": "value",
  "output-dir": "value",
  "health-path": "value",
  "auto-deploy": "value",
  confirm: "value",
  "remove-from-server": "flag",
  wait: "flag",
  timeout: "value",
  follow: "flag",
  target: "value",
  project: "value",
  dev: "flag",
};

const GLOBAL_OPTIONS = new Set(["json", "show-secrets", "help", "token", "url"]);

/** Canonical command table: parsing and help both derive their command surface from here. */
const COMMANDS = [
  { name: "whoami", args: [], description: "Show the account and token scopes.", runner: "whoami" },
  { name: "projects list", args: [], description: "List your projects.", runner: "projectsList" },
  { name: "projects show", args: ["project"], description: "Show a project by slug or id.", runner: "projectsShow" },
  {
    name: "projects create",
    args: [],
    required: ["name", "server", "repo", "runtime"],
    options: ["name", "server", "repo", "runtime", "slug", "branch", "port"],
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
    name: "projects delete",
    args: ["project"],
    required: ["confirm"],
    options: ["confirm", "remove-from-server"],
    description: "Delete a project after confirming its exact name.",
    runner: "projectsDelete",
  },
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

For asynchronous deployment commands, --wait waits up to --timeout (default 10m).
A timeout may be written as 30s, 5m, or 1h. Piped output is JSON automatically.
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

const COMMAND_RUNNERS = {
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
    const input = {
      name: flags.name,
      serverId: flags.server,
      repoUrl: repositoryUrl(flags.repo),
      runtime: flags.runtime,
      ...(flags.slug ? { slug: flags.slug } : {}),
      ...(flags.branch ? { productionBranch: flags.branch } : {}),
      ...(flags.port !== undefined ? { port: numberOption(flags, "port") } : {}),
    };
    const data = await nest.createProject(input);
    return printData(data, flags, deps, out, (visible) => `Created project ${visible.project.slug} (${visible.project.id}).\n`);
  },

  async projectsUpdate(nest, [slug], flags, out, deps) {
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
    if (flags.autoDeploy !== undefined) {
      if (!["true", "false"].includes(flags.autoDeploy)) throw new UsageError("--auto-deploy must be true or false.");
      changes.autoDeploy = flags.autoDeploy === "true";
    }
    if (Object.keys(changes).length === 0) throw new UsageError("projects update needs at least one setting to change.");
    const data = await nest.updateProject(await projectId(nest, slug), changes);
    return printData(data, flags, deps, out, (visible) => `Updated project ${visible.project.slug}.\n`);
  },

  async projectsDelete(nest, [slug], flags, out, deps) {
    const { projects } = await nest.listProjects();
    const project = projects.find((p) => p.slug === slug) ?? projects.find((p) => p.id === slug);
    if (!project) throw new NotFound(`No project with the slug or id "${slug}".`);
    if (flags.confirm !== project.name) throw new UsageError(`Pass --confirm with the exact project name: ${project.name}`);
    const data = await nest.deleteProject(project.id, { removeFromServer: flags.removeFromServer });
    return printData(data, flags, deps, out, () => `Deleted project ${project.slug}.\n`);
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
    const data = await nest.deleteEnvVar(await projectId(nest, slug), key, target ? { target } : {});
    return printData(data, flags, deps, out, (visible) => `Removed ${visible.deleted.map((item) => item.key).join(", ") || key}.\n`);
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
    });
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
