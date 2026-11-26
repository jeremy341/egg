import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { schema } from "@/server/db";
import {
  PROBE_KEEP_MS,
  SLOW_MS,
  buildNestStatus,
  incidentsFromProbes,
  median,
  overallState,
  probeEgg,
  probeStrip,
  probeUrl,
  pruneStatusProbes,
  runStatusProbes,
  targetState,
  type TargetState,
} from "@/server/nest-status";
import { useFreshDb } from "@/server/test/db";

const DAY = 86_400_000;
const MIN = 60_000;
const now = new Date("2026-11-09T12:00:00Z");

const reply = (status: number) => (async () => new Response("", { status })) as unknown as typeof fetch;

/** A fake clock that moves `ms` forward on each reading, so a probe measures exactly that. */
function clockOf(ms: number) {
  let t = 1000;
  let call = 0;
  return () => (call++ === 0 ? t : (t += ms));
}

describe("probeUrl", () => {
  it("is ok on a 200, with the status and the time it took", async () => {
    const r = await probeUrl("https://example.test", { fetch: reply(200), clock: clockOf(240) });
    expect(r).toEqual({ ok: true, httpStatus: 200, latencyMs: 240 });
  });

  it("counts a 4xx as an answer", async () => {
    const r = await probeUrl("https://example.test", { fetch: reply(404), clock: clockOf(50) });
    expect(r.ok).toBe(true);
    expect(r.httpStatus).toBe(404);
  });

  it("fails on a 5xx and keeps the status", async () => {
    const r = await probeUrl("https://example.test", { fetch: reply(503), clock: clockOf(50) });
    expect(r).toEqual({ ok: false, httpStatus: 503, latencyMs: 50 });
  });

  it("fails when nothing answers", async () => {
    const refused = (async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    expect(await probeUrl("https://example.test", { fetch: refused })).toEqual({ ok: false, httpStatus: null, latencyMs: null });
  });

  it("fails on a timeout, and asks fetch to give up after the limit", async () => {
    let seen: AbortSignal | undefined;
    const hang = ((_u: string, init: RequestInit) => {
      seen = init.signal ?? undefined;
      return new Promise((_, reject) => init.signal?.addEventListener("abort", () => reject(init.signal?.reason)));
    }) as unknown as typeof fetch;
    const r = await probeUrl("https://example.test", { fetch: hang, timeoutMs: 20 });
    expect(r).toEqual({ ok: false, httpStatus: null, latencyMs: null });
    expect(seen?.aborted).toBe(true);
  });

  it("sends the plain status-check user agent and nothing about a user", async () => {
    const fake = vi.fn(reply(200));
    await probeUrl("https://example.test", { fetch: fake });
    const init = (fake.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(init.headers).toEqual({ "user-agent": "Egg-status-check" });
  });
});

describe("probeEgg", () => {
  it("is ok when the query answers", async () => {
    const r = await probeEgg(async () => 1, { clock: clockOf(7) });
    expect(r).toEqual({ ok: true, httpStatus: null, latencyMs: 7 });
  });

  it("fails when the query throws or does not answer in time", async () => {
    expect((await probeEgg(async () => { throw new Error("database is locked"); })).ok).toBe(false);
    expect((await probeEgg(() => new Promise(() => undefined), { timeoutMs: 20 })).ok).toBe(false);
  });
});

describe("targetState", () => {
  const good = { ok: true, latencyMs: 300 };
  const bad = { ok: false, latencyMs: null };

  it("is up after a normal answer", () => {
    expect(targetState([good, good])).toBe("up");
  });

  it("is slow when the newest answer took longer than two seconds", () => {
    expect(targetState([{ ok: true, latencyMs: SLOW_MS + 1 }, good])).toBe("slow");
    expect(targetState([{ ok: true, latencyMs: SLOW_MS }, good])).toBe("up");
  });

  it("stays up after one failure", () => {
    expect(targetState([bad, good])).toBe("up");
    expect(targetState([bad, { ok: true, latencyMs: 5000 }])).toBe("slow");
  });

  it("is down after two failures in a row", () => {
    expect(targetState([bad, bad, good])).toBe("down");
  });

  it("is up again at the first answer after being down", () => {
    expect(targetState([good, bad, bad])).toBe("up");
  });

  it("is unknown with nothing to go on, and after a single first failure", () => {
    expect(targetState([])).toBe("unknown");
    expect(targetState([bad])).toBe("unknown");
  });
});

describe("overallState", () => {
  const s = (a: TargetState, b: TargetState, egg: TargetState = "up") => overallState({ "nest-site": a, "nest-app": b, egg });
  it("says working only when everything is up", () => {
    expect(s("up", "up")).toBe("ok");
  });
  it("says degraded when one Nest target is slow or down, or Egg is", () => {
    expect(s("slow", "up")).toBe("degraded");
    expect(s("up", "down")).toBe("degraded");
    expect(s("up", "up", "down")).toBe("degraded");
  });
  it("says down only when both Nest targets are down", () => {
    expect(s("down", "down")).toBe("down");
  });
  it("says unknown when Nest has not been checked", () => {
    expect(s("unknown", "unknown")).toBe("unknown");
  });
});

describe("incidentsFromProbes and probeStrip", () => {
  const at = (iso: string) => new Date(iso);
  const run = (start: string, oks: boolean[]) =>
    oks.map((ok, i) => ({ at: new Date(at(start).getTime() + i * MIN), ok }));

  it("opens an outage on the second failure in a row and closes it at the next answer", () => {
    const samples = run("2026-11-08T10:00:00Z", [true, false, false, false, true]);
    expect(incidentsFromProbes(samples, now)).toEqual([
      { from: at("2026-11-08T10:02:00Z"), to: at("2026-11-08T10:04:00Z") },
    ]);
  });

  it("does not open one for a single failure", () => {
    expect(incidentsFromProbes(run("2026-11-08T10:00:00Z", [true, false, true, false, true]), now)).toEqual([]);
  });

  it("does not count a stopped worker as downtime", () => {
    const samples = [...run("2026-11-08T10:00:00Z", [true, false, false]), { at: at("2026-11-08T20:00:00Z"), ok: true }];
    const [incident] = incidentsFromProbes(samples, now);
    expect(incident.to).toEqual(at("2026-11-08T10:02:00Z"));
  });

  it("marks days up, partial and down by the project status page rules, and no checks as none", () => {
    const samples = [
      // 2026-11-07: answered all day (a check every hour)
      ...Array.from({ length: 24 }, (_, i) => ({ at: new Date(Date.UTC(2026, 10, 7, i)), ok: true })),
      // 2026-11-08: down for 90 minutes
      { at: at("2026-11-08T10:00:00Z"), ok: true },
      // One check a minute fails from 10:01, so the outage starts at 10:02 and ends at the 11:30 answer.
      ...Array.from({ length: 89 }, (_, i) => ({ at: new Date(at("2026-11-08T10:01:00Z").getTime() + i * MIN), ok: false })),
      { at: at("2026-11-08T11:30:00Z"), ok: true },
    ];
    const days = probeStrip(samples, now, 5);
    expect(days.map((d) => d.day)).toEqual(["2026-11-05", "2026-11-06", "2026-11-07", "2026-11-08", "2026-11-09"]);
    const byDay = Object.fromEntries(days.map((d) => [d.day, d.state]));
    expect(byDay["2026-11-05"]).toBe("none");
    expect(byDay["2026-11-07"]).toBe("up");
    expect(byDay["2026-11-08"]).toBe("partial");
    expect(days.find((d) => d.day === "2026-11-08")?.downMinutes).toBe(88);
    expect(byDay["2026-11-09"]).toBe("none");
  });

  it("marks a day down when it was down for most of it", () => {
    const dense = Array.from({ length: 20 * 12 }, (_, i) => ({ at: new Date(at("2026-11-08T00:00:00Z").getTime() + i * 5 * MIN), ok: false }));
    dense.push({ at: at("2026-11-08T20:00:00Z"), ok: true });
    expect(probeStrip(dense, now, 3).find((d) => d.day === "2026-11-08")?.state).toBe("down");
  });

  it("is all none when nothing has been checked", () => {
    expect(probeStrip([], now, 30).every((d) => d.state === "none")).toBe(true);
  });
});

describe("median", () => {
  it("takes the middle value, and the mean of the two middle ones", () => {
    expect(median([5, 1, 3])).toBe(3);
    expect(median([1, 2, 3, 4])).toBe(3);
    expect(median([])).toBeNull();
  });
});

describe("storage", () => {
  let ctx: Awaited<ReturnType<typeof useFreshDb>>;
  beforeAll(async () => {
    ctx = await useFreshDb();
  });
  afterAll(async () => {
    await ctx.cleanup();
  });
  beforeEach(async () => {
    await ctx.db.delete(schema.statusProbes);
  });

  const row = (target: "nest-site" | "nest-app" | "egg", checkedAt: Date, ok = true, latencyMs: number | null = 200) => ({
    target,
    checkedAt,
    ok,
    httpStatus: target === "egg" ? null : ok ? 200 : 503,
    latencyMs,
  });

  it("prunes probes older than 90 days and keeps the rest", async () => {
    await ctx.db.insert(schema.statusProbes).values([
      row("nest-site", new Date(now.getTime() - PROBE_KEEP_MS - 1000)),
      row("egg", new Date(now.getTime() - 100 * DAY)),
      row("nest-site", new Date(now.getTime() - PROBE_KEEP_MS + 1000)),
      row("nest-app", new Date(now.getTime() - MIN)),
    ]);
    await pruneStatusProbes(now);
    const left = await ctx.db.select().from(schema.statusProbes);
    expect(left).toHaveLength(2);
    expect(left.every((r) => r.checkedAt.getTime() >= now.getTime() - PROBE_KEEP_MS)).toBe(true);
  });

  it("the job stores one row per target and prunes in the same run", async () => {
    await ctx.db.insert(schema.statusProbes).values(row("egg", new Date(now.getTime() - 120 * DAY)));
    const fake = vi.fn(async (url: string | URL | Request) =>
      new Response("", { status: String(url).includes("hackclub.app") ? 503 : 200 })
    ) as unknown as typeof fetch;
    await runStatusProbes(now, { fetch: fake, eggCheck: async () => 1 });
    const rows = await ctx.db.select().from(schema.statusProbes);
    expect(rows.map((r) => r.target).sort()).toEqual(["egg", "nest-app", "nest-site"]);
    expect(rows.find((r) => r.target === "nest-site")).toMatchObject({ ok: true, httpStatus: 200 });
    expect(rows.find((r) => r.target === "nest-app")).toMatchObject({ ok: false, httpStatus: 503 });
    expect(rows.find((r) => r.target === "egg")).toMatchObject({ ok: true, httpStatus: null });
    expect(rows.every((r) => r.checkedAt.getTime() === now.getTime())).toBe(true);
  });

  it("the job records a failed database check without stopping the others", async () => {
    await runStatusProbes(now, {
      fetch: reply(200),
      eggCheck: async () => {
        throw new Error("locked");
      },
    });
    const rows = await ctx.db.select().from(schema.statusProbes);
    expect(rows).toHaveLength(3);
    expect(rows.find((r) => r.target === "egg")?.ok).toBe(false);
    expect(rows.find((r) => r.target === "nest-site")?.ok).toBe(true);
  });

  it("builds the public status with no data", async () => {
    const s = await buildNestStatus(now, { official: async () => ({ available: false, readAt: now.toISOString() }) });
    expect(s.overall).toEqual({ state: "unknown", text: "No recent checks yet" });
    expect(s.lastCheckAt).toBeNull();
    expect(s.targets.map((t) => t.state)).toEqual(["unknown", "unknown", "unknown"]);
    expect(s.targets[0].days).toHaveLength(30);
    expect(s.targets[0].days.every((d) => d.state === "none")).toBe(true);
    expect(s.official.available).toBe(false);
    expect(s.checkedFrom).toBe("localhost:3000");
  });

  it("builds the public status from stored probes, with the official summary beside and apart", async () => {
    const t = (min: number) => new Date(now.getTime() - min * MIN);
    await ctx.db.insert(schema.statusProbes).values([
      row("nest-site", t(3), true, 300),
      row("nest-site", t(2), true, 500),
      row("nest-site", t(1), true, 400),
      row("nest-app", t(2), false, null),
      row("nest-app", t(1), false, null),
      row("egg", t(1), true, 3),
    ]);
    const official = { available: true as const, summary: "Partial System Outage", statusClass: "bg-down", readAt: now.toISOString() };
    const s = await buildNestStatus(now, { official: async () => official });

    expect(s.overall).toEqual({ state: "degraded", text: "Nest is slow or partly down" });
    const [site, app, egg] = s.targets;
    expect(site).toMatchObject({ id: "nest-site", state: "up", httpStatus: 200, latencyMs: 400, median24hMs: 400, median30dMs: 400 });
    expect(site.checkedAt).toBe(t(1).toISOString());
    expect(app).toMatchObject({ id: "nest-app", state: "down", httpStatus: 503, latencyMs: null, median24hMs: null });
    expect(egg).toMatchObject({ id: "egg", state: "up", httpStatus: null, latencyMs: 3 });
    expect(s.lastCheckAt).toBe(t(1).toISOString());
    expect(s.official).toEqual({ ...official, url: "https://status.hackclub.app" });
    // Only public figures leave the server.
    expect(Object.keys(s).sort()).toEqual(["checkedFrom", "intervalSeconds", "lastCheckAt", "official", "overall", "targets", "windowDays"]);
  });

  it("calls a target unknown when its newest check is stale", async () => {
    await ctx.db.insert(schema.statusProbes).values(row("nest-site", new Date(now.getTime() - 30 * MIN)));
    const s = await buildNestStatus(now, { official: async () => ({ available: false, readAt: now.toISOString() }) });
    expect(s.targets[0].state).toBe("unknown");
  });
});
