import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const mocks = vi.hoisted(() => ({ logs: vi.fn(), auth: vi.fn(), owned: vi.fn(), state: vi.fn() }));
vi.mock("@/server/http", () => ({ authed: async () => ({ id: "u" }), handle: (fn: unknown) => fn }));
vi.mock("@/server/auth/session", () => ({ SESSION_COOKIE: "egg_session", userForSessionToken: mocks.auth }));
vi.mock("@/server/projects", () => ({ deploymentLogs: mocks.logs, ownedDeployment: mocks.owned, readableDeployment: mocks.owned }));
vi.mock("@/server/db", () => ({ schema: { deployments: { id: "id", state: "state", error: "error" } }, getDb: async () => ({ select: () => ({ from: () => ({ where: () => ({ get: mocks.state }) }) }) }) }));
import { GET } from "@/app/api/deployments/[id]/stream/route";

describe("deployment event stream", () => {
  beforeEach(() => {
    mocks.auth.mockReset().mockResolvedValue({ id: "u" });
    mocks.owned.mockReset().mockResolvedValue({});
    mocks.state.mockReset().mockResolvedValue({ state: "ready", error: null });
    mocks.logs.mockReset().mockImplementation(async (_u, _id, after, limit = 1000) => Array.from({ length: Math.min(limit, 2501 - after) }, (_, i) => ({ id: after + i + 1, at: "now", level: "info", message: "x" })));
  });
  it("drains every finished log page before the final state", async () => {
    const req = new NextRequest("http://localhost/api/deployments/d/stream", { headers: { cookie: "egg_session=token" } });
    const res = await GET(req, { params: Promise.resolve({ id: "d" }) });
    const body = await res.text();
    expect(body.match(/event: log/g)).toHaveLength(2501);
    expect(body.indexOf("id: 2501")).toBeLessThan(body.indexOf("event: state"));
  });
  it("stops a stream when its session is revoked", async () => {
    mocks.auth.mockResolvedValue(null);
    const req = new NextRequest("http://localhost/api/deployments/d/stream", { headers: { cookie: "egg_session=token" } });
    const res = await GET(req, { params: Promise.resolve({ id: "d" }) });
    expect((await res.text()).includes("event: log")).toBe(false);
  });
  it("fetches bounded pages on demand and stops after cancellation", async () => {
    const req = new NextRequest("http://localhost/api/deployments/d/stream", { headers: { cookie: "egg_session=token" } });
    const res = await GET(req, { params: Promise.resolve({ id: "d" }) });
    const reader = res.body!.getReader();
    await reader.read();
    expect(mocks.logs).toHaveBeenCalledTimes(1);
    expect(mocks.logs.mock.calls[0][3]).toBe(100);
    await reader.cancel();
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(mocks.logs).toHaveBeenCalledTimes(1);
  });
  it("rechecks a session before fetching another page", async () => {
    mocks.auth.mockResolvedValueOnce({ id: "u" }).mockResolvedValue(null);
    const req = new NextRequest("http://localhost/api/deployments/d/stream", { headers: { cookie: "egg_session=token" } });
    const res = await GET(req, { params: Promise.resolve({ id: "d" }) });
    const body = await res.text();
    expect(body.match(/event: log/g)).toHaveLength(100);
    expect(body.includes("event: state")).toBe(false);
  });
});
