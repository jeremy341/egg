import { chmodSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

// CLI group "use-claude-api". Orchard source files: use, claude, api.
// Each export is consumed by web/scripts/egg-cli.mjs. Owned by one child at a time.
const contextPath = (env) => env.EGG_CONTEXT_FILE || path.join(homedir(), ".egg", "context.json");

function readContext(file) {
  try {
    const context = JSON.parse(readFileSync(file, "utf8"));
    if (!context || typeof context !== "object" || Array.isArray(context)) return null;
    return Object.fromEntries(["project", "organization", "environment"].flatMap((key) =>
      typeof context[key] === "string" ? [[key, context[key]]] : []));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

function writeContext(file, context) {
  const directory = path.dirname(file);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  writeFileSync(file, `${JSON.stringify(context, null, 2)}\n`, { mode: 0o600 });
  chmodSync(file, 0o600);
}

function parseQuery(value) {
  const separator = value.indexOf("=");
  if (separator < 1) throw new Error("--query must use key=value.");
  return [value.slice(0, separator), value.slice(separator + 1)];
}

export const commands = [
  { name: "use", args: ["project|org"], options: ["org", "env"], description: "Save a local default project, with optional organization and environment.", offline: true, runner: "use" },
  { name: "context show", args: [], options: [], description: "Show the saved local default scope.", offline: true, runner: "contextShow" },
  { name: "context clear", args: [], options: [], description: "Clear the saved local default scope.", offline: true, runner: "contextClear" },
  { name: "api", args: ["method", "path"], options: ["body", "query", "confirm"], description: "Call an Egg API path directly.", runner: "api" },
];

export const optionTypes = {
  org: "value",
  env: "value",
  body: "value",
  query: "value",
  confirm: "value",
};

export const runners = {
  async use(_nest, [project], flags, out, deps) {
    const file = contextPath(deps.env ?? process.env);
    const context = {
      project,
      ...(flags.org ? { organization: flags.org } : {}),
      ...(flags.env ? { environment: flags.env } : {}),
    };
    writeContext(file, context);
    out(`Saved default project ${project}.\n`);
  },

  async contextShow(_nest, _args, flags, out, deps, _fail, kit) {
    const context = readContext(contextPath(deps.env ?? process.env));
    if (!context || Object.keys(context).length === 0) {
      out(flags.json ? kit.json({ message: "No default scope is saved." }) : "No default scope is saved.\n");
      return;
    }
    if (flags.json) out(kit.json(context));
    else {
      out(`Project: ${context.project ?? "-"}\nOrganization: ${context.organization ?? "-"}\nEnvironment: ${context.environment ?? "-"}\n`);
    }
  },

  async contextClear(_nest, _args, _flags, _out, deps) {
    try {
      unlinkSync(contextPath(deps.env ?? process.env));
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  },

  async api(nest, [method, apiPath], flags, out, _deps, _fail, kit) {
    const verb = method.toUpperCase();
    if (!["GET", "POST", "PATCH", "PUT", "DELETE"].includes(verb)) {
      throw new kit.UsageError("API method must be GET, POST, PATCH, PUT or DELETE.");
    }
    if (!apiPath.startsWith("/") || apiPath.includes("?") || apiPath.includes("#")) {
      throw new kit.UsageError("API path must be an absolute path without a query string or fragment.");
    }

    const segments = apiPath.split("/").filter(Boolean);
    const resource = segments.at(-1);
    if (["POST", "PATCH", "PUT", "DELETE"].includes(verb) && (!resource || flags.confirm !== resource)) {
      throw new kit.UsageError(`egg api ${verb} ${apiPath} needs --confirm ${resource ?? "<final-path-segment>"}.`);
    }

    let body;
    if (flags.body) {
      try {
        body = JSON.parse(readFileSync(flags.body, "utf8"));
      } catch (error) {
        throw new kit.UsageError(`Could not read JSON body file: ${error.message}`);
      }
    }
    const query = flags.query ? Object.fromEntries([parseQuery(flags.query)]) : {};
    const response = await nest.rawRequest(verb, apiPath, query, body);
    out(kit.json(response));
  },
};
