import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { FetchInit, FetchLike, FetchResponse } from "./egg";
import { parseCli, run } from "../../../scripts/egg-cli.mjs";

const TOKEN = "egg_jobs_test_secret_123";
const ENV = { EGG_TOKEN: TOKEN, EGG_URL: "https://egg.example.com" };
const project = { id: "p_1", slug: "my-app", name: "My app" };
const job = {
  id: "job_1",
  projectId: "p_1",
  name: "Build job",
  schedule: "0 * * * *",
  enabled: true,
  nextRunAt: null,
  command: "npm test",
};

function reply(status: number, body: unknown): FetchResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    text: async () => JSON.stringify(body),
  };
}

type Handler = (call: { url: URL; init: FetchInit }) => FetchResponse | Promise<FetchResponse>;
type Routes = Record<string, FetchResponse | Handler>;

function routes(table: Routes) {
  const calls: { method: string; path: string; search: string; body: unknown }[] = [];
  const fetch: FetchLike = async (rawUrl, init) => {
    const url = new URL(rawUrl);
    calls.push({
      method: init.method,
      path: url.pathname,
      search: url.search,
      body: init.body === undefined ? undefined : JSON.parse(init.body),
    });
    const answer = table[`${init.method} ${url.pathname}`];
    if (!answer) return reply(404, { error: { code: "not_found", message: `No fake route for ${init.method} ${url.pathname}` } });
    return typeof answer === "function" ? answer({ url, init }) : answer;
  };
  return { fetch, calls };
}

async function egg(argv: string[], table: Routes = {}, options: { isTTY?: boolean } = {}) {
  const { fetch, calls } = routes(table);
  let out = "";
  let err = "";
  const code = await run(argv, {
    env: ENV,
    fetch,
    stdout: { isTTY: options.isTTY ?? true, write: (text: string) => void (out += text) },
    stderr: { write: (text: string) => void (err += text) },
  });
  return { code, out, err, calls };
}

const PROJECTS = { "GET /api/v1/projects": reply(200, { projects: [project] }) };
const GET_JOB = { "GET /api/v1/projects/p_1/jobs/job_1": reply(200, { job }) };
const tempDirs: string[] = [];

async function jsonFile(value: unknown) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "egg-cli-jobs-"));
  tempDirs.push(dir);
  const file = path.join(dir, "steps.json");
  await writeFile(file, JSON.stringify(value), "utf8");
  return file;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("job CLI command parsing", () => {
  it.each([
    ["job list", ["job", "list", "my-app"]],
    ["job get", ["job", "get", "my-app", "job_1"]],
    ["job create", ["job", "create", "my-app", "--name", "Build job", "--steps", "steps.json", "--cron", "0 * * * *"]],
    ["job update", ["job", "update", "my-app", "job_1", "--name", "New name", "--paused"]],
    ["job delete", ["job", "delete", "my-app", "job_1", "--confirm", "Build job"]],
    ["job steps set", ["job", "steps", "set", "my-app", "job_1", "--file", "steps.json"]],
    ["job run", ["job", "run", "my-app", "job_1", "--confirm", "Build job"]],
    ["job runs", ["job", "runs", "my-app", "job_1"]],
    ["job run get", ["job", "run", "get", "my-app", "job_1", "run_1"]],
    ["job run cancel", ["job", "run", "cancel", "my-app", "job_1", "run_1", "--confirm", "Build job"]],
    ["job run logs", ["job", "run", "logs", "my-app", "job_1", "run_1"]],
  ])("parses %s", (command, argv) => {
    expect(parseCli(argv)).toMatchObject({ ok: true, command });
  });
});

describe("job CLI client calls", () => {
  it("lists jobs for the selected project", async () => {
    const r = await egg(["job", "list", "my-app"], {
      ...PROJECTS,
      "GET /api/v1/projects/p_1/jobs": reply(200, { jobs: [job] }),
    });
    expect(r.code).toBe(0);
    expect(r.calls.map(({ method, path }) => [method, path])).toEqual([
      ["GET", "/api/v1/projects"],
      ["GET", "/api/v1/projects/p_1/jobs"],
    ]);
  });

  it("gets one job by project and job id", async () => {
    const r = await egg(["job", "get", "my-app", "job_1"], { ...PROJECTS, ...GET_JOB });
    expect(r.code).toBe(0);
    expect(r.calls[1]).toMatchObject({ method: "GET", path: "/api/v1/projects/p_1/jobs/job_1" });
  });

  it("creates a one-step job from a JSON steps file", async () => {
    const steps = await jsonFile([{ command: "npm test" }]);
    const r = await egg(["job", "create", "my-app", "--name", "Build job", "--cron", "0 * * * *", "--steps", steps], {
      ...PROJECTS,
      "POST /api/v1/projects/p_1/jobs": reply(201, { job }),
    });
    expect(r.code).toBe(0);
    expect(r.calls[1]).toMatchObject({
      method: "POST",
      path: "/api/v1/projects/p_1/jobs",
      body: { name: "Build job", schedule: "0 * * * *", command: "npm test" },
    });
  });

  it("updates only supported job fields", async () => {
    const r = await egg(["job", "update", "my-app", "job_1", "--name", "Renamed", "--paused"], {
      ...PROJECTS,
      "PATCH /api/v1/projects/p_1/jobs/job_1": reply(200, { job: { ...job, name: "Renamed", enabled: false } }),
    });
    expect(r.code).toBe(0);
    expect(r.calls[1].body).toEqual({ name: "Renamed", enabled: false });
  });

  it("deletes a job only after exact name confirmation", async () => {
    const r = await egg(["job", "delete", "my-app", "job_1", "--confirm", "Build job"], {
      ...PROJECTS,
      ...GET_JOB,
      "DELETE /api/v1/projects/p_1/jobs/job_1": reply(200, { deleted: true }),
    });
    expect(r.code).toBe(0);
    expect(r.calls[2]).toMatchObject({ method: "DELETE", path: "/api/v1/projects/p_1/jobs/job_1" });
  });

  it("replaces the steps using the SDK endpoint", async () => {
    const file = await jsonFile([{ command: "npm run build" }]);
    const r = await egg(["job", "steps", "set", "my-app", "job_1", "--file", file], {
      ...PROJECTS,
      "PUT /api/v1/projects/p_1/jobs/job_1/steps": reply(200, { steps: [{ command: "npm run build" }] }),
    });
    expect(r.code).toBe(0);
    expect(r.calls[1]).toMatchObject({
      method: "PUT",
      path: "/api/v1/projects/p_1/jobs/job_1/steps",
      body: { steps: [{ command: "npm run build" }] },
    });
  });

  it("runs a job only after exact name confirmation", async () => {
    const r = await egg(["job", "run", "my-app", "job_1", "--confirm", "Build job"], {
      ...PROJECTS,
      ...GET_JOB,
      "POST /api/v1/projects/p_1/jobs/job_1/run": reply(202, { started: true }),
    });
    expect(r.code).toBe(0);
    expect(r.calls[2]).toMatchObject({ method: "POST", path: "/api/v1/projects/p_1/jobs/job_1/run", body: {} });
  });

  it("lists the available run snapshot", async () => {
    const r = await egg(["job", "runs", "my-app", "job_1"], {
      ...PROJECTS,
      "GET /api/v1/projects/p_1/jobs/job_1/runs": reply(200, { runs: [{ state: "success", exitCode: 0 }] }),
    });
    expect(r.code).toBe(0);
    expect(r.calls[1]).toMatchObject({ method: "GET", path: "/api/v1/projects/p_1/jobs/job_1/runs" });
  });

  it("gets a specific run without printing secret fields", async () => {
    const run = { id: "run_1", state: "running", token: "private-run-token" };
    const r = await egg(["job", "run", "get", "my-app", "job_1", "run_1", "--json"], {
      ...PROJECTS,
      "GET /api/v1/projects/p_1/jobs/job_1/runs/run_1": reply(200, { run }),
    });
    expect(r.code).toBe(0);
    expect(r.calls[1]).toMatchObject({ method: "GET", path: "/api/v1/projects/p_1/jobs/job_1/runs/run_1" });
    expect(JSON.parse(r.out)).toEqual({ run: { ...run, token: "[redacted]" } });
    expect(r.out).not.toContain("private-run-token");
  });

  it("cancels a specific run after exact job name confirmation", async () => {
    const r = await egg(["job", "run", "cancel", "my-app", "job_1", "run_1", "--confirm", "Build job"], {
      ...PROJECTS,
      ...GET_JOB,
      "POST /api/v1/projects/p_1/jobs/job_1/runs/run_1/cancel": reply(200, { cancelled: true }),
    });
    expect(r.code).toBe(0);
    expect(r.calls[2]).toMatchObject({ method: "POST", path: "/api/v1/projects/p_1/jobs/job_1/runs/run_1/cancel" });
  });

  it("reads logs for the requested run", async () => {
    const r = await egg(["job", "run", "logs", "my-app", "job_1", "run_1"], {
      ...PROJECTS,
      "GET /api/v1/projects/p_1/jobs/job_1/runs/run_1/logs": reply(200, { lines: ["step output"] }),
    });
    expect(r.code).toBe(0);
    expect(r.calls[1]).toMatchObject({ method: "GET", path: "/api/v1/projects/p_1/jobs/job_1/runs/run_1/logs" });
    expect(r.out).toContain("step output");
  });

  it("rejects destructive commands without confirmation before making requests", async () => {
    const deleted = await egg(["job", "delete", "my-app", "job_1"]);
    const run = await egg(["job", "run", "my-app", "job_1"]);
    const cancelled = await egg(["job", "run", "cancel", "my-app", "job_1", "run_1"]);
    expect([deleted.code, run.code, cancelled.code]).toEqual([2, 2, 2]);
    expect(deleted.err).toContain("needs --confirm");
    expect(run.err).toContain("needs --confirm");
    expect(cancelled.err).toContain("needs --confirm");
    expect(deleted.calls).toHaveLength(0);
    expect(run.calls).toHaveLength(0);
    expect(cancelled.calls).toHaveLength(0);
  });

  it("rejects a mismatched exact confirmation as usage error", async () => {
    const r = await egg(["job", "delete", "my-app", "job_1", "--confirm", "wrong name"], { ...PROJECTS, ...GET_JOB });
    expect(r.code).toBe(2);
    expect(r.calls).toHaveLength(2);
    expect(r.err).toContain("exactly match");
  });
});
