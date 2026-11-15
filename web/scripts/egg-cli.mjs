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
// Exit codes: 0 done, 1 failed (the server said no, the network failed, a project was
// not found, a followed deployment failed), 2 wrong use (bad arguments, missing
// EGG_TOKEN or EGG_URL). The token is only ever sent as the bearer header: it is not
// printed, and if a server echoes it back, it is replaced by [hidden].

import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

const FINAL_STATES = new Set(["ready", "error", "canceled"]);
const POLL_MS = 2000;

// ---------------------------------------------------------------------- usage

export const USAGE = `Egg command line

Usage: egg <command> [options]

Commands:
  egg whoami                          Who the token belongs to, its scopes and expiry
  egg projects list                   List your projects
  egg projects show <slug>            Show one project
  egg deploy <slug> [--branch <name>] Queue a deployment (default: the production branch)
  egg deployments list <slug>         List a project's deployments, newest first
  egg logs <deployment-id> [--follow] Print a deployment's build log; --follow waits for the end
  egg rollback <deployment-id>        Point production back at an earlier deployment
  egg env names <slug>                List environment variable names (never values)
  egg domains list                    List your domains
  egg status                          CPU, memory and disk use of your servers

Options:
  --json        Print the API answer as JSON instead of text
  -h, --help    Show this help

Environment:
  EGG_TOKEN     Your personal access token (starts with egg_). Never printed.
  EGG_URL       Your Egg address, such as https://deploy.example.com

Exit codes: 0 done, 1 failed, 2 wrong use.
`;

// -------------------------------------------------------------------- parsing

/** Which commands exist, how many arguments each takes, and which options only it accepts. */
const COMMANDS = {
  whoami: { args: [], options: [] },
  "projects list": { args: [], options: [] },
  "projects show": { args: ["a project slug"], options: [] },
  deploy: { args: ["a project slug"], options: ["branch"] },
  "deployments list": { args: ["a project slug"], options: [] },
  logs: { args: ["a deployment id"], options: ["follow"] },
  rollback: { args: ["a deployment id"], options: [] },
  "env names": { args: ["a project slug"], options: [] },
  "domains list": { args: [], options: [] },
  status: { args: [], options: [] },
};

const GROUPS = ["projects", "deployments", "env", "domains"];
const VALUE_OPTIONS = new Set(["branch"]);
const FLAG_OPTIONS = new Set(["json", "follow", "help"]);

const fail = (message) => ({ ok: false, message });

/**
 * Turn the arguments into `{ ok: true, command, args, flags }`, or `{ ok: false, message }`.
 * Options may come before or after the command. `--branch=x` and `--branch x` both work.
 */
export function parseCli(argv) {
  const flags = { json: false, follow: false, help: false, branch: undefined };
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
    const name = token === "-h" ? "help" : token.replace(/^--/, "").split("=")[0];
    if (!token.startsWith("--") && token !== "-h") return fail(`Unknown option ${token}.`);
    if (VALUE_OPTIONS.has(name)) {
      const inline = token.includes("=") ? token.slice(token.indexOf("=") + 1) : undefined;
      const value = inline ?? argv[++i];
      if (value === undefined || value === "" || (inline === undefined && value.startsWith("--"))) {
        return fail(`--${name} needs a value, such as --${name} main.`);
      }
      flags[name] = value;
    } else if (FLAG_OPTIONS.has(name) && !token.includes("=")) {
      flags[name] = true;
    } else {
      return fail(`Unknown option ${token}.`);
    }
  }

  if (flags.help || words[0] === "help") return { ok: true, command: "help", args: [], flags };
  if (words.length === 0) return fail("Say what to do, such as egg projects list.");

  let command = words[0];
  let rest = words.slice(1);
  if (GROUPS.includes(command)) {
    const choices = Object.keys(COMMANDS).filter((c) => c.startsWith(`${command} `));
    const full = `${command} ${rest[0] ?? ""}`;
    if (!COMMANDS[full]) return fail(`Use one of: ${choices.map((c) => `egg ${c}`).join(", ")}.`);
    command = full;
    rest = rest.slice(1);
  } else if (!COMMANDS[command]) {
    return fail(`Unknown command "${command}".`);
  }

  const spec = COMMANDS[command];
  for (const option of ["branch", "follow"]) {
    const given = option === "branch" ? flags.branch !== undefined : flags.follow;
    if (given && !spec.options.includes(option)) {
      const owner = Object.entries(COMMANDS).find(([, s]) => s.options.includes(option))[0];
      return fail(`--${option} only works with egg ${owner}.`);
    }
  }
  if (rest.length < spec.args.length) return fail(`egg ${command} needs ${spec.args[rest.length]}.`);
  if (rest.length > spec.args.length) return fail(`Too many arguments for egg ${command}.`);
  return { ok: true, command, args: rest, flags };
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

/** A project's slug (or id) to its id. The API wants ids. */
async function projectId(nest, slugOrId) {
  const { projects } = await nest.listProjects();
  const found = projects.find((p) => p.slug === slugOrId) ?? projects.find((p) => p.id === slugOrId);
  if (!found) throw new Failure(`No project with the slug "${slugOrId}". Run egg projects list to see yours.`);
  return found.id;
}

const deploymentLine = (d) => `${d.id} (${d.env}, ${d.branch}, ${d.state})`;

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
  async whoami(nest, _args, flags, out) {
    const me = await nest.me();
    if (flags.json) return out(json(me));
    out(
      [
        `User      ${clean(me.user.name)}`,
        `Token     ${clean(me.token.name)}`,
        `Scopes    ${me.token.scopes.join(", ") || "none"}`,
        `Expires   ${me.token.expiresAt}`,
        `Servers   ${me.counts.servers}`,
        `Projects  ${me.counts.projects}`,
        "",
      ].join("\n")
    );
  },

  async "projects list"(nest, _args, flags, out) {
    const data = await nest.listProjects();
    if (flags.json) return out(json(data));
    if (data.projects.length === 0) return out("No projects yet.\n");
    out(table(["SLUG", "NAME", "STATE", "MONITOR", "BRANCH"], data.projects.map((p) => [p.slug, clean(p.name), p.state ?? "none", p.monitor, p.branch])));
  },

  async "projects show"(nest, [slug], flags, out) {
    const data = await nest.getProject(await projectId(nest, slug));
    if (flags.json) return out(json(data));
    const p = data.project;
    out(
      [
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
      ].join("\n")
    );
  },

  async deploy(nest, [slug], flags, out) {
    const data = await nest.deploy(await projectId(nest, slug), flags.branch ? { branch: flags.branch } : {});
    if (flags.json) return out(json(data));
    const d = data.deployment;
    out(`Queued deployment ${deploymentLine(d)}.\nFollow the build: egg logs ${d.id} --follow\n`);
  },

  async "deployments list"(nest, [slug], flags, out) {
    const data = await nest.listDeployments(await projectId(nest, slug));
    if (flags.json) return out(json(data));
    if (data.deployments.length === 0) return out("No deployments yet.\n");
    out(
      table(
        ["ID", "STATE", "ENV", "BRANCH", "SHA", "CREATED", "DURATION"],
        data.deployments.map((d) => [
          d.id,
          d.state,
          d.env,
          clean(d.branch),
          d.sha ? d.sha.slice(0, 7) : "-",
          d.createdAt,
          d.durationMs === null ? "-" : `${Math.round(d.durationMs / 1000)}s`,
        ])
      )
    );
  },

  async logs(nest, [id], flags, out, deps, fail$) {
    const text = (l) => `${l.at}  ${l.level.padEnd(5)}  ${clean(l.message)}\n`;
    const emit = (l) => out(flags.json ? JSON.stringify(l) + "\n" : text(l));

    if (!flags.follow) {
      if (!flags.json) return void (await printLogs(nest, id, 0, emit));
      const lines = [];
      await printLogs(nest, id, 0, (l) => lines.push(l));
      return out(json({ deploymentId: id, lines }));
    }

    let after = 0;
    for (;;) {
      after = await printLogs(nest, id, after, emit);
      const { deployment } = await nest.getDeployment(id);
      if (FINAL_STATES.has(deployment.state)) {
        await printLogs(nest, id, after, emit);
        if (deployment.state === "ready") return;
        const why = deployment.error ? `: ${clean(deployment.error)}` : "";
        return fail$(`Deployment ${id} finished with state ${deployment.state}${why}`);
      }
      await deps.sleep(deps.pollMs);
    }
  },

  async rollback(nest, [id], flags, out) {
    const data = await nest.rollback(id);
    if (flags.json) return out(json(data));
    out(`Queued a rollback to ${id} as deployment ${deploymentLine(data.deployment)}.\nFollow it: egg logs ${data.deployment.id} --follow\n`);
  },

  async "env names"(nest, [slug], flags, out) {
    const data = await nest.listEnvNames(await projectId(nest, slug));
    if (flags.json) return out(json(data));
    if (data.env.length === 0) return out("No environment variables.\n");
    out(table(["KEY", "TARGET"], data.env.map((e) => [e.key, e.target])));
  },

  async "domains list"(nest, _args, flags, out) {
    const data = await nest.listDomains();
    if (flags.json) return out(json(data));
    if (data.domains.length === 0) return out("No domains yet.\n");
    out(table(["DOMAIN", "STATUS", "PROJECT", "PORT"], data.domains.map((d) => [clean(d.domain), d.status, dash(clean(d.projectName)), d.port])));
  },

  async status(nest, _args, flags, out, _deps, fail$) {
    const { servers } = await nest.listServers();
    const results = [];
    for (const server of servers) {
      try {
        results.push({ server, usage: (await nest.getServerUsage(server.id)).usage });
      } catch (error) {
        results.push({ server, usage: null, error: describeError(error) });
      }
    }
    if (flags.json) {
      out(json({ servers: results.map((r) => ({ ...r.server, usage: r.usage, ...(r.error ? { error: r.error } : {}) })) }));
    } else if (results.length === 0) {
      out("No servers yet.\n");
    } else {
      for (const r of results) if (r.usage) out(describeUsage(r.server, r.usage));
    }
    const broken = results.filter((r) => r.error);
    if (broken.length > 0) fail$(broken.map((r) => `Could not read ${clean(r.server.host)}: ${r.error}`).join("\n"));
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
  const token = (env.EGG_TOKEN ?? "").trim();
  const hide = (text) => (token ? String(text).split(token).join("[hidden]") : String(text));
  const stdout = deps.stdout ?? process.stdout;
  const stderr = deps.stderr ?? process.stderr;
  const out = (text) => void stdout.write(hide(text));
  const err = (text) => void stderr.write(hide(text.endsWith("\n") ? text : `${text}\n`));
  const full = { sleep: (ms) => new Promise((r) => setTimeout(r, ms)), pollMs: POLL_MS, ...deps };

  const parsed = parseCli(argv);
  if (!parsed.ok) {
    err(`${parsed.message}\n\n${USAGE}`);
    return 2;
  }
  if (parsed.command === "help") {
    out(USAGE);
    return 0;
  }

  let failure = null;
  try {
    const baseUrl = (env.EGG_URL ?? "").trim();
    if (!token) throw new UsageError("Set EGG_TOKEN to your personal access token (it starts with egg_).");
    if (!baseUrl) throw new UsageError("Set EGG_URL to your Egg address, such as https://deploy.example.com.");
    const Egg = await loadClient();
    const nest = new Egg({ token, baseUrl, fetch: deps.fetch });
    await COMMAND_RUNNERS[parsed.command](nest, parsed.args, parsed.flags, out, full, (message) => {
      failure = message;
    });
  } catch (error) {
    if (error instanceof UsageError) {
      err(error.message);
      return 2;
    }
    if (parsed.flags.json && error && typeof error.status === "number") {
      err(JSON.stringify({ error: { status: error.status, code: error.code, message: error.message } }));
      return 1;
    }
    err(`Error: ${error instanceof Failure ? error.message : describeError(error)}`);
    return 1;
  }
  if (failure) {
    err(`Error: ${failure}`);
    return 1;
  }
  return 0;
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
