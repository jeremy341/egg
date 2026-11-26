import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import type { Principal, Scope } from "@/server/api-tokens";
import { callEndpoint } from "@/server/api-v1";
import { JOBS_ENDPOINTS } from "@/server/api-v1-jobs";
import { upsertUser } from "@/server/auth/session";
import { schema } from "@/server/db";
import { createProject, deployBranch } from "@/server/projects";
import { createServer, withServerSession } from "@/server/servers";
import { useFreshDb } from "@/server/test/db";

vi.mock("@/server/servers", async (original) => {
  const real = await original<typeof import("@/server/servers")>();
  return { ...real, withServerSession: vi.fn() };
});

const JOB = "11111111-1111-4111-8111-111111111111";
const THEIR_JOB = "22222222-2222-4222-8222-222222222222";

/** The status J<n>_ lines that a job with one successful run prints. */
const statusOutput = [
  "J0_LoadState=loaded",
  "J0_ActiveState=inactive",
  "J0_Result=success",
  "J0_ExecMainStatus=0",
  "J0_TimerActiveState=active",
  "J0_LastEnd=1794571200",
].join("\n");

const fakeSession = () => ({
  script: vi.fn(async (command: string) => {
    if (command.includes("uid=$(id -u)")) {
      return { code: 0, stdout: "uid=0\nhome=/home/test\nsystemd_state=running\n", stderr: "" };
    }
    if (command.includes("systemctl show")) return { code: 0, stdout: statusOutput, stderr: "" };
    if (command.includes("journalctl")) return { code: 0, stdout: "first line\nsecond line\n", stderr: "" };
    return { code: 0, stdout: "", stderr: "" };
  }),
});

let ctx: Awaited<ReturnType<typeof useFreshDb>>;
let ownerId: string;
let outsiderId: string;
let projectId: string;
let theirProjectId: string;
let deploymentId: string;

const principal = (userId: string, scopes: Scope[]): Principal => ({ userId, tokenId: "test-token", scopes });
const endpoint = (id: string) => {
  const found = JOBS_ENDPOINTS.find((entry) => entry.id === id);
  expect(found, `endpoint ${id} exists`).toBeDefined();
  if (!found) throw new Error(`Missing endpoint ${id}`);
  return found;
};
const call = (id: string, p: Principal, raw: unknown) => callEndpoint(p, endpoint(id), raw);
const reader = () => principal(ownerId, ["jobs:read"]);
const writer = () => principal(ownerId, ["jobs:read", "jobs:write"]);

beforeAll(async () => {
  ctx = await useFreshDb();
  ownerId = (await upsertUser({ id: "jobs-api-owner", name: "Owner", email: null, slackId: null })).id;
  outsiderId = (await upsertUser({ id: "jobs-api-outsider", name: "Outsider", email: null, slackId: null })).id;
  const serverId = (await createServer(ownerId, "api-owner")).id;
  const theirServerId = (await createServer(outsiderId, "api-outsider")).id;
  projectId = (
    await createProject(ownerId, {
      serverId,
      name: "Jobs API App",
      slug: "jobs-api-app",
      repoUrl: "https://github.com/sam/jobs-api.git",
      runtime: "node",
      port: 3801,
    })
  ).id;
  theirProjectId = (
    await createProject(outsiderId, {
      serverId: theirServerId,
      name: "Hidden App",
      slug: "hidden-jobs-api",
      repoUrl: "https://github.com/out/hidden.git",
      runtime: "node",
      port: 3802,
    })
  ).id;
  deploymentId = (await deployBranch(ownerId, projectId)).id;

  const now = new Date("2026-01-02T03:04:05.000Z");
  await ctx.db.insert(schema.scheduledJobs).values([
    {
      id: JOB,
      projectId,
      name: "Nightly clean-up",
      schedule: "0 3 * * *",
      command: "node scripts/prune.js",
      enabled: true,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: THEIR_JOB,
      projectId: theirProjectId,
      name: "Hidden job",
      schedule: "0 4 * * *",
      command: "echo hidden",
      enabled: true,
      createdAt: now,
      updatedAt: now,
    },
  ]);
  // deployBranch already left a queued deployment job for this project; that is
  // the queue row get_job_run reports alongside the scheduled-job status.
  const queued = await ctx.db.select().from(schema.jobs).where(eq(schema.jobs.deploymentId, deploymentId)).get();
  expect(queued).toMatchObject({ projectId, state: "queued" });
});

afterAll(async () => {
  await ctx.cleanup();
});

beforeEach(() => {
  vi.mocked(withServerSession).mockReset();
  vi.mocked(withServerSession).mockImplementation(async (_server, fn) => fn(fakeSession() as never));
});

describe("the jobs endpoint list", () => {
  it("has the seven Orchard job operations exactly once", () => {
    expect(JOBS_ENDPOINTS.map((ep) => ep.id)).toEqual([
      "get_job",
      "get_job_run",
      "get_job_run_logs",
      "run_job",
      "update_job",
      "cancel_job_run",
      "replace_job_steps",
    ]);
    expect(new Set(JOBS_ENDPOINTS.map((ep) => `${ep.method} ${ep.path}`)).size).toBe(JOBS_ENDPOINTS.length);
  });

  it("describes each endpoint as an HTTP route with the right scope and behaviour", () => {
    expect(endpoint("get_job")).toMatchObject({
      method: "GET",
      path: "/projects/{projectId}/jobs/{jobId}",
      scope: "jobs:read",
      bucket: "read",
      readOnly: true,
    });
    expect(endpoint("get_job_run")).toMatchObject({
      method: "GET",
      path: "/projects/{projectId}/jobs/{jobId}/runs/{runId}",
      scope: "jobs:read",
      bucket: "ssh",
      readOnly: true,
    });
    expect(endpoint("get_job_run_logs")).toMatchObject({
      method: "GET",
      path: "/projects/{projectId}/jobs/{jobId}/runs/{runId}/logs",
      scope: "jobs:read",
      bucket: "ssh",
      untrusted: true,
    });
    expect(endpoint("run_job")).toMatchObject({
      method: "POST",
      path: "/projects/{projectId}/jobs/{jobId}/run",
      scope: "jobs:write",
      destructive: true,
    });
    expect(endpoint("update_job")).toMatchObject({ method: "PATCH", scope: "jobs:write" });
    expect(endpoint("cancel_job_run")).toMatchObject({
      method: "POST",
      path: "/projects/{projectId}/jobs/{jobId}/runs/{runId}/cancel",
      scope: "jobs:write",
      destructive: true,
    });
    expect(endpoint("replace_job_steps")).toMatchObject({
      method: "PUT",
      path: "/projects/{projectId}/jobs/{jobId}/steps",
      scope: "jobs:write",
    });
  });

  it("validates inputs before doing any remote work", () => {
    const cases: [string, unknown][] = [
      ["get_job", { projectId: "P", jobId: "" }],
      ["get_job_run", { projectId: "P", jobId: JOB, runId: "x".repeat(101) }],
      ["get_job_run_logs", { projectId: "P", jobId: JOB, runId: JOB, extra: 1 }],
      ["run_job", { projectId: "P", jobId: JOB, confirmName: "Nightly clean-up", stray: true }],
      ["update_job", { projectId: "P", jobId: JOB, command: "" }],
      ["cancel_job_run", { projectId: "P", jobId: JOB, runId: "" }],
      ["replace_job_steps", { projectId: "P", jobId: JOB, steps: [] }],
      ["replace_job_steps", { projectId: "P", jobId: JOB, steps: [{ command: "a" }, { command: "b" }] }],
    ];
    for (const [id, raw] of cases) {
      expect(() => endpoint(id).input.parse(raw), id).toThrow();
    }
    expect(withServerSession).not.toHaveBeenCalled();
  });

  it("requires the endpoint's scope before touching its data", async () => {
    const none = principal(ownerId, []);
    const cases: [string, unknown][] = [
      ["get_job", { projectId, jobId: JOB }],
      ["get_job_run", { projectId, jobId: JOB, runId: JOB }],
      ["get_job_run_logs", { projectId, jobId: JOB, runId: JOB }],
      ["run_job", { projectId, jobId: JOB, confirmName: "Nightly clean-up" }],
      ["update_job", { projectId, jobId: JOB, enabled: false }],
      ["cancel_job_run", { projectId, jobId: JOB, runId: JOB }],
      ["replace_job_steps", { projectId, jobId: JOB, steps: [{ command: "echo hi" }] }],
    ];
    for (const [id, raw] of cases) {
      await expect(call(id, none, raw), id).rejects.toMatchObject({ status: 403 });
    }
    expect(withServerSession).not.toHaveBeenCalled();
  });
});

describe("job definition endpoints", () => {
  it("reads only the caller's job", async () => {
    await expect(call("get_job", reader(), { projectId, jobId: JOB })).resolves.toMatchObject({
      job: {
        id: JOB,
        name: "Nightly clean-up",
        command: "node scripts/prune.js",
        schedule: "0 3 * * *",
        enabled: true,
      },
    });
    await expect(call("get_job", reader(), { projectId, jobId: THEIR_JOB })).rejects.toMatchObject({ status: 404 });
  });

  it("changes a job only after the container install succeeds", async () => {
    const result = await call("update_job", writer(), { projectId, jobId: JOB, enabled: false });
    expect(result).toMatchObject({ job: { id: JOB, enabled: false } });
    const row = await ctx.db.select().from(schema.scheduledJobs).where(eq(schema.scheduledJobs.id, JOB)).get();
    expect(row?.enabled).toBe(false);
    expect(withServerSession).toHaveBeenCalledTimes(1);
  });

  it("refuses an empty patch", async () => {
    await expect(call("update_job", writer(), { projectId, jobId: JOB })).rejects.toMatchObject({ status: 400 });
  });

  it("starts a job only with the exact name as confirmation", async () => {
    await expect(call("run_job", writer(), { projectId, jobId: JOB, confirmName: "wrong" })).rejects.toMatchObject({
      status: 400,
    });
    await expect(call("run_job", writer(), { projectId, jobId: JOB, confirmName: "Nightly clean-up" })).resolves.toEqual({
      jobId: JOB,
      started: true,
    });
    expect(withServerSession).toHaveBeenCalled();
  });

  it("replaces the single Egg command with the one step supplied", async () => {
    const result = await call("replace_job_steps", writer(), {
      projectId,
      jobId: JOB,
      steps: [{ name: "prune", command: "node scripts/prune.js --days 7" }],
    });
    expect(result).toMatchObject({
      job: { id: JOB, command: "node scripts/prune.js --days 7" },
      steps: [{ name: "prune", command: "node scripts/prune.js --days 7" }],
    });
    const row = await ctx.db.select().from(schema.scheduledJobs).where(eq(schema.scheduledJobs.id, JOB)).get();
    expect(row?.command).toBe("node scripts/prune.js --days 7");
  });
});

describe("job run endpoints", () => {
  it("returns the live status and the project's queued deployment job under the job's id", async () => {
    const result = await call("get_job_run", reader(), { projectId, jobId: JOB, runId: JOB });
    expect(result).toMatchObject({
      run: {
        id: JOB,
        jobId: JOB,
        state: "ok",
        exitCode: null,
        lastEndedAt: new Date(1794571200 * 1000).toISOString(),
        armed: true,
        deploymentJob: { type: "deploy", state: "queued" },
      },
    });
  });

  it("does not pretend an unknown run id is addressable", async () => {
    await expect(
      call("get_job_run", reader(), {
        projectId,
        jobId: JOB,
        runId: "44444444-4444-4444-8444-444444444444",
      })
    ).rejects.toMatchObject({ status: 404 });
  });

  it("reads the job's recent output and echoes the run id", async () => {
    const result = await call("get_job_run_logs", reader(), { projectId, jobId: JOB, runId: JOB });
    expect(result).toEqual({ jobId: JOB, runId: JOB, lines: ["first line", "second line"] });
  });

  it("pauses the timer instead of claiming to kill a live run", async () => {
    await ctx.db.update(schema.scheduledJobs).set({ enabled: true }).where(eq(schema.scheduledJobs.id, JOB));
    const result = await call("cancel_job_run", writer(), { projectId, jobId: JOB, runId: JOB });
    expect(result).toMatchObject({ jobId: JOB, runId: JOB, canceled: false, paused: true, job: { enabled: false } });
    const row = await ctx.db.select().from(schema.scheduledJobs).where(eq(schema.scheduledJobs.id, JOB)).get();
    expect(row?.enabled).toBe(false);
  });

  it("refuses to cancel another user's job", async () => {
    await expect(
      call("cancel_job_run", principal(outsiderId, ["jobs:write"]), { projectId, jobId: JOB, runId: JOB })
    ).rejects.toMatchObject({ status: 404 });
  });
});
