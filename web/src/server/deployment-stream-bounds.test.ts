import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { MAX_DEPLOYMENT_STREAMS_TOTAL, resetDeploymentStreams } from "@/server/deployment-streams";
const mocks = vi.hoisted(() => ({ logs: vi.fn(), auth: vi.fn(), owned: vi.fn(), state: vi.fn(), authed: vi.fn() }));
vi.mock("@/server/http", () => ({
  authed: mocks.authed,
  handle: (fn: unknown) => fn,
  HttpError: class HttpError extends Error {
    constructor(
      public status: number,
      message: string,
      public code: string,
      public headers?: Record<string, string>
    ) {
      super(message);
    }
  },
}));
vi.mock("@/server/auth/session", () => ({ SESSION_COOKIE: "egg_session", userForSessionToken: mocks.auth }));
vi.mock("@/server/projects", () => ({ deploymentLogs: mocks.logs, ownedDeployment: mocks.owned, readableDeployment: mocks.owned }));
vi.mock("@/server/db", () => ({ schema: { deployments: { id: "id", state: "state", error: "error" } }, getDb: async () => ({ select: () => ({ from: () => ({ where: () => ({ get: mocks.state }) }) }) }) }));
import { GET } from "@/app/api/deployments/[id]/stream/route";

describe("deployment event stream", () => {
  beforeEach(() => {
    resetDeploymentStreams();
    mocks.authed.mockReset().mockResolvedValue({ id: "u" });
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
  it("holds three streams for one user, and frees the slot when a stream ends", async () => {
    const open = () => GET(new NextRequest("http://localhost/api/deployments/d/stream", { headers: { cookie: "egg_session=token" } }), { params: Promise.resolve({ id: "d" }) });
    // The route helpers are mocked here, so a refusal surfaces as the thrown HttpError itself.
    const statusOf = (p: Promise<Response>) => p.then((r) => r.status, (e) => (e as { status: number }).status);
    const held = await Promise.all([open(), open(), open()]);
    expect(held.map((r) => r.status)).toEqual([200, 200, 200]);
    expect(await statusOf(open())).toBe(429);
    // The first stream runs to its end, so its slot comes back.
    await held[0].text();
    expect(await statusOf(open())).toBe(200);
  });
  it("gives the slot back when the client cancels", async () => {
    const first = await GET(new NextRequest("http://localhost/api/deployments/d/stream", { headers: { cookie: "egg_session=token" } }), { params: Promise.resolve({ id: "d" }) });
    expect(first.status).toBe(200);
    await first.body!.cancel();
    await new Promise((resolve) => setTimeout(resolve, 20));
    const next = await GET(new NextRequest("http://localhost/api/deployments/d/stream", { headers: { cookie: "egg_session=token" } }), { params: Promise.resolve({ id: "d" }) });
    expect(next.status).toBe(200);
  });
  it("holds an instance-wide ceiling across users, and frees a slot when a stream ends", async () => {
    const statusOf = (p: Promise<Response>) => p.then((r) => r.status, (e) => (e as { status: number }).status);
    // Each stream re-checks its session by token, so give every test user a matching cookie token.
    mocks.auth.mockReset().mockImplementation(async (token: string) => ({ id: token }));
    const open = (id: string) => {
      mocks.authed.mockResolvedValueOnce({ id });
      return GET(
        new NextRequest("http://localhost/api/deployments/d/stream", { headers: { cookie: `egg_session=${id}` } }),
        { params: Promise.resolve({ id: "d" }) }
      );
    };
    const held: Response[] = [];
    for (let i = 0; i < MAX_DEPLOYMENT_STREAMS_TOTAL; i++) {
      const res = await open(`g${i}`);
      expect(res.status).toBe(200);
      held.push(res);
    }
    // A different user cannot take one more once the process-wide ceiling is reached.
    expect(await statusOf(open("overflow"))).toBe(429);
    // Cancelling a stream returns its slot to the shared pool.
    await held[0].body!.cancel();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(await statusOf(open("after"))).toBe(200);
    for (const res of held.slice(1)) await res.body!.cancel();
  });
});
