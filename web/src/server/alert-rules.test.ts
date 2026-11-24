import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { upsertUser } from "@/server/auth/session";
import { createProject } from "@/server/projects";
import { createRule, deleteRule, listRules, RULE_LIMIT_PER_APP, setRulePaused, evaluateRules } from "@/server/alert-rules";
import { createServer } from "@/server/servers";
import { useFreshDb } from "@/server/test/db";
import {
  displayStatus,
  INITIAL_RULE_STATE,
  metricValue,
  nextRuleState,
  RULE_STALE_MS,
  transitionOf,
  type RuleInput,
  type RuleState,
} from "@/server/alert-rules";

const T0 = new Date("2026-04-01T09:00:00Z");
const MIN = 60_000;
const at = (m: number) => new Date(T0.getTime() + m * MIN);

/** CPU above 80% for 2 minutes. */
const rule: RuleInput = { comparison: "above", threshold: 80, durationMinutes: 2 };

/** Feed a series of (minute, value) readings through the machine, keeping every state. */
function run(readings: [number, number | null][], r: RuleInput = rule, start: RuleState = INITIAL_RULE_STATE) {
  let state = start;
  const out: RuleState[] = [];
  for (const [m, v] of readings) {
    state = nextRuleState(state, v, r, at(m));
    out.push(state);
  }
  return out;
}

describe("nextRuleState", () => {
  it("stays OK while the value is under the line", () => {
    const [a, b] = run([[0, 10], [1, 79.9]]);
    expect(a.status).toBe("ok");
    expect(b.status).toBe("ok");
  });

  it("is Over threshold while breaching, before the duration has passed", () => {
    const [a, b] = run([[0, 90], [1, 95]]);
    expect(a.status).toBe("over");
    expect(b.status).toBe("over");
    // The breach timer starts at the first breaching reading.
    expect(b.breachSince?.getTime()).toBe(at(0).getTime());
  });

  it("becomes Firing once it has stayed over for the full duration", () => {
    const states = run([[0, 90], [1, 90], [2, 90]]);
    expect(states.map((s) => s.status)).toEqual(["over", "over", "firing"]);
  });

  it("a duration of zero fires on the first breaching reading", () => {
    const [a] = run([[0, 90]], { ...rule, durationMinutes: 0 });
    expect(a.status).toBe("firing");
  });

  it("a dip below the line resets the wait, so it does not fire", () => {
    const states = run([[0, 90], [1, 50], [2, 90], [3, 90], [4, 90]]);
    // The third reading starts a new breach; only at the fifth is it two minutes long.
    expect(states[1].status).toBe("ok");
    expect(states[2].status).toBe("over");
    expect(states[3].status).toBe("over");
    expect(states[4].status).toBe("firing");
  });

  it("Firing becomes Recovering when the value drops back under the line", () => {
    const states = run([[0, 90], [1, 90], [2, 90], [3, 40]]);
    expect(states[3].status).toBe("recovering");
    expect(states[3].recoverSince?.getTime()).toBe(at(3).getTime());
  });

  it("Recovering becomes OK only after it has been under the line for the duration", () => {
    const states = run([[0, 90], [1, 90], [2, 90], [3, 40], [4, 40], [5, 40]]);
    expect(states.slice(3).map((s) => s.status)).toEqual(["recovering", "recovering", "ok"]);
  });

  it("going over again while Recovering fires straight away, without a new wait", () => {
    const states = run([[0, 90], [1, 90], [2, 90], [3, 40], [4, 90]]);
    expect(states[3].status).toBe("recovering");
    expect(states[4].status).toBe("firing");
  });

  it("a rule that was only Over threshold and drops back goes straight to OK", () => {
    const states = run([[0, 90], [1, 40]]);
    expect(states[1].status).toBe("ok");
  });

  it("no reading gives No data and keeps the breach timer, so it resumes from there", () => {
    const states = run([[0, 90], [1, null], [2, 90]]);
    expect(states[1].status).toBe("no_data");
    expect(states[1].breachSince?.getTime()).toBe(at(0).getTime());
    // Still counting from minute 0, so minute 2 is the full two minutes.
    expect(states[2].status).toBe("firing");
  });

  it("supports a below comparison", () => {
    const below: RuleInput = { comparison: "below", threshold: 10, durationMinutes: 0 };
    expect(run([[0, 5]], below)[0].status).toBe("firing");
    expect(run([[0, 50]], below)[0].status).toBe("ok");
    // Exactly on the line is not breaching for either comparison.
    expect(run([[0, 10]], below)[0].status).toBe("ok");
    expect(run([[0, 80]], rule)[0].status).toBe("ok");
  });
});

describe("transitionOf", () => {
  it("reports fired and resolved, and nothing else", () => {
    expect(transitionOf("over", "firing")).toBe("fired");
    expect(transitionOf("recovering", "firing")).toBe("fired");
    expect(transitionOf("firing", "firing")).toBeNull();
    expect(transitionOf("firing", "recovering")).toBeNull();
    expect(transitionOf("recovering", "ok")).toBe("resolved");
    expect(transitionOf("firing", "ok")).toBe("resolved");
    expect(transitionOf("ok", "over")).toBeNull();
  });
});

describe("displayStatus", () => {
  const fresh = { paused: false, status: "firing" as const, evaluatedAt: at(0) };

  it("shows Off for a paused rule whatever its stored state", () => {
    expect(displayStatus({ ...fresh, paused: true }, at(0))).toBe("off");
  });

  it("shows No data when it has never been evaluated, or the reading is stale", () => {
    expect(displayStatus({ ...fresh, evaluatedAt: null }, at(0))).toBe("no_data");
    expect(displayStatus(fresh, new Date(at(0).getTime() + RULE_STALE_MS + 1))).toBe("no_data");
  });

  it("shows the stored state while the reading is fresh", () => {
    expect(displayStatus(fresh, at(1))).toBe("firing");
  });
});

describe("metricValue", () => {
  it("reads the value each metric names, and null when it was not read", () => {
    const reading = { cpuPercent: 12, memMb: 340, healthMs: null };
    expect(metricValue("cpu_percent", reading)).toBe(12);
    expect(metricValue("memory_mb", reading)).toBe(340);
    expect(metricValue("latency_ms", reading)).toBeNull();
  });
});

describe("alert rules for an app", () => {
  let ctx: Awaited<ReturnType<typeof useFreshDb>>;
  let userId: string;
  let projectId: string;
  let port = 4100;

  beforeAll(async () => {
    ctx = await useFreshDb();
    userId = (await upsertUser({ id: "rules-owner", name: "Rules Owner", email: null, slackId: null })).id;
    const serverId = (await createServer(userId, "rules-server")).id;
    projectId = (
      await createProject(userId, {
        serverId,
        name: "Rules App",
        repoUrl: "https://github.com/example/demo",
        runtime: "node",
        startCommand: "node server.js",
        port: port++,
      })
    ).id;
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  const body = { metric: "cpu_percent", comparison: "above", threshold: 80, durationMinutes: 2 };

  it("allows 25 rules per app and refuses the 26th", async () => {
    for (let i = 0; i < RULE_LIMIT_PER_APP; i++) {
      await createRule(userId, projectId, { ...body, threshold: 50 + i });
    }
    await expect(createRule(userId, projectId, body)).rejects.toMatchObject({ status: 409 });
    expect(await listRules(userId, projectId)).toHaveLength(RULE_LIMIT_PER_APP);
  });

  it("pauses a rule (shown as Off) and resumes it from a clean state", async () => {
    const first = (await listRules(userId, projectId))[0];
    const paused = await setRulePaused(userId, projectId, first.id, true);
    expect(paused.status).toBe("off");
    const resumed = await setRulePaused(userId, projectId, first.id, false);
    expect(resumed.paused).toBe(false);
    // Resuming has no reading yet, so the rule shows No data rather than an old state.
    expect(resumed.status).toBe("no_data");
  });

  it("paused rules are not evaluated", async () => {
    const r = (await listRules(userId, projectId))[1];
    await setRulePaused(userId, projectId, r.id, true);
    const before = (await listRules(userId, projectId)).find((x) => x.id === r.id)!;
    await evaluateRules(projectId, { cpuPercent: 999, memMb: null, healthMs: null }, at(0));
    const after = (await listRules(userId, projectId)).find((x) => x.id === r.id)!;
    expect(after.lastValue).toBe(before.lastValue);
    expect(after.status).toBe("off");
  });

  it("deletes a rule", async () => {
    const r = (await listRules(userId, projectId))[2];
    await deleteRule(userId, projectId, r.id);
    expect((await listRules(userId, projectId)).map((x) => x.id)).not.toContain(r.id);
  });

  it("refuses a rule with a bad threshold or duration", async () => {
    await expect(createRule(userId, projectId, { ...body, threshold: -1 })).rejects.toThrow();
    await expect(createRule(userId, projectId, { ...body, durationMinutes: 1.5 })).rejects.toThrow();
    await expect(createRule(userId, projectId, { ...body, metric: "restarts" })).rejects.toThrow();
  });
});
