import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { upsertUser } from "@/server/auth/session";
import { open } from "@/server/crypto";
import { schema } from "@/server/db";
import { runDeployJob, type PipelineDeps } from "@/server/deploy/pipeline";
import { createProject, deployBranch, type ProjectRow } from "@/server/projects";
import { fetchServiceStatus, forgetServiceStatus, isFresh, lastKnownServiceStatus, parseServiceStatus } from "@/server/service-status";
import { connectToServer, createServer, getServerForUser, type ServerRow } from "@/server/servers";
import { serverDiscriminator, unitName } from "@/server/deploy/layout";
import { NestSession } from "@/server/ssh/connection";
import { fakeBuilder, freePort, containerReadyFacts, installFakeContainerBuild, installFakeSystemd, nodeApp } from "@/server/test/fake-nest";
import { useFreshDb } from "@/server/test/db";
import { linuxTestHostAvailable, startMockSsh, type MockSsh } from "@/server/test/mock-ssh";

describe("parseServiceStatus", () => {
  const running = [
    "EGG_ACTIVE=active",
    "EGG_LoadState=loaded",
    "EGG_ActiveState=active",
    "EGG_SubState=running",
    "EGG_MainPID=4242",
    "EGG_NRestarts=2",
    "EGG_Result=success",
    "EGG_MemoryCurrent=88080384",
    "EGG_CPUUsageNSec=2500000000",
    "EGG_ActiveEnterTimestampMonotonic=1000000000",
    "EGG_UPTIME=1000.50",
    "EGG_HTTP=200 0.0123",
  ].join("\n");

  it("reads a healthy service", () => {
    const at = new Date("2026-11-04T12:00:00Z");
    expect(parseServiceStatus(running, at)).toEqual({
      state: "running",
      detail: "running",
      pid: 4242,
      uptimeSeconds: 1, // 1000.5 s since boot minus 1000 s when it started, rounded
      memoryMb: 84,
      cpuNs: 2_500_000_000,
      restarts: 2,
      result: "success",
      http: { code: 200, ms: 12 },
      checkedAt: at.toISOString(),
    });
  });

  it("calls a service that failed, failed", () => {
    const s = parseServiceStatus(
      "EGG_ActiveState=failed\nEGG_SubState=failed\nEGG_MainPID=0\nEGG_MemoryCurrent=18446744073709551615\nEGG_HTTP=000 0.000"
    );
    expect(s).toMatchObject({ state: "failed", pid: null, memoryMb: null, uptimeSeconds: null });
    expect(s.http).toEqual({ code: 0, ms: null });
  });

  it("tells a missing unit from a stopped one", () => {
    expect(parseServiceStatus("EGG_LoadState=not-found\nEGG_ActiveState=inactive").state).toBe("not_deployed");
    expect(parseServiceStatus("EGG_LoadState=loaded\nEGG_ActiveState=inactive").state).toBe("stopped");
    expect(parseServiceStatus("EGG_ActiveState=activating\nEGG_SubState=auto-restart").state).toBe("starting");
  });

  it("copes with garbage and with a missing curl", () => {
    const s = parseServiceStatus("hello\nEGG_MemoryCurrent=[not set]\nEGG_MainPID=abc\nEGG_HTTP=oops");
    expect(s).toMatchObject({ state: "unknown", memoryMb: null, pid: null, http: null });
    expect(parseServiceStatus("").state).toBe("unknown");
  });

  it("ignores lines that are not ours", () => {
    expect(parseServiceStatus("ActiveState=active\nEGG_ACTIVE=failed").state).toBe("failed");
  });
});

describe.skipIf(!linuxTestHostAvailable())("fetchServiceStatus on a mock Nest", () => {
  let ctx: Awaited<ReturnType<typeof useFreshDb>>;
  let mock: MockSsh;
  let userId: string;
  let server: ServerRow;
  let project: ProjectRow;
  let neverDeployed: ProjectRow;
  let deps: PipelineDeps;

  async function sh(command: string) {
    const s = await NestSession.connect({
      host: "127.0.0.1",
      port: mock.port,
      username: "sam-r",
      privateKey: open(server.privateKeyEnc, `server:${server.id}`),
    });
    try {
      return (await s.exec(command)).stdout.trim();
    } finally {
      s.close();
    }
  }

  beforeAll(async () => {
    ctx = await useFreshDb();
    userId = (await upsertUser({ id: "u1", name: "Sam", email: null, slackId: null })).id;
    server = await createServer(userId, "sam-r", { host: "127.0.0.1", port: 1 });
    mock = await startMockSsh({ authorizedKeys: [server.publicKey] });
    installFakeSystemd(mock);
    installFakeContainerBuild(mock);
    await ctx.db.update(schema.servers).set({ port: mock.port, hostKeyFingerprint: mock.hostKeyFingerprint }).where(eq(schema.servers.id, server.id));
    server = await getServerForUser(userId, server.id);

    const base = { serverId: server.id, repoUrl: "https://github.com/example/demo", runtime: "node" as const };
    project = await createProject(userId, {
      ...base,
      name: "Status App",
      startCommand: "node server.js",
      port: await freePort(),
    });
    neverDeployed = await createProject(userId, { ...base, name: "Idle", startCommand: "node server.js", port: await freePort() });
    deps = {
      preflight: () => async () => containerReadyFacts,
      lockPollMs: 50,
      sourceBuild: fakeBuilder(() => nodeApp("v1")),
      connect: connectToServer,
      unitDir: `${mock.home.replace(/\\/g, "/")}/units`,
      healthTimeoutSeconds: 8,
    };
  });

  afterAll(async () => {
    for (const unit of (await sh("ls $HOME/units 2>/dev/null || true")).split(/\s+/).filter(Boolean)) {
      await sh(`systemctl stop ${unit}`).catch(() => {});
    }
    await mock.stop();
    await ctx.cleanup();
  });

  it("says not deployed for a project that never ran", async () => {
    const s = await fetchServiceStatus(userId, neverDeployed.id);
    expect(s.state).toBe("not_deployed");
  });

  it("reports a running service with its memory and a real answer from the app", async () => {
    const dep = await deployBranch(userId, project.id);
    await runDeployJob(dep.id, deps);
    const s = await fetchServiceStatus(userId, project.id);
    expect(s.state).toBe("running");
    expect(s.pid).toBeGreaterThan(0);
    expect(s.memoryMb).toBeGreaterThan(1);
    expect(s.uptimeSeconds).not.toBeNull();
    expect(s.uptimeSeconds!).toBeLessThan(120);
    expect(s.http?.code).toBe(200);
  });

  it("notices when the service has stopped", async () => {
    await sh(`systemctl stop ${unitName("status-app", undefined, serverDiscriminator(server.id))}`);
    const s = await fetchServiceStatus(userId, project.id);
    expect(["failed", "stopped"]).toContain(s.state);
    expect(s.http?.code).toBe(0);
  });

  it("belongs to the owner", async () => {
    const other = (await upsertUser({ id: "u2", name: "Alex", email: null, slackId: null })).id;
    await expect(fetchServiceStatus(other, project.id)).rejects.toMatchObject({ status: 404 });
  });

  it("reuses a reading for 30 seconds, and Check now bypasses it", async () => {
    forgetServiceStatus(project.id);
    let clock = 1_000_000;
    const now = () => clock;
    // The service was stopped by the test above.
    const first = await lastKnownServiceStatus(userId, project.id, { now });
    expect(first.cached).toBe(false);
    expect(["failed", "stopped"]).toContain(first.status.state);

    await sh(`systemctl start ${unitName("status-app", undefined, serverDiscriminator(server.id))}`);
    clock += 10_000;
    const second = await lastKnownServiceStatus(userId, project.id, { now });
    expect(second.cached).toBe(true);
    expect(second.status.checkedAt).toBe(first.status.checkedAt);
    expect(["failed", "stopped"]).toContain(second.status.state);

    const forced = await lastKnownServiceStatus(userId, project.id, { now, fresh: true });
    expect(forced.cached).toBe(false);
    expect(forced.status.state).toBe("running");

    // Past 30 seconds the stored reading is no longer used.
    clock += 31_000;
    expect((await lastKnownServiceStatus(userId, project.id, { now })).cached).toBe(false);
  });

  it("checks ownership before it hands out a stored reading", async () => {
    await lastKnownServiceStatus(userId, project.id);
    const other = (await upsertUser({ id: "u3", name: "Eve", email: null, slackId: null })).id;
    await expect(lastKnownServiceStatus(other, project.id)).rejects.toMatchObject({ status: 404 });
  });
});

describe("isFresh", () => {
  it("is true under the limit, false at or past it, false for a clock that went backwards", () => {
    expect(isFresh(1000, 1000 + 29_999)).toBe(true);
    expect(isFresh(1000, 1000 + 30_000)).toBe(false);
    expect(isFresh(1000, 500)).toBe(false);
  });
});
