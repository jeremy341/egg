import { describe, expect, it } from "vitest";
import type { Marks, OnboardingFacts } from "@/lib/onboarding-marks";
import {
  ANCHORS,
  LIVE_CARD_STEP,
  SEGMENTS,
  deploymentSlug,
  fillTokens,
  normalisePath,
  resolveSteps,
  selectSegment,
  stageOf,
  type Context,
  type Segment,
  type TourStep,
  type Variant,
} from "@/lib/onboarding";

/* ---------- fixtures ---------- */

const NO_SERVER: OnboardingFacts = {
  servers: [],
  projectCount: 0,
  firstProject: null,
  firstDeployment: null,
  hasActiveDomain: false,
};
const PENDING: OnboardingFacts = { ...NO_SERVER, servers: [{ status: "pending" }] };
const CONNECTED: OnboardingFacts = { ...NO_SERVER, servers: [{ status: "connected" }] };
const BUILDING: OnboardingFacts = {
  ...CONNECTED,
  projectCount: 1,
  firstProject: { slug: "blog" },
  firstDeployment: { state: "building" },
};
const FAILED: OnboardingFacts = { ...BUILDING, firstDeployment: { state: "error" } };
const READY: OnboardingFacts = { ...BUILDING, firstDeployment: { state: "ready" } };
const LIVE: OnboardingFacts = { ...READY, hasActiveDomain: true };

const VARIANT: Variant = {
  github: "installed",
  hostKeyPending: false,
  conflicts: false,
  deploymentFailed: false,
  localMode: false,
};

const DEPLOYMENT_PAGE = "/projects/blog/deployments/d1";

function ctx(path: string, facts: OnboardingFacts, marks: Marks = {}, extra: Partial<Context> = {}): Context {
  return { path, facts, marks, variant: VARIANT, ...extra };
}

const idOf = (context: Context) => selectSegment(context)?.id ?? null;

/* ---------- selectSegment ---------- */

describe("selectSegment", () => {
  type Row = [string, Context, string | null];

  const rows: Row[] = [
    // chapter 1
    ["new user on /projects starts the welcome", ctx("/projects", NO_SERVER), "connect-projects"],
    ["new user on /connect starts the setup", ctx("/connect", NO_SERVER), "connect-setup"],
    ["pending server on /connect resumes (back from the Nest dashboard)", ctx("/connect", PENDING), "connect-setup"],
    ["pending server on /projects gets no welcome", ctx("/projects", PENDING), null],
    ["new user on /new gets nothing", ctx("/new", NO_SERVER), null],
    ["connected server on /connect gets nothing (it already has one)", ctx("/connect", CONNECTED), null],
    ["connected server on /projects gets nothing", ctx("/projects", CONNECTED), null],
    ["chapter 1 skipped: not on /projects", ctx("/projects", NO_SERVER, { connect: "skipped" }), null],
    ["chapter 1 skipped: not on /connect", ctx("/connect", PENDING, { connect: "skipped" }), null],
    ["chapter 1 done, server gone again: not started again", ctx("/projects", NO_SERVER, { connect: "done" }), null],
    ["other marks and no server: chapter 1 is not started", ctx("/projects", NO_SERVER, { import: "done" }), null],

    // chapter 2
    ["skipped chapter 1 then /new with a connected server", ctx("/new", CONNECTED, { connect: "skipped" }), null],
    ["skipped chapter 1 then /new with no server", ctx("/new", NO_SERVER, { connect: "skipped" }), null],
    ["connected server, no project, no marks, on /new", ctx("/new", CONNECTED), "import-new"],
    ["chapter 1 done, on /new", ctx("/new", CONNECTED, { connect: "done" }), "import-new"],
    ["pending server on /new gets nothing", ctx("/new", PENDING, { connect: "done" }), null],
    ["chapter 2 skipped", ctx("/new", CONNECTED, { connect: "done", import: "skipped" }), null],
    ["chapter 2 done but no project (deleted): not started again", ctx("/new", CONNECTED, { import: "done" }), null],
    ["a project exists: chapter 2 is not needed", ctx("/new", BUILDING, { connect: "done" }), null],

    // existing users
    ["existing user on /projects", ctx("/projects", BUILDING), null],
    ["existing user on /new", ctx("/new", READY), null],
    ["existing user on a deployment page, building", ctx(DEPLOYMENT_PAGE, BUILDING), null],
    ["existing user on a deployment page, ready", ctx(DEPLOYMENT_PAGE, READY), null],
    ["existing user on /domains, ready and no domain", ctx("/domains", READY), null],
    ["existing user on /domains, live", ctx("/domains", LIVE), null],

    // chapter 3
    ["chapter 2 done, building", ctx(DEPLOYMENT_PAGE, BUILDING, { connect: "done", import: "done" }), "deploy-deployment"],
    ["chapter 2 done, failed", ctx(DEPLOYMENT_PAGE, FAILED, { import: "done" }), "deploy-deployment"],
    ["chapter 2 done, deployment of another project", ctx("/projects/other/deployments/d1", BUILDING, { import: "done" }), null],
    ["chapter 2 skipped, building", ctx(DEPLOYMENT_PAGE, BUILDING, { connect: "done", import: "skipped" }), null],
    ["marks from another chapter, first deployment under way", ctx(DEPLOYMENT_PAGE, BUILDING, { connect: "done" }), "deploy-deployment"],
    ["marks from another chapter, already ready: left alone", ctx(DEPLOYMENT_PAGE, READY, { connect: "done" }), null],
    ["paused chapter 3 and a later ready deployment", ctx(DEPLOYMENT_PAGE, READY, { connect: "done", import: "done", deploy: "paused" }), "deploy-deployment"],
    ["paused chapter 3 and only that mark", ctx(DEPLOYMENT_PAGE, READY, { deploy: "paused" }), "deploy-deployment"],
    ["paused chapter 3, failed again", ctx(DEPLOYMENT_PAGE, FAILED, { import: "done", deploy: "paused" }), "deploy-deployment"],
    ["chapter 3 done and ready", ctx(DEPLOYMENT_PAGE, READY, { import: "done", deploy: "done" }), null],
    ["chapter 3 skipped", ctx(DEPLOYMENT_PAGE, BUILDING, { import: "done", deploy: "skipped" }), null],
    ["a deployment path without a slug on /projects/blog", ctx("/projects/blog", BUILDING, { import: "done" }), null],

    // chapter 4
    ["chapter 3 done, ready, no domain", ctx("/domains", READY, { deploy: "done" }), "address-domains"],
    ["chapter 3 done, redeploying", ctx("/domains", BUILDING, { deploy: "done" }), "address-domains"],
    ["ready and no domain, other marks, same position", ctx("/domains", READY, { connect: "done" }), "address-domains"],
    ["chapter 3 paused and now ready", ctx("/domains", READY, { deploy: "paused" }), "address-domains"],
    ["chapter 3 paused and still building", ctx("/domains", BUILDING, { deploy: "paused" }), null],
    ["chapter 3 skipped", ctx("/domains", READY, { deploy: "skipped" }), null],
    ["chapter 4 skipped", ctx("/domains", READY, { deploy: "done", address: "skipped" }), null],
    ["chapter 4 done", ctx("/domains", READY, { deploy: "done", address: "done" }), null],
    ["an active domain exists", ctx("/domains", LIVE, { deploy: "done" }), null],
    ["no project", ctx("/domains", CONNECTED, { deploy: "done" }), null],

    // paths
    ["a path that matches nothing", ctx("/settings", NO_SERVER), null],
    ["the home page", ctx("/", NO_SERVER), null],
    ["/projects/blog is not a deployment page", ctx("/projects/blog", NO_SERVER), null],
    ["/projects/blog/deployments (no id)", ctx("/projects/blog/deployments", BUILDING, { import: "done" }), null],
    ["a trailing slash and a query are ignored", ctx("/connect/?from=nav", NO_SERVER), "connect-setup"],
    ["a hash is ignored", ctx("/projects#top", NO_SERVER), "connect-projects"],
    ["a deployment path with a query", ctx(`${DEPLOYMENT_PAGE}?tab=logs`, BUILDING, { import: "done" }), "deploy-deployment"],
    ["a path that only starts like a segment", ctx("/connections", NO_SERVER), null],
  ];

  it.each(rows)("%s", (_name, context, expected) => {
    expect(idOf(context)).toBe(expected);
  });

  describe("replay", () => {
    const replayRows: Row[] = [
      ["a done chapter 1", ctx("/projects", CONNECTED, { connect: "done" }, { replay: "connect" }), "connect-projects"],
      ["chapter 1 on /connect with a connected server", ctx("/connect", CONNECTED, { connect: "done" }, { replay: "connect" }), "connect-setup"],
      ["chapter 1 on a page it does not run on", ctx("/new", CONNECTED, {}, { replay: "connect" }), null],
      ["a skipped chapter 2 with a project", ctx("/new", BUILDING, { import: "skipped" }, { replay: "import" }), "import-new"],
      ["an existing user (no marks) replays chapter 2", ctx("/new", READY, {}, { replay: "import" }), "import-new"],
      ["chapter 3 on any project's deployment", ctx("/projects/other/deployments/d9", READY, { deploy: "done" }, { replay: "deploy" }), "deploy-deployment"],
      ["chapter 4 with an active domain", ctx("/domains", LIVE, { address: "done" }, { replay: "address" }), "address-domains"],
      ["only the replayed chapter is considered", ctx("/domains", READY, { deploy: "done" }, { replay: "import" }), null],
      ["only the replayed chapter is considered (2)", ctx("/projects", NO_SERVER, {}, { replay: "address" }), null],
    ];
    it.each(replayRows)("%s", (_name, context, expected) => {
      expect(idOf(context)).toBe(expected);
    });

    it("does not change the marks or the facts it was given", () => {
      const marks: Marks = { connect: "done" };
      const context = ctx("/projects", CONNECTED, marks, { replay: "connect" });
      selectSegment(context);
      expect(marks).toEqual({ connect: "done" });
    });
  });
});

/* ---------- stageOf ---------- */

describe("stageOf", () => {
  it.each([
    [NO_SERVER, "no-server"],
    [PENDING, "server-pending"],
    [{ ...NO_SERVER, servers: [{ status: "error" }] }, "server-pending"],
    [{ ...NO_SERVER, servers: [{ status: "pending" }, { status: "connected" }] }, "connected-no-project"],
    [CONNECTED, "connected-no-project"],
    [BUILDING, "project-not-ready"],
    [FAILED, "project-not-ready"],
    [{ ...BUILDING, firstDeployment: null }, "project-not-ready"],
    [READY, "ready-no-domain"],
    [LIVE, "complete"],
  ] as [OnboardingFacts, string][])("reads %#", (facts, stage) => {
    expect(stageOf(facts)).toBe(stage);
  });
});

/* ---------- paths ---------- */

describe("paths", () => {
  it("normalises", () => {
    expect(normalisePath("/connect/")).toBe("/connect");
    expect(normalisePath("/new?x=1#y")).toBe("/new");
    expect(normalisePath("/")).toBe("/");
    expect(normalisePath("")).toBe("/");
  });

  it("reads the slug of a deployment page", () => {
    expect(deploymentSlug("/projects/blog/deployments/abc")).toBe("blog");
    expect(deploymentSlug("/projects/my%20app/deployments/abc/")).toBe("my app");
    expect(deploymentSlug("/projects/blog")).toBeNull();
    expect(deploymentSlug("/projects/blog/deployments")).toBeNull();
  });

  it("gives every segment a path that matches its own route", () => {
    const samples: Record<string, string> = {
      "/projects/<slug>/deployments/<id>": "/projects/blog/deployments/d1",
    };
    for (const segment of SEGMENTS) {
      expect(segment.path.test(samples[segment.route] ?? segment.route), segment.id).toBe(true);
    }
  });
});

/* ---------- conditional steps ---------- */

function variantsOf(overrides: Partial<Variant>): Variant {
  return { ...VARIANT, ...overrides };
}

function segment(id: string): Segment {
  const found = SEGMENTS.find((s) => s.id === id);
  if (!found) throw new Error(`no segment ${id}`);
  return found;
}

function titles(id: string, facts: OnboardingFacts, variant: Partial<Variant> = {}): string[] {
  const context = { ...ctx("/", facts), variant: variantsOf(variant) };
  return resolveSteps(segment(id), context).map((s) => s.title);
}

describe("conditional steps", () => {
  it("shows the host key step only when it is pending", () => {
    expect(titles("connect-setup", NO_SERVER, { hostKeyPending: true })).toContain("Check the fingerprint.");
    expect(titles("connect-setup", NO_SERVER, { hostKeyPending: false })).not.toContain("Check the fingerprint.");
  });

  it("puts the host key step between the test and the finish", () => {
    expect(titles("connect-setup", PENDING, { hostKeyPending: true })).toEqual([
      "Add the key in Nest.",
      "Test the connection.",
      "Check the fingerprint.",
      "Connected.",
    ]);
  });

  it("skips the username step once a server exists", () => {
    expect(titles("connect-setup", NO_SERVER)[0]).toBe("Your Nest username.");
    expect(titles("connect-setup", PENDING)[0]).toBe("Add the key in Nest.");
  });

  it("points the host key step at the fingerprint, never the confirm button", () => {
    const step = segment("connect-setup").steps.find((s) => s.title === "Check the fingerprint.")!;
    expect(step.anchor).toBe("host-key");
    expect(step.kind).toBe("do");
    expect(ANCHORS.filter((a) => /confirm/.test(a))).toEqual([]);
  });

  it("shows one of three repository steps, by github variant", () => {
    const pick = (github: Variant["github"]) =>
      titles("import-new", CONNECTED, { github }).filter((t) => /repository|GitHub/.test(t) && t !== "Check what Egg found.");
    expect(pick("installed")).toEqual(["Pick your repository."]);
    expect(pick("not-installed")).toEqual(["Connect GitHub."]);
    expect(pick("not-configured")).toEqual(["Paste a repository URL."]);
  });

  it("does not mention installing the GitHub App when there is none", () => {
    const steps = resolveSteps(segment("import-new"), { ...ctx("/new", CONNECTED), variant: variantsOf({ github: "not-configured" }) });
    expect(steps.map((s) => `${s.title} ${s.body}`).join(" ")).not.toMatch(/install|GitHub/i);
  });

  it("shows the conflicts step only when conflicts are listed", () => {
    expect(titles("import-new", CONNECTED, { conflicts: true })).toContain("Something is already on your container.");
    expect(titles("import-new", CONNECTED, { conflicts: false })).not.toContain("Something is already on your container.");
    const t = titles("import-new", CONNECTED, { conflicts: true });
    expect(t.indexOf("Something is already on your container.")).toBe(t.indexOf("Deploy.") - 1);
  });

  it("shows the failure step instead of the running step when the deployment failed", () => {
    expect(titles("deploy-deployment", FAILED, { deploymentFailed: true })).toEqual(["The build failed."]);
    expect(titles("deploy-deployment", BUILDING)).toEqual(["Watch it build.", "Your app is running."]);
  });

  it("leaves out the build logs step once it is ready", () => {
    expect(titles("deploy-deployment", READY)).toEqual(["Your app is running."]);
  });

  it("links the failure step to the troubleshooting page", () => {
    const step = segment("deploy-deployment").steps.find((s) => s.title === "The build failed.")!;
    expect(step.link?.href).toMatch(/^\/docs\/troubleshooting/);
  });

  it("sends the running step to the domains page", () => {
    const step = segment("deploy-deployment").steps.find((s) => s.title === "Your app is running.")!;
    expect(step.next).toBe("/domains");
    expect(step.body).toContain("{port}");
  });

  it("never says live before an address works, except on the closing card", () => {
    for (const segment of SEGMENTS) {
      for (const step of segment.steps) expect(`${step.title} ${step.body}`).not.toMatch(/\b(is|are|goes|went) live\b/i);
    }
    expect(LIVE_CARD_STEP.title).toMatch(/live/);
  });

  it("keeps the order of the three chapter 4 steps", () => {
    expect(segment("address-domains").steps.map((s) => s.anchor)).toEqual(["domain-form", "domain-steps", "domain-check"]);
  });
});

/* ---------- tokens ---------- */

describe("fillTokens", () => {
  it("fills known tokens and leaves unknown or missing ones as written", () => {
    expect(fillTokens("port {port}.", { port: 3000 })).toBe("port 3000.");
    expect(fillTokens("port {port}.", {})).toBe("port {port}.");
    expect(fillTokens("a {other}", { port: 1 })).toBe("a {other}");
  });
});

/* ---------- copy rules ---------- */

const ALL_STEPS: { where: string; step: TourStep }[] = [
  ...SEGMENTS.flatMap((s) => s.steps.map((step) => ({ where: `${s.id}: ${step.title}`, step }))),
  { where: `live card: ${LIVE_CARD_STEP.title}`, step: LIVE_CARD_STEP },
];

describe("copy", () => {
  it.each(ALL_STEPS.map((x) => [x.where, x.step] as const))("%s", (_where, step) => {
    for (const text of [step.title, step.body, step.button, step.skip, step.link?.label]) {
      if (text === undefined) continue;
      expect(text).not.toContain("!");
      expect(text).not.toContain("—");
      expect(text).not.toContain("–");
      expect(text).not.toMatch(/\b(simply|just)\b/i);
      expect(text).not.toMatch(/sign.?in/i);
      expect(text).toBe(text.trim());
      expect(text).not.toMatch(/ {2}/);
    }
    expect(step.title.length).toBeGreaterThan(0);
    expect(step.title.length).toBeLessThanOrEqual(60);
    expect(step.body.length).toBeGreaterThan(0);
    expect(step.body.length).toBeLessThanOrEqual(260);
    expect(step.title).toMatch(/^[A-Z]/);
    expect(step.body).toMatch(/^[A-Z]/);
    expect(step.title).toMatch(/[.]$/);
    expect(step.body).toMatch(/[.]$/);
    // Sentence case: after the first word no word of the title starts with a capital, apart from Nest, Egg, GitHub and URL.
    const rest = step.title.split(" ").slice(1).filter((w) => /^[A-Z]/.test(w));
    expect(rest.every((w) => /^(Nest|Egg|GitHub|URL)\b/.test(w))).toBe(true);
  });

  it("uses no token but {port}", () => {
    const tokens = new Set<string>();
    for (const { step } of ALL_STEPS) {
      for (const match of `${step.title} ${step.body}`.matchAll(/\{[^}]*\}/g)) tokens.add(match[0]);
    }
    expect([...tokens]).toEqual(["{port}"]);
  });

  it("keeps the opening copy of the plan", () => {
    const welcome = segment("connect-projects").steps[0]!;
    expect(welcome.title).toBe("Put your app on Nest.");
    expect(welcome.button).toBe("Start");
    expect(welcome.skip).toBe("Not now");
    expect(welcome.anchor).toBeUndefined();
  });
});

/* ---------- structure ---------- */

describe("structure", () => {
  it("has unique segment ids and covers all four chapters", () => {
    expect(new Set(SEGMENTS.map((s) => s.id)).size).toBe(SEGMENTS.length);
    expect(new Set(SEGMENTS.map((s) => s.chapter))).toEqual(new Set(["connect", "import", "deploy", "address"]));
  });

  it("never uses an anchor twice within the steps a person actually sees", () => {
    const github: Variant["github"][] = ["installed", "not-installed", "not-configured"];
    const flags = [false, true];
    const factsList = [NO_SERVER, PENDING, CONNECTED, BUILDING, FAILED, READY, LIVE];
    for (const seg of SEGMENTS) {
      for (const g of github) {
        for (const hostKeyPending of flags) {
          for (const conflicts of flags) {
            for (const deploymentFailed of flags) {
              for (const facts of factsList) {
                const context: Context = {
                  ...ctx("/", facts),
                  variant: { github: g, hostKeyPending, conflicts, deploymentFailed, localMode: false },
                };
                const anchors = resolveSteps(seg, context)
                  .map((s) => s.anchor)
                  .filter(Boolean);
                expect(new Set(anchors).size, `${seg.id} ${JSON.stringify(context.variant)}`).toBe(anchors.length);
              }
            }
          }
        }
      }
    }
  });

  it("gives every step that asks the person to act an anchor and no primary button", () => {
    for (const { where, step } of ALL_STEPS) {
      if (step.kind === "do") {
        expect(step.anchor, where).toBeTruthy();
        expect(step.button, where).toBeUndefined();
      }
    }
  });

  it("sets a side on every anchored step, and none on a centred one", () => {
    for (const { where, step } of ALL_STEPS) {
      if (step.anchor) expect(["top", "right", "bottom", "left"], where).toContain(step.side);
      else expect(step.side, where).toBeUndefined();
    }
  });

  it("keeps every anchor name in the data-tour style", () => {
    for (const name of ANCHORS) expect(name).toMatch(/^[a-z]+(-[a-z]+)*$/);
  });

  it("derives ANCHORS from the steps: sorted, no repeats, and nothing missing", () => {
    const used = new Set(ALL_STEPS.map((x) => x.step.anchor).filter(Boolean));
    expect([...ANCHORS]).toEqual([...used].sort());
    expect(new Set(ANCHORS).size).toBe(ANCHORS.length);
    expect(ANCHORS).toContain("repo-source");
    expect(ANCHORS).toContain("visit");
  });

  it("keeps each chapter within six steps in one sitting", () => {
    const worst: Variant = { github: "installed", hostKeyPending: true, conflicts: true, deploymentFailed: false, localMode: false };
    for (const seg of SEGMENTS) {
      expect(resolveSteps(seg, { ...ctx("/", NO_SERVER), variant: worst }).length, seg.id).toBeLessThanOrEqual(6);
    }
  });

  it("keeps `when` pure: the same context gives the same answer and nothing is changed", () => {
    const context = ctx("/", PENDING);
    const frozen = JSON.stringify(context);
    for (const { step } of ALL_STEPS) {
      if (!step.when) continue;
      expect(step.when(context)).toBe(step.when(context));
    }
    expect(JSON.stringify(context)).toBe(frozen);
  });
});
