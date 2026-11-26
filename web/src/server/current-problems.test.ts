import { describe, expect, it } from "vitest";
import { computeProblems, CRASH_RESTARTS, type ProblemInput } from "@/server/current-problems";

const healthy: ProblemInput = {
  lastExitResult: "success",
  recentRestarts: 0,
  latestProduction: { state: "ready", error: null },
  openAlertTypes: [],
  firingRules: 0,
  productionLive: true,
  lastCheckFailed: false,
};

const kinds = (input: Partial<ProblemInput>) => computeProblems({ ...healthy, ...input }).map((p) => p.kind);

describe("computeProblems", () => {
  it("is empty for a healthy app", () => {
    expect(computeProblems(healthy)).toEqual([]);
  });

  it("flags an app killed for running out of memory", () => {
    expect(kinds({ lastExitResult: "oom-kill" })).toEqual(["oom_killed"]);
    expect(kinds({ lastExitResult: "exit-code" })).toEqual([]);
  });

  it("flags a crash loop at three restarts in the window, and not before", () => {
    expect(CRASH_RESTARTS).toBe(3);
    expect(kinds({ recentRestarts: 2 })).toEqual([]);
    const [p] = computeProblems({ ...healthy, recentRestarts: 3 });
    expect(p.kind).toBe("crash_loop");
    expect(p.detail).toContain("restarted 3 times");
  });

  it("flags a failed last production deploy and quotes its error", () => {
    const [p] = computeProblems({ ...healthy, latestProduction: { state: "error", error: "  npm ERR! missing script: build  " } });
    expect(p.kind).toBe("failed_build");
    expect(p.detail).toBe("npm ERR! missing script: build");
  });

  it("does not flag a failed deploy that a later good one replaced", () => {
    // The newest production row is what counts; an older failure is history.
    expect(kinds({ latestProduction: { state: "ready", error: null } })).toEqual([]);
  });

  it("gives a generic failed-build line when the deploy has no error text", () => {
    const [p] = computeProblems({ ...healthy, latestProduction: { state: "error", error: null } });
    expect(p.detail).toContain("did not finish");
  });

  it("flags open alerts and firing rules as one alert problem, with counts", () => {
    const [p] = computeProblems({ ...healthy, openAlertTypes: ["down", "cpu", "down"], firingRules: 2 });
    expect(p.kind).toBe("firing_alert");
    expect(p.detail).toBe("Open: app down, CPU; 2 threshold rules.");
  });

  it("uses the singular for one firing rule", () => {
    const [p] = computeProblems({ ...healthy, firingRules: 1 });
    expect(p.detail).toBe("Open: 1 threshold rule.");
  });

  it("flags a live release whose last check failed, and not one that never had a release", () => {
    expect(kinds({ lastCheckFailed: true })).toEqual(["not_running"]);
    expect(kinds({ lastCheckFailed: true, productionLive: false })).toEqual([]);
    // No check recorded yet says nothing either way.
    expect(kinds({ lastCheckFailed: null })).toEqual([]);
  });

  it("lists every problem, most serious first", () => {
    const all = computeProblems({
      lastExitResult: "oom-kill",
      recentRestarts: 5,
      latestProduction: { state: "error", error: "boom" },
      openAlertTypes: ["down"],
      firingRules: 1,
      productionLive: true,
      lastCheckFailed: true,
    });
    expect(all.map((p) => p.kind)).toEqual(["oom_killed", "crash_loop", "failed_build", "firing_alert", "not_running"]);
  });
});
