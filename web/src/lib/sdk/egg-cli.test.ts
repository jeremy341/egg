import { describe, expect, it } from "vitest";
import type { FetchInit, FetchLike, FetchResponse } from "./egg";
import { parseCli, run } from "../../../scripts/egg-cli.mjs";

const TOKEN = "egg_supersecrettokenvalue123";
const URL_BASE = "https://egg.example.com";
const ENV = { EGG_TOKEN: TOKEN, EGG_URL: URL_BASE };

// ------------------------------------------------------------------ fixtures

const deployment = (over: Record<string, unknown> = {}) => ({
  id: "dep_1",
  projectId: "p_1",
  projectSlug: "my-app",
  env: "production",
  state: "ready",
  source: "manual",
  branch: "main",
  sha: "abcdef1234567890",
  commit: "Fix the thing",
  pr: null,
  author: "sam",
  isCurrent: true,
  cleanedUp: false,
  error: null,
  createdAt: "2026-01-02T03:04:05.000Z",
  durationMs: 42_000,
  ...over,
});

const project = {
  id: "p_1",
  slug: "my-app",
  name: "My app",
  repo: "sam/my-app",
  branch: "main",
  runtime: "node",
  port: 3000,
  startCommand: "npm start",
  healthPath: "/",
  autoDeploy: true,
  serverId: "srv_1",
  monitor: "up",
  state: "ready",
  latestDeployment: null,
};

const ME = {
  user: { name: "Sam" },
  token: { name: "laptop", scopes: ["projects:read", "logs:read"], expiresAt: "2027-01-01T00:00:00.000Z" },
  counts: { servers: 1, projects: 1 },
};

const USAGE = {
  serverId: "srv_1",
  cpuLoad: 0.5,
  cpus: 2,
  memUsedMb: 512,
  memTotalMb: 2048,
  diskUsedMb: 1024,
  diskTotalMb: 10240,
  checkedAt: "2026-01-02T03:04:05.000Z",
};

// ---------------------------------------------------------------- test harness

function reply(status: number, body: unknown): FetchResponse {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return { ok: status >= 200 && status < 300, status, headers: { get: () => null }, text: async () => text };
}

type Handler = (call: { url: URL; init: FetchInit }) => FetchResponse | Error;
type Routes = Record<string, FetchResponse | Handler>;

/** Answers by "METHOD /api/v1/path" (query ignored). An unknown route fails the test loudly. */
function routes(table: Routes) {
  const calls: { method: string; path: string; search: string; body: unknown; auth: string | undefined }[] = [];
  const fetch: FetchLike = async (rawUrl, init) => {
    const url = new URL(rawUrl);
    calls.push({
      method: init.method,
      path: url.pathname,
      search: url.search,
      body: init.body === undefined ? undefined : JSON.parse(init.body),
      auth: init.headers.Authorization,
    });
    const entry = table[`${init.method} ${url.pathname}`];
    if (!entry) return reply(404, { error: { code: "not_found", message: `No fake route for ${init.method} ${url.pathname}` } });
    const answer = typeof entry === "function" ? entry({ url, init }) : entry;
    if (answer instanceof Error) throw answer;
    return answer;
  };
  return { fetch, calls };
}

async function egg(argv: string[], table: Routes = {}, env: Record<string, string | undefined> = ENV) {
  const { fetch, calls } = routes(table);
  let out = "";
  let err = "";
  const sleeps: number[] = [];
  const code: number = await run(argv, {
    env,
    fetch,
    stdout: { write: (s: string) => void (out += s) },
    stderr: { write: (s: string) => void (err += s) },
    sleep: async (ms: number) => void sleeps.push(ms),
  });
  return { code, out, err, calls, sleeps };
}

const PROJECTS = { "GET /api/v1/projects": reply(200, { projects: [project] }) };

// -------------------------------------------------------------------- parsing

describe("argument parsing", () => {
  it("reads a command, its arguments and the flags", () => {
    expect(parseCli(["projects", "show", "my-app", "--json"])).toEqual({
      ok: true,
      command: "projects show",
      args: ["my-app"],
      flags: { json: true, follow: false, help: false, branch: undefined },
    });
    expect(parseCli(["deploy", "my-app", "--branch", "feat/x"])).toMatchObject({
      ok: true,
      command: "deploy",
      args: ["my-app"],
      flags: { branch: "feat/x" },
    });
    expect(parseCli(["deploy", "my-app", "--branch=feat/y"])).toMatchObject({ flags: { branch: "feat/y" } });
    expect(parseCli(["logs", "dep_1", "--follow"])).toMatchObject({ ok: true, command: "logs", flags: { follow: true } });
    expect(parseCli(["status"])).toMatchObject({ ok: true, command: "status", args: [] });
  });

  it("accepts the flags before the command too", () => {
    expect(parseCli(["--json", "whoami"])).toMatchObject({ ok: true, command: "whoami", flags: { json: true } });
  });

  it.each([
    [[], "Say what to do"],
    [["fly"], "Unknown command"],
    [["projects"], "projects list"],
    [["projects", "show"], "needs a project slug"],
    [["projects", "list", "extra"], "Too many arguments"],
    [["deploy"], "needs a project slug"],
    [["logs"], "needs a deployment id"],
    [["rollback"], "needs a deployment id"],
    [["whoami", "--nope"], "Unknown option"],
    [["deploy", "my-app", "--branch"], "--branch needs a value"],
    [["projects", "list", "--branch", "x"], "--branch only works with"],
    [["projects", "list", "--follow"], "--follow only works with"],
  ])("rejects %j as a usage error", (argv, fragment) => {
    const parsed: { ok: boolean; message?: string } = parseCli(argv);
    expect(parsed.ok).toBe(false);
    expect(parsed.message).toContain(fragment);
  });
});

// ------------------------------------------------------------------ exit codes

describe("exit codes", () => {
  it("exits 2 for a usage error, prints the usage on stderr and makes no request", async () => {
    const r = await egg(["fly"]);
    expect(r.code).toBe(2);
    expect(r.out).toBe("");
    expect(r.err).toContain("Unknown command");
    expect(r.err).toContain("egg projects list");
    expect(r.calls).toHaveLength(0);
  });

  it("exits 2 and names the variable when EGG_TOKEN or EGG_URL is missing", async () => {
    const noToken = await egg(["whoami"], {}, { EGG_URL: URL_BASE });
    expect(noToken.code).toBe(2);
    expect(noToken.err).toContain("EGG_TOKEN");
    const noUrl = await egg(["whoami"], {}, { EGG_TOKEN: TOKEN });
    expect(noUrl.code).toBe(2);
    expect(noUrl.err).toContain("EGG_URL");
    expect(noUrl.err).not.toContain(TOKEN);
    expect(noToken.calls.length + noUrl.calls.length).toBe(0);
  });

  it("exits 0 and prints the usage on stdout for --help and help, even without a token", async () => {
    for (const argv of [["--help"], ["help"], ["projects", "list", "--help"]]) {
      const r = await egg(argv, {}, {});
      expect(r.code).toBe(0);
      expect(r.out).toContain("egg whoami");
      expect(r.err).toBe("");
    }
  });

  it("exits 1 when the server answers with an error", async () => {
    const r = await egg(["whoami"], {
      "GET /api/v1/me": reply(401, { error: { code: "unauthorized", message: "That token is not valid." } }),
    });
    expect(r.code).toBe(1);
    expect(r.out).toBe("");
    expect(r.err).toContain("That token is not valid.");
    expect(r.err).toContain("401");
  });

  it("exits 1 when the server cannot be reached", async () => {
    const r = await egg(["whoami"], { "GET /api/v1/me": () => new Error("connect ECONNREFUSED") });
    expect(r.code).toBe(1);
    expect(r.err).toContain("Could not reach");
  });

  it("exits 1 when the project slug does not exist", async () => {
    const r = await egg(["projects", "show", "nope"], PROJECTS);
    expect(r.code).toBe(1);
    expect(r.err).toContain('No project with the slug "nope"');
  });

  it("exits 0 on success", async () => {
    const r = await egg(["whoami"], { "GET /api/v1/me": reply(200, ME) });
    expect(r.code).toBe(0);
    expect(r.err).toBe("");
  });
});

// ------------------------------------------------------------------ the token

describe("the token is never printed", () => {
  const outputs = async () => {
    const results = [
      await egg(["whoami"], { "GET /api/v1/me": reply(200, ME) }),
      await egg(["whoami", "--json"], { "GET /api/v1/me": reply(200, ME) }),
      await egg(["whoami"], { "GET /api/v1/me": reply(401, { error: { code: "unauthorized", message: "Bad token." } }) }),
      await egg(["whoami"], { "GET /api/v1/me": () => new Error(`boom ${TOKEN}`) }),
      await egg(["fly"]),
      await egg(["--help"]),
      await egg(["whoami"], {}, { EGG_URL: URL_BASE }),
    ];
    return results.map((r) => r.out + r.err);
  };

  it("does not appear on stdout or stderr in any outcome", async () => {
    for (const text of await outputs()) expect(text).not.toContain(TOKEN);
  });

  it("is removed even when the server echoes it back in an error or in data", async () => {
    const echoed = await egg(["whoami"], {
      "GET /api/v1/me": reply(403, { error: { code: "forbidden", message: `Token ${TOKEN} may not do that.` } }),
    });
    expect(echoed.code).toBe(1);
    expect(echoed.err).not.toContain(TOKEN);
    expect(echoed.err).toContain("[hidden]");

    const data = await egg(["projects", "list", "--json"], {
      "GET /api/v1/projects": reply(200, { projects: [{ ...project, name: `leak ${TOKEN}` }] }),
    });
    expect(data.out).not.toContain(TOKEN);
  });

  it("is sent only as the bearer header", async () => {
    const r = await egg(["whoami"], { "GET /api/v1/me": reply(200, ME) });
    expect(r.calls[0].auth).toBe(`Bearer ${TOKEN}`);
    expect(r.calls[0].search).toBe("");
  });
});

// -------------------------------------------------------------------- commands

describe("egg whoami", () => {
  it("prints the user, the token name, its scopes and expiry", async () => {
    const r = await egg(["whoami"], { "GET /api/v1/me": reply(200, ME) });
    expect(r.out).toContain("Sam");
    expect(r.out).toContain("laptop");
    expect(r.out).toContain("projects:read, logs:read");
    expect(r.out).toContain("2027-01-01");
  });

  it("prints the API answer as JSON with --json", async () => {
    const r = await egg(["whoami", "--json"], { "GET /api/v1/me": reply(200, ME) });
    expect(JSON.parse(r.out)).toEqual(ME);
    expect(r.out.endsWith("\n")).toBe(true);
  });
});

describe("egg projects list and show", () => {
  it("lists projects as a table", async () => {
    const r = await egg(["projects", "list"], PROJECTS);
    expect(r.calls.map((c) => `${c.method} ${c.path}`)).toEqual(["GET /api/v1/projects"]);
    const lines = r.out.trimEnd().split("\n");
    expect(lines[0]).toMatch(/SLUG\s+NAME\s+STATE/);
    expect(lines[1]).toContain("my-app");
    expect(lines[1]).toContain("My app");
  });

  it("says so when there are no projects", async () => {
    const r = await egg(["projects", "list"], { "GET /api/v1/projects": reply(200, { projects: [] }) });
    expect(r.code).toBe(0);
    expect(r.out).toContain("No projects");
  });

  it("lists as JSON with --json", async () => {
    const r = await egg(["projects", "list", "--json"], PROJECTS);
    expect(JSON.parse(r.out)).toEqual({ projects: [project] });
  });

  it("shows one project found by slug", async () => {
    const r = await egg(["projects", "show", "my-app"], {
      ...PROJECTS,
      "GET /api/v1/projects/p_1": reply(200, { project }),
    });
    expect(r.out).toContain("my-app");
    expect(r.out).toContain("sam/my-app");
    expect(r.out).toContain("3000");
    expect(r.calls.map((c) => c.path)).toEqual(["/api/v1/projects", "/api/v1/projects/p_1"]);
  });

  it("also accepts the project id", async () => {
    const r = await egg(["projects", "show", "p_1", "--json"], {
      ...PROJECTS,
      "GET /api/v1/projects/p_1": reply(200, { project }),
    });
    expect(JSON.parse(r.out)).toEqual({ project });
  });
});

describe("egg deploy", () => {
  const queued = deployment({ id: "dep_2", state: "queued", isCurrent: false });

  it("queues a deployment of the production branch", async () => {
    const r = await egg(["deploy", "my-app"], {
      ...PROJECTS,
      "POST /api/v1/projects/p_1/deployments": reply(202, { deployment: queued }),
    });
    expect(r.code).toBe(0);
    expect(r.calls[1]).toMatchObject({ method: "POST", path: "/api/v1/projects/p_1/deployments", body: {} });
    expect(r.out).toContain("dep_2");
    expect(r.out).toContain("queued");
    expect(r.out).toContain("egg logs dep_2 --follow");
  });

  it("deploys another branch with --branch", async () => {
    const r = await egg(["deploy", "my-app", "--branch", "feat/x"], {
      ...PROJECTS,
      "POST /api/v1/projects/p_1/deployments": reply(202, { deployment: { ...queued, env: "preview", branch: "feat/x" } }),
    });
    expect(r.calls[1].body).toEqual({ branch: "feat/x" });
    expect(r.out).toContain("feat/x");
  });

  it("prints the deployment as JSON with --json", async () => {
    const r = await egg(["deploy", "my-app", "--json"], {
      ...PROJECTS,
      "POST /api/v1/projects/p_1/deployments": reply(202, { deployment: queued }),
    });
    expect(JSON.parse(r.out)).toEqual({ deployment: queued });
  });

  it("exits 1 when the server refuses", async () => {
    const r = await egg(["deploy", "my-app"], {
      ...PROJECTS,
      "POST /api/v1/projects/p_1/deployments": reply(409, { error: { code: "conflict", message: "A deployment is already running." } }),
    });
    expect(r.code).toBe(1);
    expect(r.err).toContain("A deployment is already running.");
  });
});

describe("egg deployments list", () => {
  it("lists a project's deployments, newest first as the API gives them", async () => {
    const list = [deployment(), deployment({ id: "dep_0", state: "error", env: "preview", branch: "feat/x", isCurrent: false })];
    const r = await egg(["deployments", "list", "my-app"], {
      ...PROJECTS,
      "GET /api/v1/projects/p_1/deployments": reply(200, { deployments: list }),
    });
    const lines = r.out.trimEnd().split("\n");
    expect(lines[0]).toMatch(/ID\s+STATE\s+ENV\s+BRANCH/);
    expect(lines).toHaveLength(3);
    expect(lines[1]).toContain("dep_1");
    expect(lines[2]).toContain("error");
    expect(lines[2]).toContain("feat/x");
  });

  it("gives JSON with --json", async () => {
    const list = [deployment()];
    const r = await egg(["deployments", "list", "my-app", "--json"], {
      ...PROJECTS,
      "GET /api/v1/projects/p_1/deployments": reply(200, { deployments: list }),
    });
    expect(JSON.parse(r.out)).toEqual({ deployments: list });
  });
});

describe("egg logs", () => {
  const line = (id: number, message: string, level = "info") => ({ id, at: "2026-01-02T03:04:05.000Z", level, message });

  it("prints every build log line, following pages", async () => {
    const pages = [
      { deploymentId: "dep_1", lines: [line(1, "first"), line(2, "second")], nextAfter: 2, more: true },
      { deploymentId: "dep_1", lines: [line(3, "third", "error")], nextAfter: 3, more: false },
    ];
    let n = 0;
    const r = await egg(["logs", "dep_1"], {
      "GET /api/v1/deployments/dep_1/logs": () => reply(200, pages[n++]),
    });
    expect(r.code).toBe(0);
    expect(r.out).toContain("first");
    expect(r.out).toContain("second");
    expect(r.out).toMatch(/error\s+third/);
    expect(r.calls.map((c) => c.search)).toEqual(["?after=0", "?after=2"]);
  });

  it("strips terminal control characters from log text", async () => {
    const r = await egg(["logs", "dep_1"], {
      "GET /api/v1/deployments/dep_1/logs": reply(200, {
        deploymentId: "dep_1",
        lines: [line(1, "\u001b[2J\u001b]0;pwned\u0007clean\u0000 text")],
        nextAfter: 1,
        more: false,
      }),
    });
    expect(r.out).not.toContain("\u001b");
    expect(r.out).not.toContain("\u0007");
    expect(r.out).toContain("clean text");
  });

  it("gives the lines as JSON with --json", async () => {
    const lines = [line(1, "only")];
    const r = await egg(["logs", "dep_1", "--json"], {
      "GET /api/v1/deployments/dep_1/logs": reply(200, { deploymentId: "dep_1", lines, nextAfter: 1, more: false }),
    });
    expect(JSON.parse(r.out)).toEqual({ deploymentId: "dep_1", lines });
  });

  it("with --follow keeps polling until the deployment finishes, then exits 0 when it is ready", async () => {
    const answers = [
      { deploymentId: "dep_1", lines: [line(1, "building")], nextAfter: 1, more: false },
      { deploymentId: "dep_1", lines: [line(2, "done")], nextAfter: 2, more: false },
      { deploymentId: "dep_1", lines: [], nextAfter: 2, more: false },
    ];
    const states = ["building", "ready"];
    let logCalls = 0;
    let stateCalls = 0;
    const r = await egg(["logs", "dep_1", "--follow"], {
      "GET /api/v1/deployments/dep_1/logs": () => reply(200, answers[Math.min(logCalls++, answers.length - 1)]),
      "GET /api/v1/deployments/dep_1": () => reply(200, { deployment: { ...deployment(), state: states[Math.min(stateCalls++, 1)], port: 3000, startedAt: null, finishedAt: null } }),
    });
    expect(r.code).toBe(0);
    expect(r.out.indexOf("building")).toBeLessThan(r.out.indexOf("done"));
    expect(r.sleeps.length).toBeGreaterThanOrEqual(1);
    // After the first page, only newer lines are asked for.
    const afters = r.calls.filter((c) => c.path.endsWith("/logs")).map((c) => c.search);
    expect(afters[0]).toBe("?after=0");
    expect(afters[1]).toBe("?after=1");
  });

  it("with --follow exits 1 when the deployment ends in error", async () => {
    const r = await egg(["logs", "dep_1", "--follow"], {
      "GET /api/v1/deployments/dep_1/logs": reply(200, { deploymentId: "dep_1", lines: [], nextAfter: 0, more: false }),
      "GET /api/v1/deployments/dep_1": reply(200, {
        deployment: { ...deployment({ state: "error", error: "Build failed." }), port: 3000, startedAt: null, finishedAt: null },
      }),
    });
    expect(r.code).toBe(1);
    expect(r.err).toContain("error");
  });

  it("with --follow and --json prints one JSON line per log line", async () => {
    const answers = [{ deploymentId: "dep_1", lines: [line(1, "a"), line(2, "b")], nextAfter: 2, more: false }];
    const r = await egg(["logs", "dep_1", "--follow", "--json"], {
      "GET /api/v1/deployments/dep_1/logs": reply(200, answers[0]),
      "GET /api/v1/deployments/dep_1": reply(200, {
        deployment: { ...deployment(), port: 3000, startedAt: null, finishedAt: null },
      }),
    });
    const rows = r.out.trimEnd().split("\n").map((l) => JSON.parse(l));
    expect(rows.map((x: { message: string }) => x.message)).toEqual(["a", "b"]);
  });
});

describe("egg rollback", () => {
  it("queues a rollback and says what it did", async () => {
    const queued = deployment({ id: "dep_9", state: "queued", source: "rollback", isCurrent: false });
    const r = await egg(["rollback", "dep_1"], { "POST /api/v1/deployments/dep_1/rollback": reply(202, { deployment: queued }) });
    expect(r.code).toBe(0);
    expect(r.calls[0].method).toBe("POST");
    expect(r.out).toContain("dep_9");
    expect(r.out).toContain("dep_1");
  });

  it("gives JSON with --json and exits 1 on a refusal", async () => {
    const queued = deployment({ id: "dep_9", state: "queued" });
    const ok = await egg(["rollback", "dep_1", "--json"], { "POST /api/v1/deployments/dep_1/rollback": reply(202, { deployment: queued }) });
    expect(JSON.parse(ok.out)).toEqual({ deployment: queued });
    const no = await egg(["rollback", "dep_1"], {
      "POST /api/v1/deployments/dep_1/rollback": reply(409, { error: { code: "conflict", message: "That deployment is already live." } }),
    });
    expect(no.code).toBe(1);
    expect(no.err).toContain("already live");
  });
});

describe("egg env names", () => {
  const env = [
    { key: "DATABASE_URL", target: "all" },
    { key: "DEBUG", target: "preview" },
  ];

  it("lists names and targets, never values", async () => {
    const r = await egg(["env", "names", "my-app"], { ...PROJECTS, "GET /api/v1/projects/p_1/env": reply(200, { env }) });
    expect(r.out).toContain("DATABASE_URL");
    expect(r.out).toMatch(/DEBUG\s+preview/);
    expect(r.calls[1].method).toBe("GET");
  });

  it("gives JSON with --json", async () => {
    const r = await egg(["env", "names", "my-app", "--json"], { ...PROJECTS, "GET /api/v1/projects/p_1/env": reply(200, { env }) });
    expect(JSON.parse(r.out)).toEqual({ env });
  });
});

describe("egg domains list", () => {
  const domains = [
    {
      id: "dom_1",
      domain: "app.example.com",
      status: "valid",
      port: 3000,
      projectId: "p_1",
      projectName: "My app",
      serverId: "srv_1",
      cname: "x.nest.example",
    },
  ];

  it("lists domains with their status and project", async () => {
    const r = await egg(["domains", "list"], { "GET /api/v1/domains": reply(200, { domains }) });
    const lines = r.out.trimEnd().split("\n");
    expect(lines[0]).toMatch(/DOMAIN\s+STATUS\s+PROJECT/);
    expect(lines[1]).toContain("app.example.com");
    expect(lines[1]).toContain("valid");
    expect(lines[1]).toContain("My app");
  });

  it("gives JSON with --json", async () => {
    const r = await egg(["domains", "list", "--json"], { "GET /api/v1/domains": reply(200, { domains }) });
    expect(JSON.parse(r.out)).toEqual({ domains });
  });
});

describe("egg status", () => {
  const servers = [{ id: "srv_1", nestUsername: "sam", host: "hackclub.app", status: "connected", lastCheckedAt: null, createdAt: "2026-01-01T00:00:00.000Z" }];
  const table: Routes = {
    "GET /api/v1/servers": reply(200, { servers }),
    "GET /api/v1/servers/srv_1/usage": reply(200, { usage: USAGE }),
  };

  it("prints CPU, memory and disk for each server", async () => {
    const r = await egg(["status"], table);
    expect(r.code).toBe(0);
    expect(r.out).toContain("hackclub.app");
    expect(r.out).toContain("512 / 2048 MB");
    expect(r.out).toContain("25%");
    expect(r.out).toContain("1024 / 10240 MB");
    expect(r.out).toContain("0.50");
  });

  it("gives the usage of every server as JSON with --json", async () => {
    const r = await egg(["status", "--json"], table);
    expect(JSON.parse(r.out)).toEqual({ servers: [{ ...servers[0], usage: USAGE }] });
  });

  it("exits 1 when a server cannot be measured, after printing the others", async () => {
    const two = [...servers, { ...servers[0], id: "srv_2", host: "other.host" }];
    const r = await egg(["status"], {
      "GET /api/v1/servers": reply(200, { servers: two }),
      "GET /api/v1/servers/srv_1/usage": reply(200, { usage: USAGE }),
      "GET /api/v1/servers/srv_2/usage": reply(502, { error: { code: "bad_gateway", message: "The container is unreachable." } }),
    });
    expect(r.code).toBe(1);
    expect(r.out).toContain("hackclub.app");
    expect(r.err).toContain("other.host");
    expect(r.err).toContain("The container is unreachable.");
  });
});
