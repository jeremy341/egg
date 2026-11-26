import { describe, expect, it } from "vitest";
import type { Marks, OnboardingFacts } from "@/lib/onboarding-marks";
import { SEGMENTS, failedTestStep, fillTokens, type Context } from "@/lib/onboarding";
import {
  NO_SIGNALS,
  currentView,
  liveCardDue,
  replayTarget,
  signalsKey,
  variantFrom,
  type Signals,
  type View,
} from "@/lib/onboarding-flow";

const NONE: OnboardingFacts = { servers: [], projectCount: 0, firstProject: null, firstDeployment: null, hasActiveDomain: false };
const PENDING: OnboardingFacts = { ...NONE, servers: [{ status: "pending" }] };
const CONNECTED: OnboardingFacts = { ...NONE, servers: [{ status: "connected" }] };
const BUILDING: OnboardingFacts = { ...CONNECTED, projectCount: 1, firstProject: { slug: "blog" }, firstDeployment: { state: "building" } };
const READY: OnboardingFacts = { ...BUILDING, firstDeployment: { state: "ready" } };
const LIVE: OnboardingFacts = { ...READY, hasActiveDomain: true };

const sig = (over: Partial<Signals> = {}): Signals => ({ ...NO_SIGNALS, ...over });
const segment = (id: string) => SEGMENTS.find((s) => s.id === id)!;

function view(id: string, facts: OnboardingFacts, signals: Signals, acks: string[] = [], replay = false): View | null {
  const ctx: Context = {
    path: segment(id).route,
    facts,
    marks: {},
    variant: variantFrom(signals),
    replay: replay ? segment(id).chapter : undefined,
  };
  return currentView({ segment: segment(id), ctx, signals, acks: new Set(acks), replay });
}

describe("chapter 1", () => {
  it("welcome, then the connect button", () => {
    expect(view("connect-projects", NONE, sig())?.step.title).toBe("Put your app on Nest.");
    const next = view("connect-projects", NONE, sig(), ["connect-projects:0"]);
    expect(next?.step.anchor).toBe("connect-server");
    expect(next?.backKey).toBe("connect-projects:0");
  });

  it("asks for the username while there is no server", () => {
    expect(view("connect-setup", NONE, sig({ present: ["nest-username"] }))?.step.anchor).toBe("nest-username");
  });

  it("resumes at the key for a server that is not connected, then the test after Next", () => {
    const key = view("connect-setup", PENDING, sig({ present: ["public-key"] }));
    expect(key?.step.anchor).toBe("public-key");
    const test = view("connect-setup", PENDING, sig({ present: ["test-connection"] }), ["connect-setup:1"]);
    expect(test?.step.anchor).toBe("test-connection");
    expect(test?.backKey).toBe("connect-setup:1");
  });

  it("points at the fingerprint, never at the Confirm button, while the first connection waits", () => {
    const v = view("connect-setup", PENDING, sig({ present: ["host-key", "test-connection"] }), ["connect-setup:1"]);
    expect(v?.step.anchor).toBe("host-key");
    expect(v?.step.kind).toBe("do");
    expect(v?.backKey).toBeUndefined();
  });

  it("swaps in the failure step, with the page's reason, and does not advance", () => {
    const v = view("connect-setup", PENDING, sig({ present: ["test-connection", "test-failure"], testFailure: "Permission denied (publickey)" }), ["connect-setup:1"]);
    expect(v?.key).toBe("connect-setup:failed");
    expect(v?.step.title).toBe("That did not work.");
    expect(v?.step.body).toContain("Permission denied (publickey).");
    expect(v?.step.anchor).toBe("test-connection");
  });

  it("shows Connected and marks the chapter done when the server connects", () => {
    const v = view("connect-setup", CONNECTED, sig());
    expect(v?.step.title).toBe("Connected.");
    expect(v?.mark).toEqual({ chapter: "connect", status: "done" });
    expect(v?.step.next).toBe("/new");
  });

  it("counts only the steps that apply", () => {
    const v = view("connect-setup", PENDING, sig({ present: ["public-key"] }));
    expect(v?.position).toBe(1);
    expect(v?.total).toBe(3);
  });
});

describe("chapter 2", () => {
  it.each([
    ["installed", "Pick your repository."],
    ["not-installed", "Connect GitHub."],
    ["not-configured", "Paste a repository URL."],
  ] as const)("variant %s", (github, title) => {
    expect(view("import-new", CONNECTED, sig({ present: ["repo-source"], github }))?.step.title).toBe(title);
  });

  it("waits while the source is not drawn yet", () => {
    expect(view("import-new", CONNECTED, sig())).toBeNull();
  });

  it("goes settings, conflicts (only when listed), then Deploy", () => {
    const base = { present: ["project-settings", "deploy"] };
    expect(view("import-new", CONNECTED, sig(base))?.step.anchor).toBe("project-settings");
    expect(view("import-new", CONNECTED, sig(base), ["import-new:3"])?.step.anchor).toBe("deploy");
    const withConflicts = sig({ present: [...base.present, "container-conflicts"] });
    expect(view("import-new", CONNECTED, withConflicts, ["import-new:3"])?.step.anchor).toBe("container-conflicts");
    expect(view("import-new", CONNECTED, withConflicts, ["import-new:3", "import-new:4"])?.step.anchor).toBe("deploy");
  });
});

describe("chapter 3", () => {
  const dep = (state: string, port: number | null = 3000) => sig({ present: ["deployment-status", "build-logs"], deployment: { state, port } });

  it("watches the build, then waits quietly after Got it", () => {
    expect(view("deploy-deployment", BUILDING, dep("building"))?.step.anchor).toBe("build-logs");
    expect(view("deploy-deployment", BUILDING, dep("building"), ["deploy-deployment:0"])).toBeNull();
  });

  it("says the app is running when the page shows ready, and marks the chapter done", () => {
    const v = view("deploy-deployment", READY, dep("ready", 4321), ["deploy-deployment:0"]);
    expect(v?.step.title).toBe("Your app is running.");
    expect(v?.mark).toEqual({ chapter: "deploy", status: "done" });
    expect(fillTokens(v!.step.body, { port: 4321 })).toContain("port 4321");
  });

  it("shows the failure step and pauses the chapter", () => {
    const v = view("deploy-deployment", BUILDING, sig({ present: ["error-summary"], deployment: { state: "error", port: 3000 } }));
    expect(v?.step.title).toBe("The build failed.");
    expect(v?.mark).toEqual({ chapter: "deploy", status: "paused" });
  });

  it("shows nothing for a canceled deployment or before the page has one", () => {
    expect(view("deploy-deployment", BUILDING, dep("canceled"))).toBeNull();
    expect(view("deploy-deployment", BUILDING, sig())).toBeNull();
  });
});

describe("chapter 4", () => {
  it("form with no domain, then steps, then check", () => {
    expect(view("address-domains", READY, sig({ present: ["domain-form"] }))?.step.anchor).toBe("domain-form");
    const waiting = sig({ present: ["domain-form", "domain-steps", "domain-check"] });
    expect(view("address-domains", READY, waiting)?.step.anchor).toBe("domain-steps");
    expect(view("address-domains", READY, waiting, ["address-domains:1"])?.step.anchor).toBe("domain-check");
  });

  it("a domain saved as active is not the goal: the steps stay until a check gets an answer", () => {
    const saved = sig({ present: ["domain-form", "domain-steps", "domain-check", "visit"] });
    expect(view("address-domains", LIVE, saved)?.step.anchor).toBe("domain-steps");
    expect(view("address-domains", LIVE, saved, ["address-domains:1"])?.step.anchor).toBe("domain-check");
  });

  it("closes with the live card and marks the chapter done when the app answered a check", () => {
    const v = view("address-domains", LIVE, sig({ present: ["visit", "app-answers"] }));
    expect(v?.key).toBe("live");
    expect(v?.mark).toEqual({ chapter: "address", status: "done" });
    expect(v?.step.anchor).toBe("visit");
  });

  it("a replay keeps showing the steps even with an active domain", () => {
    expect(view("address-domains", LIVE, sig({ present: ["domain-form"] }), [], true)?.step.anchor).toBe("domain-form");
  });
});

describe("liveCardDue", () => {
  const marks: Marks = { connect: "done", import: "done", deploy: "done" };
  it("is due on the domains page or a deployment page once the address is active and a check got an answer", () => {
    expect(liveCardDue({ path: "/domains", facts: LIVE, marks, answers: true })).toBe(true);
    expect(liveCardDue({ path: "/projects/blog/deployments/d1", facts: LIVE, marks, answers: true })).toBe(true);
  });
  it("is not due when nothing shows the address works", () => {
    expect(liveCardDue({ path: "/domains", facts: LIVE, marks, answers: false })).toBe(false);
  });
  it("is not due elsewhere, without an active domain, when closed, or for someone who was not guided", () => {
    expect(liveCardDue({ path: "/projects", facts: LIVE, marks, answers: true })).toBe(false);
    expect(liveCardDue({ path: "/domains", facts: READY, marks, answers: true })).toBe(false);
    expect(liveCardDue({ path: "/domains", facts: LIVE, marks: { ...marks, address: "done" }, answers: true })).toBe(false);
    expect(liveCardDue({ path: "/domains", facts: LIVE, marks: { ...marks, address: "skipped" }, answers: true })).toBe(false);
    expect(liveCardDue({ path: "/domains", facts: LIVE, marks: {}, answers: true })).toBe(false);
  });
});

describe("replayTarget", () => {
  it("picks the chapter from where the account stands", () => {
    expect(replayTarget({ serverStatuses: [], projectCount: 0 })).toEqual({ chapter: "connect", path: "/projects" });
    expect(replayTarget({ serverStatuses: ["pending"], projectCount: 0 })).toEqual({ chapter: "connect", path: "/connect" });
    expect(replayTarget({ serverStatuses: ["connected"], projectCount: 0 })).toEqual({ chapter: "import", path: "/new" });
    expect(replayTarget({ serverStatuses: ["connected"], projectCount: 2 })).toEqual({ chapter: "address", path: "/domains" });
  });
});

describe("failedTestStep and signals", () => {
  it("keeps the reason to one short sentence", () => {
    const long = `Something broke ${"word ".repeat(80)}`;
    const step = failedTestStep(long);
    expect(step.body.length).toBeLessThanOrEqual(260);
    expect(step.body).toMatch(/Fix that, then press Test connection again\.$/);
    expect(failedTestStep(null).body).toBe("Fix that, then press Test connection again.");
    expect(step.title).not.toMatch(/[—–!]/);
  });

  it("tells a change in the signals", () => {
    expect(signalsKey(sig({ present: ["a", "b"] }))).toBe(signalsKey(sig({ present: ["b", "a"] })));
    expect(signalsKey(sig({ present: ["a"] }))).not.toBe(signalsKey(sig({ present: ["a"], testFailure: "x" })));
  });

  it("reads the variant from the page", () => {
    expect(variantFrom(sig({ present: ["host-key"] })).hostKeyPending).toBe(true);
    expect(variantFrom(sig()).github).toBe("not-configured");
    expect(variantFrom(sig({ deployment: { state: "error", port: null } })).deploymentFailed).toBe(true);
  });
});
