import { describe, expect, it } from "vitest";
import { readRepo } from "@/server/repo-read";
import { COMMITTED_ENV_WARNING, commandsFor, detectRepo, parseEnvNames, parseRequirementsNames } from "@/server/repo-detect";

const pkg = (o: object) => JSON.stringify(o);

describe("package manager", () => {
  it.each([
    ["bun.lock", "bun"],
    ["bun.lockb", "bun"],
    ["pnpm-lock.yaml", "pnpm"],
    ["yarn.lock", "yarn"],
    ["package-lock.json", "npm"],
  ] as const)("reads %s as %s", (file, pm) => {
    const d = detectRepo({ "package.json": pkg({}), [file]: "" });
    expect(d.packageManager).toBe(pm);
    expect(d.warnings).toEqual([]);
  });

  it("falls back to npm when there is no lockfile", () => {
    const d = detectRepo({ "package.json": pkg({ scripts: { build: "x" } }) });
    expect(d.packageManager).toBe("npm");
    expect(d.commands.install).toBe("npm install");
  });

  it("prefers the packageManager field and warns about the other lockfiles", () => {
    const d = detectRepo({
      "package.json": pkg({ packageManager: "pnpm@9.1.0" }),
      "pnpm-lock.yaml": "",
      "package-lock.json": "",
      "yarn.lock": "",
    });
    expect(d.packageManager).toBe("pnpm");
    expect(d.warnings).toHaveLength(1);
    expect(d.warnings[0]).toContain("package-lock.json");
    expect(d.warnings[0]).toContain("yarn.lock");
    expect(d.warnings[0]).not.toContain("pnpm-lock.yaml");
  });

  it("warns when several lockfiles exist and no field decides", () => {
    const d = detectRepo({ "package.json": pkg({}), "yarn.lock": "", "package-lock.json": "" });
    expect(d.packageManager).toBe("yarn");
    expect(d.warnings[0]).toContain("package-lock.json");
  });

  it("recognises Bun as a supported package manager", () => {
    const d = detectRepo({ "package.json": pkg({}), "bun.lock": "" });
    expect(d.packageManagerSupported).toBe(true);
  });
});

describe("runtime and commands", () => {
  it("suggests build and start from package.json scripts for a Next.js app", () => {
    const d = detectRepo({
      "package.json": pkg({
        scripts: { build: "next build", start: "next start" },
        dependencies: { next: "16.0.0" },
      }),
      "pnpm-lock.yaml": "",
    });
    expect(d.language).toBe("node");
    expect(d.framework).toBe("next");
    expect(d.runtime).toBe("node");
    expect(d.commands).toEqual({
      install: "corepack enable && pnpm install --frozen-lockfile",
      build: "pnpm build",
      start: "pnpm start",
    });
  });

  it("treats a Vite site without a start script as a static site", () => {
    const d = detectRepo({
      "package.json": pkg({ scripts: { build: "vite build" }, devDependencies: { vite: "6" } }),
      "package-lock.json": "",
    });
    expect(d.framework).toBe("vite");
    expect(d.runtime).toBe("static");
    expect(d.outputDir).toBe("dist");
    expect(d.commands.install).toBe("npm ci");
    expect(d.commands.start).toBeNull();
  });

  it("keeps a Vite app with a start script on node", () => {
    const d = detectRepo({
      "package.json": pkg({ scripts: { start: "node server.js" }, dependencies: { vite: "6" } }),
    });
    expect(d.runtime).toBe("node");
  });

  it("recognises Nuxt and Astro", () => {
    expect(detectRepo({ "package.json": pkg({ dependencies: { nuxt: "3" }, scripts: { start: "x" } }) }).framework).toBe("nuxt");
    expect(detectRepo({ "package.json": pkg({ dependencies: { astro: "5" } }) }).framework).toBe("astro");
  });

  it("does not invent a build or start command that package.json lacks", () => {
    const d = detectRepo({ "package.json": pkg({ scripts: { test: "x" } }) });
    expect(d.commands.build).toBeNull();
    expect(d.commands.start).toBeNull();
    expect(d.notes.join(" ")).toContain('no "start" script');
  });

  it("survives a broken package.json", () => {
    const d = detectRepo({ "package.json": "{ nope" });
    expect(d.language).toBe("node");
    expect(d.warnings.join(" ")).toContain("package.json could not be read");
  });

  it("maps Python to the python runtime", () => {
    expect(detectRepo({ "requirements.txt": "flask" }).runtime).toBe("python");
    expect(detectRepo({ "pyproject.toml": "" }).runtime).toBe("python");
  });

  it.each([
    ["go.mod", "go"],
    ["Gemfile", "ruby"],
    ["Cargo.toml", "rust"],
  ] as const)("detects %s", (file, runtime) => {
    const d = detectRepo({ [file]: "" });
    expect(d.runtime).toBe(runtime);
  });

  it("says a Dockerfile is not built", () => {
    const d = detectRepo({ Dockerfile: "FROM node" });
    expect(d.runtime).toBeNull();
    expect(d.notes.join(" ")).toContain("does not build Docker images");
  });

  it("mentions an ignored Dockerfile next to a Node app", () => {
    const d = detectRepo({ "package.json": pkg({}), Dockerfile: "" });
    expect(d.runtime).toBe("node");
    expect(d.notes.join(" ")).toContain("does not build Docker images");
  });

  it("commandsFor uses npm ci only with a lockfile", () => {
    expect(commandsFor("npm", { hasLockfile: true, hasBuild: true, hasStart: true }).install).toBe("npm ci");
    expect(commandsFor("npm", { hasLockfile: false, hasBuild: false, hasStart: false })).toEqual({
      install: "npm install",
      build: null,
      start: null,
    });
  });
});

describe("monorepo", () => {
  it("flags a workspaces array", () => {
    const d = detectRepo({ "package.json": pkg({ workspaces: ["apps/*"] }) });
    expect(d.monorepo).toBe(true);
    expect(d.notes.join(" ")).toContain("root directory");
  });

  it("flags the workspaces object form and pnpm-workspace.yaml", () => {
    expect(detectRepo({ "package.json": pkg({ workspaces: { packages: ["a/*"] } }) }).monorepo).toBe(true);
    expect(detectRepo({ "package.json": pkg({}), "pnpm-workspace.yaml": "" }).monorepo).toBe(true);
  });

  it("flags packages/*/package.json and lists the folders", () => {
    const d = detectRepo({
      "package.json": pkg({}),
      "packages/web/package.json": "",
      "packages/api/package.json": "",
      "apps/docs/package.json": "",
      "packages/web/src/package.json": "",
    });
    expect(d.monorepo).toBe(true);
    expect(d.candidateRoots).toEqual(["apps/docs", "packages/api", "packages/web"]);
  });

  it("does not flag an ordinary app", () => {
    expect(detectRepo({ "package.json": pkg({}) }).monorepo).toBe(false);
  });
});

describe("environment names", () => {
  it("parses KEY=value, export, quotes and comments, and never returns a value", () => {
    const text = [
      "# database",
      "DATABASE_URL=postgres://user:hunter2@host/db",
      'export API_KEY="sk_live_abc123"',
      "EMPTY=",
      "EMPTY_QUOTED=''",
      "COMMENT_ONLY=   # nothing here",
      "  SPACED = yes",
      "# COMMENTED=1",
      "not a line",
      "9BAD=1",
    ].join("\n");
    const names = parseEnvNames(text, ".env.example");
    expect(names.map((n) => [n.name, n.hasExampleValue])).toEqual([
      ["DATABASE_URL", true],
      ["API_KEY", true],
      ["EMPTY", false],
      ["EMPTY_QUOTED", false],
      ["COMMENT_ONLY", false],
      ["SPACED", true],
    ]);
    expect(JSON.stringify(names)).not.toMatch(/hunter2|sk_live|abc123/);
  });

  it("reads CRLF files and a BOM", () => {
    const names = parseEnvNames("﻿A=1\r\nB=\r\n", ".env.sample");
    expect(names.map((n) => n.name)).toEqual(["A", "B"]);
  });

  it("merges all example files, first file wins, and records the source", () => {
    const d = detectRepo({
      "package.json": pkg({}),
      ".env.example": "A=1\nB=",
      ".env.sample": "B=2\nC=3",
      ".env.template": "D=",
      ".env.local.example": "E=x",
    });
    expect(d.env).toEqual([
      { name: "A", source: ".env.example", hasExampleValue: true },
      { name: "B", source: ".env.example", hasExampleValue: false },
      { name: "C", source: ".env.sample", hasExampleValue: true },
      { name: "D", source: ".env.template", hasExampleValue: false },
      { name: "E", source: ".env.local.example", hasExampleValue: true },
    ]);
  });

  it("drops names Egg sets itself", () => {
    const d = detectRepo({ ".env.example": "PORT=3000\nHOST=0.0.0.0\nPATH=/x\nSECRET=1" });
    expect(d.env.map((e) => e.name)).toEqual(["SECRET"]);
  });

  it("caps the list at 100 names", () => {
    const text = Array.from({ length: 150 }, (_, i) => `K${i}=1`).join("\n");
    expect(detectRepo({ ".env.example": text }).env).toHaveLength(100);
  });
});

describe("committed env files", () => {
  it("warns about .env and .env.local and never reads them", () => {
    const d = detectRepo({
      "package.json": pkg({}),
      ".env": "SECRET_TOKEN=hunter2",
      ".env.local": "OTHER=hunter3",
    });
    expect(d.warnings).toContain(COMMITTED_ENV_WARNING);
    expect(d.committedEnvFiles).toEqual([".env", ".env.local"]);
    expect(d.env).toEqual([]);
    expect(JSON.stringify(d)).not.toMatch(/hunter|SECRET_TOKEN|OTHER/);
  });

  it("does not warn about example files", () => {
    const d = detectRepo({ ".env.example": "A=1" });
    expect(d.warnings).toEqual([]);
    expect(d.committedEnvFiles).toEqual([]);
  });
});

describe("bot frameworks", () => {
  it("detects discord.js in dependencies and suggests a worker with DISCORD_TOKEN", () => {
    const d = detectRepo({ "package.json": pkg({ dependencies: { "discord.js": "14" } }) });
    expect(d.bot).toBe("discord.js");
    expect(d.suggestedWorkloadKind).toBe("worker");
    const token = d.suggestedEnv.find((e) => e.name === "DISCORD_TOKEN");
    expect(token).toMatchObject({ name: "DISCORD_TOKEN", suggested: true, hasExampleValue: false });
    expect(d.notes.join(" ")).toContain("Discord bot");
  });

  it("detects discord.py from requirements.txt", () => {
    const text = "discord.py==2.3.2\n# a comment\n--index-url https://example.com\nrequests >= 2";
    const d = detectRepo({ "requirements.txt": text });
    expect(d.bot).toBe("discord.py");
    expect(d.suggestedWorkloadKind).toBe("worker");
    expect(d.suggestedEnv.some((e) => e.name === "DISCORD_TOKEN" && e.suggested === true)).toBe(true);
    expect(d.notes.join(" ")).toContain("Discord bot");
  });

  it("parseRequirementsNames keeps only lowercase package names", () => {
    expect(parseRequirementsNames("discord.py==2.3.2\n# a comment\n--index-url https://example.com\nrequests >= 2")).toEqual([
      "discord.py",
      "requests",
    ]);
  });

  it("detects Telegraf and suggests TELEGRAM_BOT_TOKEN", () => {
    const d = detectRepo({ "package.json": pkg({ dependencies: { telegraf: "4" } }) });
    expect(d.bot).toBe("telegraf");
    expect(d.suggestedWorkloadKind).toBe("worker");
    expect(d.suggestedEnv.some((e) => e.name === "TELEGRAM_BOT_TOKEN" && e.suggested === true)).toBe(true);
    expect(d.notes.join(" ")).toContain("Telegram bot");
  });

  it("detects Bolt for JavaScript and suggests both Slack names", () => {
    const d = detectRepo({ "package.json": pkg({ dependencies: { "@slack/bolt": "4" } }) });
    expect(d.bot).toBe("slack-bolt");
    expect(d.suggestedWorkloadKind).toBe("worker");
    const names = d.suggestedEnv.filter((e) => e.suggested).map((e) => e.name);
    expect(names).toContain("SLACK_BOT_TOKEN");
    expect(names).toContain("SLACK_SIGNING_SECRET");
    expect(d.suggestedEnv.every((e) => e.source === "Slack app (Bolt for JavaScript)")).toBe(true);
    expect(d.notes.join(" ")).toContain("Slack app");
  });

  it("detects python-telegram-bot from requirements.txt", () => {
    const d = detectRepo({ "requirements.txt": "python-telegram-bot==20.0" });
    expect(d.bot).toBe("python-telegram-bot");
    expect(d.suggestedWorkloadKind).toBe("worker");
    expect(d.suggestedEnv.some((e) => e.name === "TELEGRAM_BOT_TOKEN" && e.suggested === true)).toBe(true);
  });

  it("lets a web framework win over a bot dependency", () => {
    const d = detectRepo({
      "package.json": pkg({ dependencies: { next: "16", "discord.js": "14" }, scripts: { start: "next start" } }),
    });
    expect(d.framework).toBe("next");
    expect(d.bot).toBeNull();
    expect(d.suggestedWorkloadKind).toBeNull();
    expect(d.suggestedEnv).toEqual([]);
  });

  it("does not suggest a name already present in an example env file", () => {
    const d = detectRepo({
      "package.json": pkg({ dependencies: { "discord.js": "14" } }),
      ".env.example": "DISCORD_TOKEN=xxx",
    });
    const occurrences = [...d.env, ...d.suggestedEnv].filter((e) => e.name === "DISCORD_TOKEN");
    expect(occurrences).toHaveLength(1);
    expect(occurrences[0].source).toBe(".env.example");
    expect(d.suggestedEnv).toEqual([]);
  });
});

describe("nothing recognisable", () => {
  it("returns an empty detection", () => {
    const d = detectRepo({});
    expect(d.language).toBeNull();
    expect(d.runtime).toBeNull();
    expect(d.env).toEqual([]);
  });
});

describe("readRepo", () => {
  const SECRET = "hunter2-do-not-leak";
  function fakeGithub(treePaths: string[], contents: Record<string, string>, calls: string[] = []) {
    return (async (input: string | URL | Request) => {
      const url = String(input);
      calls.push(url);
      if (url.includes("/git/trees/")) {
        return new Response(JSON.stringify({ tree: treePaths.map((path) => ({ path, type: "blob" })) }), { status: 200 });
      }
      const m = url.match(/\/contents\/([^?]+)/);
      const path = m ? decodeURIComponent(m[1]) : "";
      return path in contents ? new Response(contents[path], { status: 200 }) : new Response("", { status: 404 });
    }) as unknown as typeof fetch;
  }

  it("lists the tree, reads only the needed files, and never downloads a committed .env", async () => {
    const calls: string[] = [];
    const f = fakeGithub(
      [".env", ".env.example", "package.json", "yarn.lock", "src/index.ts", "a/b/c/d.txt"],
      {
        "package.json": JSON.stringify({ scripts: { build: "b", start: "s" } }),
        ".env.example": `TOKEN=${SECRET}
EMPTY=`,
        ".env": `LEAK=${SECRET}`,
      },
      calls
    );
    const r = await readRepo({ repo: "o/r", branch: "main", installationId: null, rootDir: "." }, f);
    expect(r.status).toBe("ok");
    expect(r.detection?.packageManager).toBe("yarn");
    expect(r.detection?.env.map((e) => e.name)).toEqual(["TOKEN", "EMPTY"]);
    expect(r.detection?.committedEnvFiles).toEqual([".env"]);
    expect(JSON.stringify(r)).not.toContain(SECRET);
    expect(calls.some((u) => /contents\/\.env\?/.test(u))).toBe(false);
  });

  it("reads relative to the root directory", async () => {
    const f = fakeGithub(
      ["package.json", "apps/web/package.json", "apps/web/.env.example", "apps/web/pnpm-lock.yaml"],
      { "apps/web/package.json": "{}", "apps/web/.env.example": "A=1" }
    );
    const r = await readRepo({ repo: "o/r", branch: "main", installationId: null, rootDir: "apps/web" }, f);
    expect(r.detection?.packageManager).toBe("pnpm");
    expect(r.detection?.env.map((e) => e.name)).toEqual(["A"]);
    expect(r.detection?.monorepo).toBe(false);
  });

  it("reports a missing branch or repository", async () => {
    const f = (async () => new Response("", { status: 404 })) as unknown as typeof fetch;
    const r = await readRepo({ repo: "o/r", branch: "main", installationId: null, rootDir: "." }, f);
    expect(r.status).toBe("missing");
    expect(r.detection).toBeNull();
  });

  it("reports a network failure instead of throwing", async () => {
    const f = (async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;
    const r = await readRepo({ repo: "o/r", branch: "main", installationId: null, rootDir: "." }, f);
    expect(r.status).toBe("unavailable");
  });

  it("rejects a root directory that escapes the repository", async () => {
    const r = await readRepo({ repo: "o/r", branch: "main", installationId: null, rootDir: "../x" }, fakeGithub([], {}));
    expect(r.status).toBe("unavailable");
  });
});
