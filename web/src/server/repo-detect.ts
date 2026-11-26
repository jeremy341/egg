import { ENV_KEY, RESERVED_ENV } from "@/server/deploy/runtime";
import type { Runtime } from "@/server/db/schema";

/**
 * Work out what a repository is, from the files at its root.
 *
 * Pure: the input is a map of path (relative to the chosen root directory) to
 * text. A path may map to an empty string when the file exists but was not
 * read. Only the files in READ_FILES are ever read; everything else is only
 * noticed by name.
 *
 * Secrets: environment files are parsed for NAMES only. No value from any file
 * is ever returned, logged or stored. A committed .env is reported by file name
 * and is never read at all. requirements.txt is read for package NAMES only,
 * the same way, so a bot framework can be recognised.
 */

export type PackageManager = "npm" | "pnpm" | "yarn" | "bun";
export type Language = "node" | "python" | "go" | "ruby" | "rust" | "php" | "java" | "docker";
export type Framework = "next" | "vite" | "nuxt" | "astro";
export type BotFramework = "discord.js" | "discord.py" | "telegraf" | "slack-bolt" | "python-telegram-bot";

export type DetectedEnv = {
  name: string;
  /** The example file the name came from, or the framework a suggestion is for. */
  source: string;
  /** Whether the example file gives the name a value. The value itself is never returned. */
  hasExampleValue: boolean;
  /** Set for names Egg suggests for a detected bot framework, not for names read from a file. */
  suggested?: boolean;
};

export type Commands = {
  install: string | null;
  build: string | null;
  start: string | null;
};

export type RepoDetection = {
  packageManager: PackageManager | null;
  /** Whether Egg recognises this package manager. */
  packageManagerSupported: boolean;
  language: Language | null;
  framework: Framework | null;
  /** The Egg runtime to use, or null when the repository is not supported yet. */
  runtime: Runtime | null;
  commands: Commands;
  /** Output folder for static sites (vite, astro), else null. */
  outputDir: string | null;
  monorepo: boolean;
  /** Folders that hold their own package.json, offered as root directory choices. */
  candidateRoots: string[];
  /** A bot framework found in the dependencies, when there is one and the repo is not a web app. */
  bot: BotFramework | null;
  /** The workload Egg suggests for the repository: "worker" for a bot, else null. A default, never a lock. */
  suggestedWorkloadKind: "worker" | null;
  /** Token names the detected bot framework reads, ready to add as environment variables. */
  suggestedEnv: DetectedEnv[];
  env: DetectedEnv[];
  /** Names of committed env files, such as ".env". Never their contents. */
  committedEnvFiles: string[];
  /** Things the user should act on. */
  warnings: string[];
  /** Plain statements of what was found or decided. */
  notes: string[];
};

/** Files worth reading from GitHub. Everything else is detected from the tree alone. */
export const ENV_EXAMPLE_FILES = [
  ".env.example",
  ".env.sample",
  ".env.template",
  ".env.local.example",
] as const;
export const READ_FILES: readonly string[] = ["package.json", "requirements.txt", ...ENV_EXAMPLE_FILES];

/**
 * Env files that must not be in a repository. Detected by name only.
 */
export const COMMITTED_ENV_FILES = [".env", ".env.local", ".env.production", ".env.production.local"] as const;

export const COMMITTED_ENV_WARNING =
  "A .env file is committed to this repository. Remove it from git and rotate the values.";

/**
 * Bot frameworks a student actually hosts: recognised in dependencies, with
 * the token names their examples read. The env list is a suggestion of names
 * only; Egg never asks for a token anywhere except environment variables, and
 * never creates a variable itself.
 */
export const BOT_FRAMEWORKS: {
  id: BotFramework;
  label: string;
  language: "node" | "python";
  deps: string[];
  env: string[];
  note: string;
}[] = [
  {
    id: "discord.js",
    label: "Discord bot (discord.js)",
    language: "node",
    deps: ["discord.js"],
    env: ["DISCORD_TOKEN"],
    note: "This looks like a Discord bot. It is set up as a background app that needs no port, and DISCORD_TOKEN is offered as an environment variable.",
  },
  {
    id: "discord.py",
    label: "Discord bot (discord.py)",
    language: "python",
    deps: ["discord.py"],
    env: ["DISCORD_TOKEN"],
    note: "This looks like a Discord bot. It is set up as a background app that needs no port, and DISCORD_TOKEN is offered as an environment variable.",
  },
  {
    id: "telegraf",
    label: "Telegram bot (Telegraf)",
    language: "node",
    deps: ["telegraf"],
    env: ["TELEGRAM_BOT_TOKEN"],
    note: "This looks like a Telegram bot. It is set up as a background app that needs no port, and TELEGRAM_BOT_TOKEN is offered as an environment variable.",
  },
  {
    id: "slack-bolt",
    label: "Slack app (Bolt for JavaScript)",
    language: "node",
    deps: ["@slack/bolt", "slack-bolt"],
    env: ["SLACK_BOT_TOKEN", "SLACK_SIGNING_SECRET"],
    note: "This looks like a Slack app. It is set up as a background app, and its token names are offered as environment variables.",
  },
  {
    id: "python-telegram-bot",
    label: "Telegram bot (python-telegram-bot)",
    language: "python",
    deps: ["python-telegram-bot"],
    env: ["TELEGRAM_BOT_TOKEN"],
    note: "This looks like a Telegram bot. It is set up as a background app that needs no port, and TELEGRAM_BOT_TOKEN is offered as an environment variable.",
  },
];

/**
 * Package names from a requirements.txt. Only the names are looked at; version
 * pins, comments, option lines and VCS URLs are ignored, and nothing but the
 * recognised bot framework names is ever reported.
 */
export function parseRequirementsNames(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.split("#")[0].trim();
    if (!line || line.startsWith("-") || line.startsWith(".") || line.startsWith("/")) continue;
    const m = /^([A-Za-z0-9][A-Za-z0-9._-]*)/.exec(line);
    if (m) out.push(m[1].toLowerCase());
  }
  return out;
}

const MAX_NAMES = 100;

const LOCKFILES: { file: string; pm: PackageManager }[] = [
  { file: "bun.lock", pm: "bun" },
  { file: "bun.lockb", pm: "bun" },
  { file: "pnpm-lock.yaml", pm: "pnpm" },
  { file: "yarn.lock", pm: "yarn" },
  { file: "package-lock.json", pm: "npm" },
];

const PM_LABEL: Record<PackageManager, string> = {
  npm: "npm",
  pnpm: "pnpm",
  yarn: "Yarn",
  bun: "Bun",
};
export const packageManagerLabel = (pm: PackageManager) => PM_LABEL[pm];

const LANGUAGE_LABEL: Record<Language, string> = {
  node: "Node.js",
  python: "Python",
  go: "Go",
  ruby: "Ruby",
  rust: "Rust",
  php: "PHP",
  java: "Java",
  docker: "Docker",
};
export const languageLabel = (l: Language) => LANGUAGE_LABEL[l];

const asRecord = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

/** "pnpm@9.1.0" to "pnpm", or null for anything we do not recognise. */
function packageManagerField(pkg: Record<string, unknown>): PackageManager | null {
  const raw = pkg.packageManager;
  if (typeof raw !== "string") return null;
  const name = raw.split("@")[0]?.trim();
  return name === "npm" || name === "pnpm" || name === "yarn" || name === "bun" ? name : null;
}

/**
 * Install, build and start commands for a package manager. Install matches
 * what the build runs: a frozen install when a lockfile exists, else a plain one.
 */
export function commandsFor(
  pm: PackageManager,
  opts: { hasLockfile: boolean; hasBuild: boolean; hasStart: boolean }
): Commands {
  const install = {
    npm: opts.hasLockfile ? "npm ci" : "npm install",
    pnpm: "corepack enable && pnpm install --frozen-lockfile",
    yarn: "corepack enable && yarn install --frozen-lockfile",
    bun: "bun install --frozen-lockfile",
  }[pm];
  const build = { npm: "npm run build", pnpm: "pnpm build", yarn: "yarn build", bun: "bun run build" }[pm];
  const start = { npm: "npm start", pnpm: "pnpm start", yarn: "yarn start", bun: "bun run start" }[pm];
  return {
    install,
    build: opts.hasBuild ? build : null,
    start: opts.hasStart ? start : null,
  };
}

/**
 * Names from an env example file. Understands comments, blank lines, an
 * `export` prefix and quoted values. Values are looked at only to tell whether
 * one is present, and are never returned.
 */
export function parseEnvNames(text: string, source: string): DetectedEnv[] {
  const out: DetectedEnv[] = [];
  for (const raw of text.replace(/^﻿/, "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const m = line.replace(/^export\s+/, "").match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/);
    if (!m) continue;
    let value = m[2].trim();
    if (!/^["']/.test(value)) value = value.replace(/(^|\s+)#.*$/, "").trim();
    value = value.replace(/^(["'])(.*)\1$/, "$2");
    out.push({ name: m[1], source, hasExampleValue: value.length > 0 });
  }
  return out;
}

function collectEnv(files: Record<string, string>): DetectedEnv[] {
  const seen = new Set<string>();
  const out: DetectedEnv[] = [];
  for (const file of ENV_EXAMPLE_FILES) {
    const text = files[file];
    if (!text) continue;
    for (const e of parseEnvNames(text, file)) {
      if (seen.has(e.name) || e.name.length > 100) continue;
      if (!ENV_KEY.test(e.name) || RESERVED_ENV.has(e.name.toUpperCase())) continue;
      seen.add(e.name);
      out.push(e);
      if (out.length >= MAX_NAMES) return out;
    }
  }
  return out;
}

function workspaceRoots(paths: string[]): string[] {
  const roots = new Set<string>();
  for (const p of paths) {
    const m = p.match(/^((?:packages|apps)\/[^/]+)\/package\.json$/);
    if (m) roots.add(m[1]);
  }
  return [...roots].sort().slice(0, 20);
}

export function detectRepo(files: Record<string, string>): RepoDetection {
  const paths = Object.keys(files);
  const has = (f: string) => paths.includes(f);
  const warnings: string[] = [];
  const notes: string[] = [];

  // ---- committed env files: by name only, never read
  const committedEnvFiles = COMMITTED_ENV_FILES.filter((f) => has(f));
  if (committedEnvFiles.length > 0) warnings.push(COMMITTED_ENV_WARNING);

  // ---- package.json
  let pkg: Record<string, unknown> = {};
  if (has("package.json") && files["package.json"]) {
    try {
      pkg = asRecord(JSON.parse(files["package.json"]));
    } catch {
      warnings.push("package.json could not be read as JSON, so scripts and dependencies were not detected.");
    }
  }
  const scripts = asRecord(pkg.scripts);
  const deps = { ...asRecord(pkg.devDependencies), ...asRecord(pkg.dependencies) };
  const hasDep = (n: string) => n in deps;

  // ---- language
  let language: Language | null = null;
  if (has("package.json")) language = "node";
  else if (has("requirements.txt") || has("pyproject.toml")) language = "python";
  else if (has("go.mod")) language = "go";
  else if (has("Gemfile")) language = "ruby";
  else if (has("Cargo.toml")) language = "rust";
  else if (has("composer.json")) language = "php";
  else if (has("pom.xml") || has("build.gradle") || has("build.gradle.kts")) language = "java";
  else if (has("Dockerfile")) language = "docker";

  // ---- package manager
  const lockfiles = LOCKFILES.filter((l) => has(l.file));
  const fromLocks = [...new Set(lockfiles.map((l) => l.pm))];
  const fromField = packageManagerField(pkg);
  let packageManager: PackageManager | null = null;
  if (language === "node") {
    packageManager = fromField ?? fromLocks[0] ?? "npm";
    const others = lockfiles.filter((l) => l.pm !== packageManager);
    if (others.length > 0) {
      const names = others.map((l) => l.file).join(", ");
      warnings.push(
        fromField
          ? `The packageManager field names ${PM_LABEL[packageManager]}, but there are other lockfiles too (${names}). Delete the ones you do not use.`
          : `More than one lockfile is committed (${lockfiles.map((l) => l.file).join(", ")}). Using ${PM_LABEL[packageManager]}; delete the others (${names}).`
      );
    }
  }
  const packageManagerSupported = packageManager !== null;

  // ---- framework
  let framework: Framework | null = null;
  if (language === "node") {
    if (hasDep("next")) framework = "next";
    else if (hasDep("nuxt")) framework = "nuxt";
    else if (hasDep("astro")) framework = "astro";
    else if (hasDep("vite")) framework = "vite";
  }

  // ---- bot framework: a default workload and token-name suggestions, never a lock.
  // A web framework wins: a Next or Vite app that also uses discord.js is a web app first.
  let bot: BotFramework | null = null;
  const pythonNames =
    language === "python" && files["requirements.txt"] ? new Set(parseRequirementsNames(files["requirements.txt"])) : null;
  if (framework === null) {
    for (const f of BOT_FRAMEWORKS) {
      const found =
        f.language === "node"
          ? f.deps.some((d) => hasDep(d))
          : pythonNames !== null && f.deps.some((d) => pythonNames.has(d));
      if (found) {
        bot = f.id;
        notes.push(f.note);
        break;
      }
    }
  }

  // ---- runtime and commands
  const hasBuild = typeof scripts.build === "string";
  const hasStart = typeof scripts.start === "string";
  let runtime: Runtime | null = null;
  let commands: Commands = { install: null, build: null, start: null };
  let outputDir: string | null = null;

  if (language === "node" && packageManager) {
    const base = commandsFor(packageManager, {
      hasLockfile: fromLocks.includes(packageManager),
      hasBuild,
      hasStart,
    });
    const staticSite = (framework === "vite" || framework === "astro") && !hasStart;
    if (staticSite) {
      runtime = "static";
      outputDir = "dist";
      commands = { install: base.install, build: base.build, start: null };
      notes.push(`This looks like a ${framework === "astro" ? "Astro" : "Vite"} site that builds to static files in dist.`);
    } else {
      runtime = "node";
      commands = base;
      if (!hasStart) {
        notes.push('package.json has no "start" script. Add one, or set a start command yourself.');
      }
    }
  } else if (language === "python") {
    runtime = "python";
    notes.push("Python app. The default start command is python3 app.py; change it if your entry point differs.");
  } else if (language === "go" || language === "ruby" || language === "rust" || language === "php" || language === "java") {
    runtime = language;
    notes.push(language === "go" ? "Go apps default to building the package in the selected root; check the build and start commands." : `${LANGUAGE_LABEL[language]} app. Set a start command for your application and check its build settings.`);
  } else if (language === "docker") {
    notes.push(
      "A Dockerfile was found. Egg does not build Docker images, so it is not used. Pick a runtime and set your own commands."
    );
  } else {
    notes.push("Nothing here tells us what this project is. Pick a preset yourself.");
  }
  // A Dockerfile next to real source is worth a mention, whatever else was found.
  if (language !== "docker" && language !== null && has("Dockerfile")) {
    notes.push("A Dockerfile was found. Egg does not build Docker images, so it is ignored.");
  }

  // ---- monorepo
  const candidateRoots = workspaceRoots(paths);
  const workspaces = pkg.workspaces;
  const monorepo =
    Array.isArray(workspaces) ||
    (typeof workspaces === "object" && workspaces !== null) ||
    has("pnpm-workspace.yaml") ||
    candidateRoots.length > 0;
  if (monorepo) {
    notes.push("This looks like a monorepo. Set the root directory to the app you want to deploy.");
  }

  // ---- suggested token names for a detected bot
  const env = collectEnv(files);
  const known = new Set(env.map((e) => e.name));
  const botInfo = BOT_FRAMEWORKS.find((f) => f.id === bot);
  const suggestedEnv: DetectedEnv[] = botInfo
    ? botInfo.env
        .filter((n) => !known.has(n) && ENV_KEY.test(n) && !RESERVED_ENV.has(n.toUpperCase()))
        .map((name) => ({ name, source: botInfo.label, hasExampleValue: false, suggested: true }))
    : [];

  return {
    packageManager,
    packageManagerSupported,
    language,
    framework,
    runtime,
    commands,
    outputDir,
    monorepo,
    candidateRoots,
    bot,
    suggestedWorkloadKind: bot !== null && runtime !== "static" ? "worker" : null,
    suggestedEnv,
    env,
    committedEnvFiles,
    warnings,
    notes,
  };
}
