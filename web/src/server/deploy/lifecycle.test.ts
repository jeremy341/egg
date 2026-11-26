import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  userId: "owner",
  routeMocks: false,
  deployment: { id: "dep", env: "production", state: "ready", isCurrent: true, cleanedUp: false },
  project: { id: "project", userId: "owner", serverId: "server", slug: "demo", deploymentMode: "native" },
  server: { id: "server" },
  script: vi.fn(async () => ({ code: 0, stdout: "ok\n", stderr: "" })),
  session: { script: vi.fn(async () => ({ code: 0, stdout: "ok\n", stderr: "" })) },
  ownedDeployment: vi.fn(async () => ({ dep: state.deployment, project: state.project })),
  authed: vi.fn(async () => ({ id: "owner" })),
  readJson: vi.fn(async () => ({ action: "start" })),
  deploymentVolumes: vi.fn(async (_userId: string, _deploymentId: string) => ({ deploymentId: "dep", volumes: ["egg-demo_8a9b1c2d_data"] })),
  operateDeployment: vi.fn(async (_userId: string, _deploymentId: string, _input: { action: string; memoryMb?: number; cpuPercent?: number }) => ({ action: "start", deploymentId: "dep", output: "Started" })),
}));

vi.mock("@/server/audit", () => ({ audit: vi.fn() }));
vi.mock("@/server/config", () => ({ config: () => ({ UNIT_DIR: "/etc/systemd/system" }) }));
vi.mock("@/server/db", () => ({ getDb: vi.fn(), schema: {} }));
vi.mock("@/server/projects", () => ({ ownedDeployment: state.ownedDeployment }));
vi.mock("@/server/servers", () => ({
  getServerForUser: vi.fn(async () => state.server),
  withServerSession: vi.fn(async (_server: unknown, callback: (s: unknown) => unknown) => callback(state.session)),
}));
vi.mock("@/server/ssh/probe", () => ({ probeSession: vi.fn(async () => ({ home: "/home/owner" })) }));
vi.mock("@/server/http", () => ({
  HttpError: class HttpError extends Error { constructor(readonly status: number, message: string, readonly code?: string) { super(message); } },
  authed: state.authed,
  handle: (fn: unknown) => fn,
  ok: (data: unknown, status = 200) => ({ data, status }),
  readJson: state.readJson,
}));
vi.mock("@/server/deploy/lifecycle", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/deploy/lifecycle")>();
  return {
    ...actual,
    deploymentVolumes: (...args: Parameters<typeof actual.deploymentVolumes>) => state.routeMocks ? state.deploymentVolumes(...args) : actual.deploymentVolumes(...args),
    operateDeployment: (...args: Parameters<typeof actual.operateDeployment>) => state.routeMocks ? state.operateDeployment(...args) : actual.operateDeployment(...args),
  };
});

import { GET, POST } from "@/app/api/deployments/[id]/lifecycle/route";
import { deploymentVolumes, lifecycleScript, operateDeployment } from "@/server/deploy/lifecycle";
import { serverDiscriminator } from "@/server/deploy/layout";

beforeEach(() => {
  state.deployment = { id: "dep", env: "production", state: "ready", isCurrent: true, cleanedUp: false };
  state.project = { id: "project", userId: "owner", serverId: "server", slug: "demo", deploymentMode: "native" };
  state.routeMocks = false;
  state.session.script.mockClear();
  vi.clearAllMocks();
});

describe("deployment lifecycle scripts", () => {
  it("starts and restarts through the existing managed unit script", () => {
    expect(lifecycleScript({ action: "start", unit: "egg-demo-a1b2c3d4.service", deploymentMode: "native", slug: "demo", scope: "a1b2c3d4" })).toContain("systemctl restart 'egg-demo-a1b2c3d4.service'");
    expect(lifecycleScript({ action: "restart", unit: "egg-demo-a1b2c3d4.service", deploymentMode: "native", slug: "demo", scope: "a1b2c3d4" })).toContain("Started egg-demo-a1b2c3d4.service");
  });

  it("stops a unit and validates resource scale limits", () => {
    expect(lifecycleScript({ action: "stop", unit: "egg-demo.service", deploymentMode: "native", slug: "demo", scope: "scope" })).toContain("systemctl stop 'egg-demo.service'");
    expect(lifecycleScript({ action: "scale", unit: "egg-demo.service", deploymentMode: "native", slug: "demo", scope: "scope", memoryMb: 512, cpuPercent: 200 })).toContain("MemoryMax=512M' 'CPUQuota=200%'");
    expect(() => lifecycleScript({ action: "scale", unit: "u", deploymentMode: "native", slug: "demo", scope: "s", memoryMb: 1 })).toThrow(/128 to 32768/);
    expect(() => lifecycleScript({ action: "scale", unit: "u", deploymentMode: "native", slug: "demo", scope: "s" })).toThrow(/Set a memory or CPU/);
  });

  it("updates Docker resource limits for the scoped application container", () => {
    const script = lifecycleScript({ action: "scale", unit: "egg-demo.service", deploymentMode: "dockerfile", slug: "demo", scope: "a1b2c3d4", memoryMb: 1024, cpuPercent: 150 });
    expect(script).toContain("docker' 'update' '--memory=1024m' '--cpus=1.5' 'egg-demo-a1b2c3d4'");
  });
});

describe("deployment lifecycle access", () => {
  it("refuses an organization administrator who is not the project owner", async () => {
    state.project = { ...state.project, userId: "someone-else" };
    await expect(operateDeployment("admin", "dep", { action: "stop" })).rejects.toMatchObject({ status: 404 });
    expect(state.session.script).not.toHaveBeenCalled();
  });

  it("refuses non-current, preview, cleaned or unfinished deployments", async () => {
    state.deployment = { ...state.deployment, isCurrent: false };
    await expect(deploymentVolumes("owner", "dep")).rejects.toMatchObject({ status: 409 });
    expect(state.session.script).not.toHaveBeenCalled();
  });

  it("runs the requested action and returns project-scoped volume names", async () => {
    await expect(operateDeployment("owner", "dep", { action: "stop" })).resolves.toMatchObject({ action: "stop", deploymentId: "dep" });
    state.project = { ...state.project, deploymentMode: "compose" };
    state.session.script.mockResolvedValueOnce({ code: 0, stdout: `egg-demo-${serverDiscriminator("server")}_data\negg-other_${"data"}\n`, stderr: "" });
    const volumes = await deploymentVolumes("owner", "dep");
    expect(volumes).toEqual({ deploymentId: "dep", volumes: [`egg-demo-${serverDiscriminator("server")}_data`] });
  });
});

describe("lifecycle API route", () => {
  it("requires authentication before reading volume inventory", async () => {
    state.routeMocks = true;
    state.authed.mockRejectedValueOnce(new Error("unauthorized"));
    await expect(GET({} as never, { params: Promise.resolve({ id: "dep" }) })).rejects.toThrow("unauthorized");
    expect(state.deploymentVolumes).not.toHaveBeenCalled();
  });

  it("routes an authenticated action to the lifecycle module", async () => {
    state.routeMocks = true;
    const response = await POST({} as never, { params: Promise.resolve({ id: "dep" }) });
    expect(response).toMatchObject({ status: 200, data: { action: "start", deploymentId: "dep" } });
    expect(state.operateDeployment).toHaveBeenCalledWith("owner", "dep", { action: "start" });
  });
});
