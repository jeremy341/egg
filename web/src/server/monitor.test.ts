import { describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { describeAction } from "@/server/audit";
import { FAILURES_BEFORE_DOWN, isHealthy, nextMonitorState, monitorConcurrency, monitorServers } from "@/server/monitor";
import { parseServiceStatus } from "@/server/service-status";
import { upsertUser } from "@/server/auth/session";
import { connectToServer, createServer } from "@/server/servers";
import { NestSession } from "@/server/ssh/connection";
import { useFreshDb } from "@/server/test/db";
import { schema } from "@/server/db";

const status = (lines: string[]) => parseServiceStatus(lines.join("\n"));
const base = ["EGG_LoadState=loaded", "EGG_ActiveState=active", "EGG_SubState=running"];

describe("server monitoring concurrency", () => {
  it("only accepts a safe whole-number concurrency setting", () => {
    expect(monitorConcurrency("1")).toBe(1);
    expect(monitorConcurrency("16")).toBe(16);
    for (const invalid of [undefined, "0", "17", "2.5", "text", ""]) expect(monitorConcurrency(invalid)).toBe(4);
  });
  it("limits simultaneous checks and continues after a server fails", async () => {
    let active = 0;
    let maximum = 0;
    const visited: number[] = [];
    const failures: string[] = [];
    await monitorServers([1, 2, 3, 4, 5, 6], async (server) => {
      active++;
      maximum = Math.max(maximum, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active--;
      visited.push(server);
      if (server === 2) throw new Error("offline");
    }, (err) => failures.push((err as Error).message), 2);
    expect(maximum).toBe(2);
    expect(visited.sort()).toEqual([1, 2, 3, 4, 5, 6]);
    expect(failures).toEqual(["offline"]);
  });

  it("can reserve concurrent SSH checks without dropping servers on SQLite contention", async () => {
    const ctx = await useFreshDb();
    const spy = vi.spyOn(NestSession, "connect").mockImplementation(async () => {
      let onClose = () => {};
      return { hostKeyFingerprint: null, onClosed: (fn: () => void) => { onClose = fn; }, close: () => onClose() } as unknown as NestSession;
    });
    try {
      const user = await upsertUser({ id: "monitor-concurrent", name: "Monitor", email: null, slackId: null });
      const servers = [];
      for (let i = 0; i < 4; i++) servers.push(await createServer(user.id, `monitor-${i}`));
      const failures: unknown[] = [];
      // Each check's reservation row must exist while its session is open.
      const reservedWhileOpen: number[] = [];
      await monitorServers(servers, async (server) => {
        const session = await connectToServer(server, { confirmHostKey: "test-fingerprint" });
        const held = await ctx.db.select().from(schema.cleanupOperations).where(eq(schema.cleanupOperations.serverId, server.id));
        reservedWhileOpen.push(held.length);
        session.close();
      }, (error) => failures.push(error), 4);
      expect(failures).toEqual([]);
      expect(spy).toHaveBeenCalledTimes(4);
      expect(reservedWhileOpen).toEqual([1, 1, 1, 1]);
      // Closing releases each reservation, which happens asynchronously, so wait for the table to empty.
      await vi.waitFor(async () => expect(await ctx.db.select().from(schema.cleanupOperations)).toHaveLength(0));
    } finally {
      spy.mockRestore();
      await ctx.cleanup();
    }
  });
});

describe("isHealthy", () => {
  it("needs a running service that answers", () => {
    expect(isHealthy(status([...base, "EGG_HTTP=200 0.01"]))).toBe(true);
    expect(isHealthy(status([...base, "EGG_HTTP=404 0.01"]))).toBe(true);
  });

  it("fails on server errors and silence", () => {
    expect(isHealthy(status([...base, "EGG_HTTP=502 0.01"]))).toBe(false);
    expect(isHealthy(status([...base, "EGG_HTTP=000 0.00"]))).toBe(false);
  });

  it("fails when the service is not running, however the port answers", () => {
    expect(isHealthy(status(["EGG_LoadState=loaded", "EGG_ActiveState=failed", "EGG_HTTP=200 0.01"]))).toBe(false);
  });

  it("trusts systemd when curl is missing", () => {
    expect(isHealthy(status(base))).toBe(true);
  });
});

describe("nextMonitorState", () => {
  it("does not alert on a single failed check", () => {
    const t = nextMonitorState({ state: "up", failures: 0 }, false);
    expect(t).toEqual({ state: "up", failures: 1, change: null });
  });

  it("alerts once when failures reach the limit, then stays quiet", () => {
    let s = { state: "up" as const, failures: 0 } as { state: "up" | "down" | "unknown"; failures: number };
    const changes: (string | null)[] = [];
    for (let i = 0; i < FAILURES_BEFORE_DOWN + 2; i++) {
      const t = nextMonitorState(s, false);
      changes.push(t.change);
      s = t;
    }
    expect(changes.filter((c) => c === "down")).toHaveLength(1);
    expect(s.state).toBe("down");
  });

  it("announces recovery only after an outage", () => {
    expect(nextMonitorState({ state: "down", failures: 5 }, true)).toEqual({
      state: "up",
      failures: 0,
      change: "up",
    });
    expect(nextMonitorState({ state: "unknown", failures: 0 }, true).change).toBeNull();
    expect(nextMonitorState({ state: "up", failures: 1 }, true).failures).toBe(0);
  });

  it("an app that was never up can still be reported down", () => {
    const first = nextMonitorState({ state: "unknown", failures: 0 }, false);
    const second = nextMonitorState(first, false);
    expect(second.change).toBe("down");
  });
});

describe("describeAction", () => {
  it("has words for known actions and falls back to the raw name", () => {
    expect(describeAction("project.restart")).toBe("Restarted");
    expect(describeAction("something.new")).toBe("something.new");
  });
});
