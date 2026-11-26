import { HttpError } from "@/server/http";

export type Score = {
  ports: { name: string; port: number; protocol?: "tcp" | "udp" }[];
  variables: { name: string; value: string }[];
  databases: { name: string; type: "postgres" | "mysql" | "redis"; version?: string }[];
};

const roots = new Set(["ports", "variables", "databases"]);
const fields: Record<keyof Score, Set<string>> = {
  ports: new Set(["name", "port", "protocol"]),
  variables: new Set(["name", "value"]),
  databases: new Set(["name", "type", "version"]),
};
const fail = (message: string): never => { throw new HttpError(400, `Invalid score.yaml: ${message}`, "validation"); };

// Parse the intentionally small YAML data subset Score supports. Indentation is
// significant; tags, aliases, directives, duplicate keys and flow YAML are refused.
function parseYaml(source: string): unknown {
  if (source.length > 200_000) return fail("file is larger than 200 KB.");
  const lines = source.replace(/^\uFEFF/, "").split(/\r?\n/).map((raw, index) => {
    if (/\t/.test(raw)) fail(`tabs are not allowed (line ${index + 1}).`);
    const text = raw.trim();
    if (!text || text.startsWith("#")) return null;
    const indent = raw.length - raw.trimStart().length;
    if (indent % 2) fail(`indentation must use pairs of spaces (line ${index + 1}).`);
    if (/[&*!]|(?:^|\s)<<\s*:/.test(text)) fail(`YAML tags, aliases and merge keys are not allowed (line ${index + 1}).`);
    return { indent, text, line: index + 1 };
  }).filter((line): line is { indent: number; text: string; line: number } => line !== null);
  if (!lines.length) return {};
  let cursor = 0;
  const scalar = (text: string, line: number): unknown => {
    const value = text.trim();
    if (!value) return fail(`missing value (line ${line}).`);
    if (value.startsWith("[") || value.startsWith("{")) {
      try { return JSON.parse(value); } catch { return fail(`flow values must use valid JSON (line ${line}).`); }
    }
    if (value.startsWith("'") && value.endsWith("'") && value.length >= 2) return value.slice(1, -1).replace(/''/g, "'");
    if (value.startsWith('"')) { try { return JSON.parse(value); } catch { return fail(`invalid quoted string (line ${line}).`); } }
    if (/[:#]|\s#/.test(value)) return fail(`quote strings containing YAML punctuation (line ${line}).`);
    if (/^(?:null|~)$/i.test(value)) return null;
    if (/^(?:true|false)$/i.test(value)) return value.toLowerCase() === "true";
    if (/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)) return Number(value);
    return value;
  };
  const pair = (text: string, line: number) => {
    const m = /^([A-Za-z][A-Za-z0-9_-]*):(?:\s+(.*)|\s*)$/.exec(text);
    if (!m) return fail(`expected a key and value (line ${line}).`);
    return [m[1], m[2] ?? ""] as const;
  };
  const block = (indent: number): unknown => {
    const sequence = lines[cursor]?.text.startsWith("-");
    if (sequence) {
      const out: unknown[] = [];
      while (cursor < lines.length && lines[cursor].indent === indent && lines[cursor].text.startsWith("-")) {
        const current = lines[cursor++];
        if (current.text !== "-" && !current.text.startsWith("- ")) return fail(`invalid sequence item (line ${current.line}).`);
        const rest = current.text.slice(1).trim();
        if (!rest) { if (cursor >= lines.length || lines[cursor].indent <= indent) return fail(`empty sequence item (line ${current.line}).`); out.push(block(indent + 2)); }
        else if (/^[A-Za-z][A-Za-z0-9_-]*:/.test(rest)) {
          const [key, rawValue] = pair(rest, current.line); const item: Record<string, unknown> = {};
          item[key] = rawValue ? scalar(rawValue, current.line) : cursor < lines.length && lines[cursor].indent > indent + 2 ? block(indent + 4) : null;
          if (cursor < lines.length && lines[cursor].indent === indent + 2) {
            const extra = block(indent + 2);
            if (!extra || typeof extra !== "object" || Array.isArray(extra)) return fail(`expected object fields (line ${current.line}).`);
            for (const key of Object.keys(extra)) if (Object.hasOwn(item, key)) fail(`duplicate key "${key}" (line ${current.line}).`);
            Object.assign(item, extra);
          }
          out.push(item);
        } else out.push(scalar(rest, current.line));
      }
      return out;
    }
    const out: Record<string, unknown> = {};
    while (cursor < lines.length && lines[cursor].indent === indent && !lines[cursor].text.startsWith("-")) {
      const current = lines[cursor++]; const [key, rawValue] = pair(current.text, current.line);
      if (Object.hasOwn(out, key)) return fail(`duplicate key "${key}" (line ${current.line}).`);
      if (rawValue) out[key] = scalar(rawValue, current.line);
      else if (cursor < lines.length && lines[cursor].indent > indent) out[key] = block(indent + 2);
      else out[key] = null;
    }
    return out;
  };
  const result = block(lines[0].indent);
  if (cursor !== lines.length) return fail(`unexpected indentation (line ${lines[cursor].line}).`);
  return result;
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fail(`${label} must be an object.`);
  return value as Record<string, unknown>;
}
function safeName(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^[A-Za-z][A-Za-z0-9_-]{0,62}$/.test(value)) return fail(`${label} must be a valid identifier.`);
  return value;
}
function allowedKeys(value: Record<string, unknown>, allowed: Set<string>, label: string) {
  for (const key of Object.keys(value)) if (!allowed.has(key)) fail(`${label} field "${key}" is not supported.`);
}

export function parseScore(source: string): Score {
  const raw = record(parseYaml(source), "document");
  allowedKeys(raw, roots, "root");
  const list = <T>(key: keyof Score, parse: (item: unknown, i: number) => T): T[] => {
    const value = raw[key];
    if (value === undefined) return [];
    if (!Array.isArray(value)) return fail(`${key} must be a list.`);
    return value.map(parse);
  };
  const names = (items: { name: string }[], kind: string) => {
    const seen = new Set<string>();
    for (const item of items) { const k = item.name.toLowerCase(); if (seen.has(k)) fail(`${kind} name "${item.name}" is duplicated.`); seen.add(k); }
  };
  const ports = list("ports", (value, i) => {
    const item = record(value, `ports[${i}]`); allowedKeys(item, fields.ports, `ports[${i}]`);
    if (!Number.isInteger(item.port) || (item.port as number) < 1 || (item.port as number) > 65535) return fail(`ports[${i}].port must be an integer from 1 to 65535.`);
    if (item.protocol !== undefined && item.protocol !== "tcp" && item.protocol !== "udp") return fail(`ports[${i}].protocol must be tcp or udp.`);
    return { name: safeName(item.name, `ports[${i}].name`), port: item.port as number, ...(item.protocol ? { protocol: item.protocol as "tcp" | "udp" } : {}) };
  }); names(ports, "port");
  const variables = list("variables", (value, i) => {
    const item = record(value, `variables[${i}]`); allowedKeys(item, fields.variables, `variables[${i}]`);
    if (typeof item.value !== "string" || item.value.length > 4096 || /[\u0000\r\n]/.test(item.value)) return fail(`variables[${i}].value must be a single-line string of at most 4096 characters.`);
    return { name: safeName(item.name, `variables[${i}].name`), value: item.value };
  }); names(variables, "variable");
  const databases = list("databases", (value, i) => {
    const item = record(value, `databases[${i}]`); allowedKeys(item, fields.databases, `databases[${i}]`);
    if (item.type !== "postgres" && item.type !== "mysql" && item.type !== "redis") return fail(`databases[${i}].type must be postgres, mysql or redis.`);
    if (item.version !== undefined && (typeof item.version !== "string" || !/^[0-9][A-Za-z0-9._-]{0,31}$/.test(item.version))) return fail(`databases[${i}].version must be a version string.`);
    return { name: safeName(item.name, `databases[${i}].name`), type: item.type as "postgres" | "mysql" | "redis", ...(item.version ? { version: item.version as string } : {}) };
  }); names(databases, "database");
  return { ports, variables, databases };
}

export function previewScore(score: Score) {
  return { ports: score.ports, variables: score.variables.map(({ name }) => ({ name, action: "set" as const })), databases: score.databases };
}
