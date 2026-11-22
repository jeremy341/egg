import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { RATE_LIMITS, rateLimiter } from "@/server/rate-limit";

// The routes below touch neither a real database nor a real container on these paths: only the signed-in user id and
// the rate limiter matter. Everything behind the gates is mocked so a refused request cannot do any expensive work.
const auth = vi.hoisted(() => ({ user: null as { id: string } | null }));
vi.mock("@/server/auth/current", () => ({ getCurrentUser: async () => auth.user }));
vi.mock("@/server/permission-guards", () => ({ requireProjectFeature: async () => ({}) }));

const mocks = vi.hoisted(() => ({
  status: vi.fn(),
  inventory: vi.fn(),
  server: vi.fn(),
  capabilities: vi.fn(),
  jobs: vi.fn(),
  jobStatuses: vi.fn(),
  jobLogs: vi.fn(),
  job: vi.fn(),
  runJob: vi.fn(),
  bulk: vi.fn(),
  preview: vi.fn(),
  notify: vi.fn(),
  readRepo: vi.fn(),
}));
vi.mock("@/server/service-status", () => ({
  lastKnownServiceStatus: mocks.status,
  forgetServiceStatus: () => {},
}));
vi.mock("@/server/inventory", () => ({ getInventory: mocks.inventory }));
vi.mock("@/server/servers", () => ({
  getServerForUser: mocks.server,
  withServerSession: (_s: unknown, fn: (s: unknown) => unknown) => fn({}),
}));
vi.mock("@/server/capabilities", () => ({ probeTargetCapabilities: mocks.capabilities }));
vi.mock("@/server/body-limit", () => ({
  readJsonLimited: async (req: Request) => {
    const text = await req.text();
    return text ? JSON.parse(text) : {};
  },
}));
vi.mock("@/server/scheduled-jobs", () => ({
  listJobs: mocks.jobs,
  fetchJobStatuses: mocks.jobStatuses,
  createJob: mocks.job,
  updateJob: mocks.job,
  deleteJob: mocks.job,
  runJob: mocks.runJob,
  fetchJobLogs: mocks.jobLogs,
}));
vi.mock("@/server/deployments-bulk", () => ({
  MAX_BULK: 50,
  deletePreview: mocks.preview,
  cancelPreview: mocks.preview,
  runBulk: mocks.bulk,
}));
vi.mock("@/server/notify", () => ({ sendTestNotification: mocks.notify }));
vi.mock("@/server/repo-read", () => ({ readRepo: mocks.readRepo }));
vi.mock("@/server/github/app", () => ({
  assertInstallationOwned: async () => {},
  GithubError: class GithubError extends Error {},
}));
vi.mock("@/server/projects", () => ({ getProjectForUser: mocks.server }));
vi.mock("@/server/root-detect", () => ({ repoFromProject: () => "owner/name" }));
vi.mock("@/server/providers/connections", () => ({
  providerClientForUser: mocks.server,
  publicProviderClient: mocks.server,
  repositoryNameFromUrl: (u: string) => u,
  validateProviderSource: async () => {},
}));
vi.mock("@/server/providers/detect", () => ({ detectProviderRepository: mocks.server }));

import { GET as status } from "@/app/api/projects/[id]/status/route";
import { GET as inventory } from "@/app/api/servers/[id]/inventory/route";
import { GET as capabilities } from "@/app/api/servers/[id]/capabilities/route";
import { GET as listJobsRoute } from "@/app/api/projects/[id]/jobs/route";
import { PATCH as updateJobRoute, DELETE as deleteJobRoute } from "@/app/api/projects/[id]/jobs/[jobId]/route";
import { POST as runJobRoute } from "@/app/api/projects/[id]/jobs/[jobId]/run/route";
import { GET as jobLogsRoute } from "@/app/api/projects/[id]/jobs/[jobId]/logs/route";
import { POST as bulkDelete } from "@/app/api/deployments/bulk-delete/route";
import { POST as bulkCancel } from "@/app/api/deployments/bulk-cancel/route";
import { POST as notifyTest } from "@/app/api/projects/[id]/notify/test/route";
import { GET as repoDetect } from "@/app/api/repos/detect/route";

const ORIGIN = "http://localhost:3000";
const ctxId = (id: string): { params: Promise<{ id: string }> } => ({ params: Promise.resolve({ id }) });
const ctxJob = (id: string, jobId: string): { params: Promise<{ id: string; jobId: string }> } => ({
  params: Promise.resolve({ id, jobId }),
});

function req(path: string, method: string, body?: unknown) {
  return new NextRequest(`${ORIGIN}${path}`, {
    method,
    headers: { "content-type": "application/json", origin: ORIGIN },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const full = (bucket: keyof typeof RATE_LIMITS, user = "alice") =>
  rateLimiter().isFull(`${bucket}:${user}`, RATE_LIMITS[bucket].limit, RATE_LIMITS[bucket].windowMs);

beforeEach(() => {
  auth.user = { id: "alice" };
  rateLimiter().clear();
  mocks.status.mockReset().mockResolvedValue({ status: {}, cached: false });
  mocks.inventory.mockReset().mockResolvedValue({ projects: [] });
  mocks.server.mockReset().mockResolvedValue({});
  mocks.capabilities.mockReset().mockResolvedValue({});
  mocks.jobs.mockReset().mockResolvedValue([]);
  mocks.jobStatuses.mockReset().mockResolvedValue([]);
  mocks.jobLogs.mockReset().mockResolvedValue([]);
  mocks.job.mockReset().mockResolvedValue({});
  mocks.runJob.mockReset().mockResolvedValue(undefined);
  mocks.bulk.mockReset().mockResolvedValue([]);
  mocks.preview.mockReset().mockResolvedValue(undefined);
  mocks.notify.mockReset().mockResolvedValue(undefined);
  mocks.readRepo.mockReset().mockResolvedValue({ status: "ok", detection: null });
});

describe("slow-SSH gates on the remaining SSH-backed routes", () => {
  it("charges sshCall for a fresh status read but not for a cached read", async () => {
    for (let i = 0; i < 3; i++) {
      expect((await status(req("/api/projects/p/status", "GET"), ctxId("p"))).status).toBe(200);
    }
    expect(mocks.status).toHaveBeenCalledTimes(3);
    expect(full("sshCall")).toBe(false);
    // Cached reads do not spend the slow-call bucket, so a full fresh allowance is still available.
    rateLimiter().clear();
    for (let i = 0; i < RATE_LIMITS.sshCall.limit; i++) {
      expect((await status(req("/api/projects/p/status?fresh=1", "GET"), ctxId("p"))).status).toBe(200);
    }
    expect(full("sshCall")).toBe(true);
    const blocked = await status(req("/api/projects/p/status?fresh=1", "GET"), ctxId("p"));
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("retry-after")).toMatch(/^\d+$/);
  });

  it("caps inventory reads and shares that allowance with the capability probe", async () => {
    for (let i = 0; i < RATE_LIMITS.sshCall.limit; i++) {
      expect((await inventory(req("/api/servers/s/inventory", "GET"), ctxId("s"))).status).toBe(200);
    }
    expect(mocks.inventory).toHaveBeenCalledTimes(RATE_LIMITS.sshCall.limit);
    expect((await inventory(req("/api/servers/s/inventory", "GET"), ctxId("s"))).status).toBe(429);
    // The probe runs a script over SSH too: same bucket, so it is refused without doing any work.
    expect((await capabilities(req("/api/servers/s/capabilities", "GET"), ctxId("s"))).status).toBe(429);
    expect(mocks.capabilities).not.toHaveBeenCalled();
  });

  it("caps every SSH-backed jobs route, but not the plain database listing", async () => {
    for (let i = 0; i < RATE_LIMITS.sshCall.limit; i++) {
      expect((await jobLogsRoute(req("/api/projects/p/jobs/j/logs", "GET"), ctxJob("p", "j"))).status).toBe(200);
    }
    expect(mocks.jobLogs).toHaveBeenCalledTimes(RATE_LIMITS.sshCall.limit);
    expect((await listJobsRoute(req("/api/projects/p/jobs?status=1", "GET"), ctxId("p"))).status).toBe(429);
    expect((await updateJobRoute(req("/api/projects/p/jobs/j", "PATCH", {}), ctxJob("p", "j"))).status).toBe(429);
    expect((await deleteJobRoute(req("/api/projects/p/jobs/j", "DELETE"), ctxJob("p", "j"))).status).toBe(429);
    expect((await runJobRoute(req("/api/projects/p/jobs/j/run", "POST"), ctxJob("p", "j"))).status).toBe(429);
    expect(mocks.jobStatuses).not.toHaveBeenCalled();
    expect(mocks.job).not.toHaveBeenCalled();
    expect(mocks.runJob).not.toHaveBeenCalled();
    // A listing that never opens SSH is still served.
    expect((await listJobsRoute(req("/api/projects/p/jobs", "GET"), ctxId("p"))).status).toBe(200);
  });
});

describe("bulk deployment and notification gates", () => {
  it("caps bulk requests with sshCall and the per-item bucket", async () => {
    for (let i = 0; i < RATE_LIMITS.sshCall.limit; i++) {
      expect((await bulkDelete(req("/api/deployments/bulk-delete", "POST", { ids: ["d1"] }), ctxId("x"))).status).toBe(200);
    }
    expect(mocks.bulk).toHaveBeenCalledTimes(RATE_LIMITS.sshCall.limit);
    // Both bulk routes share one allowance.
    expect((await bulkCancel(req("/api/deployments/bulk-cancel", "POST", { ids: ["d1"] }), ctxId("x"))).status).toBe(429);
    expect(mocks.bulk).toHaveBeenCalledTimes(RATE_LIMITS.sshCall.limit);

    // A single request with more items than the per-item ceiling is refused before any SSH work starts.
    rateLimiter().clear();
    mocks.bulk.mockClear();
    const ids = Array.from({ length: RATE_LIMITS.bulkSsh.limit + 1 }, (_, i) => `d${i}`);
    const res = await bulkDelete(req("/api/deployments/bulk-delete", "POST", { ids }), ctxId("x"));
    expect(res.status).toBe(429);
    expect(mocks.bulk).not.toHaveBeenCalled();
    expect(full("bulkSsh")).toBe(true);
  });

  it("limits test notifications with their own small bucket", async () => {
    for (let i = 0; i < RATE_LIMITS.notifyTest.limit; i++) {
      expect((await notifyTest(req("/api/projects/p/notify/test", "POST"), ctxId("p"))).status).toBe(200);
    }
    expect(mocks.notify).toHaveBeenCalledTimes(RATE_LIMITS.notifyTest.limit);
    expect((await notifyTest(req("/api/projects/p/notify/test", "POST"), ctxId("p"))).status).toBe(429);
    expect(mocks.notify).toHaveBeenCalledTimes(RATE_LIMITS.notifyTest.limit);
    expect(full("notifyTest")).toBe(true);
  });
});

describe("repository detection gate", () => {
  const url = (repo: string) => `/api/repos/detect?repo=${repo}&branch=main`;

  it("limits detection per user", async () => {
    for (let i = 0; i < RATE_LIMITS.repoDetect.limit; i++) {
      expect((await repoDetect(req(url(`o/r${i}`), "GET"), ctxId("x"))).status).toBe(200);
    }
    expect(mocks.readRepo).toHaveBeenCalledTimes(RATE_LIMITS.repoDetect.limit);
    expect((await repoDetect(req(url("o/overflow"), "GET"), ctxId("x"))).status).toBe(429);
    expect(mocks.readRepo).toHaveBeenCalledTimes(RATE_LIMITS.repoDetect.limit);
    // Another user has their own allowance.
    auth.user = { id: "bob" };
    expect((await repoDetect(req(url("o/r0"), "GET"), ctxId("x"))).status).toBe(200);
    expect(full("repoDetect", "bob")).toBe(false);
  });

  it("caches a repeated read of the same repo, branch and root", async () => {
    const before = mocks.readRepo.mock.calls.length;
    expect((await repoDetect(req(url("o/cached"), "GET"), ctxId("x"))).status).toBe(200);
    expect((await repoDetect(req(url("o/cached"), "GET"), ctxId("x"))).status).toBe(200);
    expect(mocks.readRepo.mock.calls.length).toBe(before + 1);
    // A different branch is a different key and really reads again.
    expect((await repoDetect(req("/api/repos/detect?repo=o/cached&branch=dev", "GET"), ctxId("x"))).status).toBe(200);
    expect(mocks.readRepo.mock.calls.length).toBe(before + 2);
  });
});
