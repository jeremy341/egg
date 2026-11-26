import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { TerminalManager } from "@/server/terminal";
import type { ShellHandle } from "@/server/ssh/shell";
import { RATE_LIMITS, rateLimiter } from "@/server/rate-limit";

// Beyond the user id, none of these routes touch the database or the container on the paths below.
const auth = vi.hoisted(() => ({ user: null as { id: string } | null }));
vi.mock("@/server/auth/current", () => ({ getCurrentUser: async () => auth.user }));
vi.mock("@/server/permission-guards", () => ({ requireProjectFeature: async () => ({}) }));

const remote = vi.hoisted(() => ({ restarts: 0, usage: 0, logPages: 0 }));
vi.mock("@/server/runtime-info", () => ({
  restartService: async () => void remote.restarts++,
  fetchUsage: async () => void remote.usage++,
  fetchRuntimeLogPage: async () => void remote.logPages++,
}));
vi.mock("@/server/service-status", () => ({ forgetServiceStatus: () => {} }));

import { POST as restart } from "@/app/api/projects/[id]/restart/route";
import { GET as runtimeLogs } from "@/app/api/projects/[id]/runtime-logs/route";
import { GET as usage } from "@/app/api/servers/[id]/usage/route";
import { POST as openTerminal } from "@/app/api/projects/[id]/terminal/route";

const ALICE = { id: "user-alice" };
const BOB = { id: "user-bob" };
const ORIGIN = "http://localhost:3000";

class FakeShell implements ShellHandle {
  write() {}
  resize() {}
  onData() {}
  onClose() {}
  close() {}
}

let shells: FakeShell[];

beforeEach(() => {
  auth.user = ALICE;
  rateLimiter().clear();
  remote.restarts = 0;
  remote.usage = 0;
  remote.logPages = 0;
  shells = [];
  const manager = new TerminalManager({
    getProject: async () => ({ id: "p", serverId: "s", slug: "app" }),
    connect: async () => {
      const shell = new FakeShell();
      shells.push(shell);
      return { shell, uid: 0, host: "demo.hackclub.app" };
    },
    audit: async () => {},
  });
  (globalThis as unknown as Record<symbol, unknown>)[Symbol.for("egg.terminal-manager")] = manager;
});

type Ctx = { params: Promise<{ id: string }> };
const ctx = (id: string): Ctx => ({ params: Promise.resolve({ id }) });

function req(path: string, method: string, body?: unknown) {
  return new NextRequest(`${ORIGIN}${path}`, {
    method,
    headers: { "content-type": "application/json", origin: ORIGIN },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe("the slow SSH buckets on the dashboard routes", () => {
  it("caps server usage reads, and shares the budget with journal log pages", async () => {
    for (let i = 0; i < RATE_LIMITS.sshCall.limit; i++) {
      const res = await usage(req("/api/servers/s/usage", "GET"), ctx("s"));
      expect(res.status).toBe(200);
    }
    expect(remote.usage).toBe(RATE_LIMITS.sshCall.limit);
    const blocked = await usage(req("/api/servers/s/usage", "GET"), ctx("s"));
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("retry-after")).toMatch(/^\d+$/);
    // The same small bucket, so a flooding user does not get a second allowance under another name.
    expect((await runtimeLogs(req("/api/projects/p/runtime-logs", "GET"), ctx("p"))).status).toBe(429);
    // Every route that opens an SSH session shares this allowance, so a
    // restart from the flooding user is refused too. Another user has a
    // separate budget and can still read usage and restart.
    expect((await restart(req("/api/projects/p/restart", "POST"), ctx("p"))).status).toBe(429);
    auth.user = BOB;
    expect((await usage(req("/api/servers/s/usage", "GET"), ctx("s"))).status).toBe(200);
    expect((await restart(req("/api/projects/p/restart", "POST"), ctx("p"))).status).toBe(200);
  });

  it("limits service restarts to their own tighter bucket, past which nothing restarts", async () => {
    for (let i = 0; i < RATE_LIMITS.serviceRestart.limit; i++) {
      const res = await restart(req("/api/projects/p/restart", "POST"), ctx("p"));
      expect(res.status).toBe(200);
    }
    expect(remote.restarts).toBe(RATE_LIMITS.serviceRestart.limit);
    const blocked = await restart(req("/api/projects/p/restart", "POST"), ctx("p"));
    expect(blocked.status).toBe(429);
    expect(remote.restarts).toBe(RATE_LIMITS.serviceRestart.limit);
    // Another user's restarts are not counted.
    auth.user = BOB;
    expect((await restart(req("/api/projects/p/restart", "POST"), ctx("p"))).status).toBe(200);
  });

  it("counts opening a terminal against the shared slow SSH bucket", async () => {
    expect((await openTerminal(req("/api/projects/p/terminal", "POST", {}), ctx("p"))).status).toBe(201);
    expect(shells).toHaveLength(1);
    // Another open on the same project lands on the manager's 409, but each attempt still spends from the bucket.
    for (let i = 1; i < RATE_LIMITS.sshCall.limit; i++) {
      expect((await openTerminal(req("/api/projects/p/terminal", "POST", {}), ctx("p"))).status).toBe(409);
    }
    // The next attempt is past the shared bucket and is refused before any SSH work.
    expect((await openTerminal(req("/api/projects/p/terminal", "POST", {}), ctx("p"))).status).toBe(429);
    expect(shells).toHaveLength(1);
  });
});
