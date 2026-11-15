/**
 * Which step of a running segment to show right now. Pure code with no React and no browser, so
 * the host component stays thin and the rules can be tested. See docs/design/onboarding-tour-plan.md.
 *
 * `selectSegment` (onboarding.ts) only decides what to START. Once a segment runs, the host calls
 * `currentView` every time the account data or the page changes, and shows whatever it returns.
 * Nothing here is remembered between pages: the step is worked out from the facts, from what the
 * page shows (the signals) and from the "Next" presses made on this page (the acks).
 */

import type { Chapter, MarkStatus, Marks, OnboardingFacts } from "@/lib/onboarding-marks";
import {
  LIVE_CARD_STEP,
  deploymentSlug,
  failedTestStep,
  normalisePath,
  resolveSteps,
  stageOf,
  type Context,
  type Segment,
  type TourStep,
  type Variant,
} from "@/lib/onboarding";

/* ------------------------------------------------------------------------------------------ */
/* What the page shows                                                                        */
/* ------------------------------------------------------------------------------------------ */

/**
 * Things only the page can tell. The host reads them from the document: the `data-tour` names
 * that exist, and a few attributes next to them (`data-tour-state`, `data-tour-port`).
 */
export type Signals = {
  /** Every `data-tour` name on the page now. */
  present: readonly string[];
  /** `data-tour-state` of the repository source: how the page reads for GitHub. Null when it is not on the page. */
  github: Variant["github"] | null;
  /** The text of the failed key test (`data-tour="test-failure"`), or null. */
  testFailure: string | null;
  /** The deployment on screen: its state word and port, or null on other pages. */
  deployment: { state: string; port: number | null } | null;
};

export const NO_SIGNALS: Signals = { present: [], github: null, testFailure: null, deployment: null };

const GITHUB_STATES: readonly Variant["github"][] = ["installed", "not-installed", "not-configured"];

export function isGithubState(value: unknown): value is Variant["github"] {
  return typeof value === "string" && (GITHUB_STATES as readonly string[]).includes(value);
}

/** The variant of the copy, from what the page shows. */
export function variantFrom(signals: Signals, localMode = false): Variant {
  const has = (name: string) => signals.present.includes(name);
  return {
    // With no signal the page is a plain "paste a URL" page, which is the safest wording.
    github: signals.github ?? "not-configured",
    // The fingerprint block only exists while the first connection waits for confirmation.
    hostKeyPending: has("host-key"),
    conflicts: has("container-conflicts"),
    deploymentFailed: has("error-summary") || signals.deployment?.state === "error",
    localMode,
  };
}

/** A stable text for a set of signals, so the host can tell whether anything changed. */
export function signalsKey(signals: Signals): string {
  return JSON.stringify([[...signals.present].sort(), signals.github, signals.testFailure, signals.deployment]);
}

/* ------------------------------------------------------------------------------------------ */
/* The view                                                                                   */
/* ------------------------------------------------------------------------------------------ */

export type View = {
  /** Identifies the step inside its segment. The host shows a step again only when this changes. */
  key: string;
  step: TourStep;
  /** 1-based place among the steps that apply, and how many there are. */
  position: number;
  total: number;
  /** The key to go back to, when Back makes sense (the step before is one that was read, not acted on). */
  backKey?: string;
  /** A mark the host saves the moment this view appears: the goal of the chapter was reached, or could not be. */
  mark?: { chapter: Chapter; status: MarkStatus };
};

/** The keys of read steps the person has passed with the primary button, on this page. */
export type Acks = ReadonlySet<string>;

const keyOf = (segment: Segment, rawIndex: number) => `${segment.id}:${rawIndex}`;

const isConnected = (facts: OnboardingFacts) => facts.servers.some((s) => s.status === "connected");

/**
 * Build the view for a step that applies. `rawIndex` is its place in `segment.steps`. Position and
 * total count only the steps that apply to this context, so "2 of 5" matches what the person sees.
 */
function viewAt(segment: Segment, ctx: Context, acks: Acks, rawIndex: number, extra: Partial<View> = {}): View | null {
  const step = segment.steps[rawIndex];
  if (!step) return null;
  const applies = resolveSteps(segment, ctx);
  const place = applies.indexOf(step);
  if (place === -1) return null;

  // Back is offered only to a step that was read and passed, so it never lands on a control that is gone.
  let backKey: string | undefined;
  const before = applies[place - 1];
  if (before && before.kind !== "do") {
    const beforeKey = keyOf(segment, segment.steps.indexOf(before));
    if (acks.has(beforeKey)) backKey = beforeKey;
  }

  return { key: keyOf(segment, rawIndex), step, position: place + 1, total: applies.length, backKey, ...extra };
}

/** The raw index of the step with this anchor that applies to the context, or -1. */
function indexOfAnchor(segment: Segment, ctx: Context, anchor: string): number {
  return segment.steps.findIndex((s) => s.anchor === anchor && (!s.when || s.when(ctx)));
}

/** The raw index of the step with no anchor at all that applies (a centred one) at or after `from`. */
function indexOfCentred(segment: Segment, ctx: Context, from = 0): number {
  return segment.steps.findIndex((s, i) => i >= from && !s.anchor && (!s.when || s.when(ctx)));
}

/**
 * The step a running segment should show now, or null when there is nothing to show for the
 * moment (waiting for the build to finish, or for the page to draw what the step points at).
 */
export function currentView(input: {
  segment: Segment;
  ctx: Context;
  signals: Signals;
  acks: Acks;
  /** Set on a replay: the person asked to see the chapter, so "you already have it" does not cut it short. */
  replay?: boolean;
}): View | null {
  const { segment, ctx, signals, acks, replay = false } = input;
  const { facts } = ctx;
  const at = (anchor: string, extra?: Partial<View>) => {
    const i = indexOfAnchor(segment, ctx, anchor);
    return i === -1 ? null : viewAt(segment, ctx, acks, i, extra);
  };
  const has = (name: string) => signals.present.includes(name);

  switch (segment.id) {
    case "connect-projects": {
      // The welcome, then the connect button. Start moves on; the button itself leaves the page.
      return acks.has(keyOf(segment, 0)) ? at("connect-server") : viewAt(segment, ctx, acks, 0);
    }

    case "connect-setup": {
      if (isConnected(facts)) {
        // Reaching a connected server is the goal of the chapter, so it is marked done right here.
        const i = indexOfCentred(segment, ctx);
        return i === -1 ? null : viewAt(segment, ctx, acks, i, { mark: { chapter: "connect", status: "done" } });
      }
      if (facts.servers.length === 0) return at("nest-username");
      // The host key block and the failed test are the page's own state; the tour only follows it.
      if (ctx.variant.hostKeyPending) return at("host-key");
      if (signals.testFailure !== null) {
        const i = indexOfAnchor(segment, ctx, "test-connection");
        if (i === -1) return null;
        const base = viewAt(segment, ctx, acks, i);
        return base ? { ...base, key: `${segment.id}:failed`, step: failedTestStep(signals.testFailure) } : null;
      }
      return acks.has(keyOf(segment, indexOfAnchor(segment, ctx, "public-key"))) ? at("test-connection") : at("public-key");
    }

    case "import-new": {
      // Before a repository is chosen the page shows the source. After, it shows the settings form.
      if (!has("project-settings")) return has("repo-source") ? at("repo-source") : null;
      const settings = indexOfAnchor(segment, ctx, "project-settings");
      if (!acks.has(keyOf(segment, settings))) return viewAt(segment, ctx, acks, settings);
      const conflicts = indexOfAnchor(segment, ctx, "container-conflicts");
      if (conflicts !== -1 && !acks.has(keyOf(segment, conflicts))) return viewAt(segment, ctx, acks, conflicts);
      return at("deploy");
    }

    case "deploy-deployment": {
      const dep = signals.deployment;
      // A canceled deployment has nothing to teach; no deployment on the page means it is still drawing.
      if (!dep || dep.state === "canceled") return null;
      if (ctx.variant.deploymentFailed) {
        // The chapter cannot finish on this deployment; a later one that is ready can finish it.
        return at("error-summary", { mark: { chapter: "deploy", status: "paused" } });
      }
      if (dep.state === "ready") return at("deployment-status", { mark: { chapter: "deploy", status: "done" } });
      const logs = indexOfAnchor(segment, ctx, "build-logs");
      if (logs !== -1 && !acks.has(keyOf(segment, logs))) return viewAt(segment, ctx, acks, logs);
      // Got it was pressed: nothing to show until the build ends. The tour never blocks the page.
      return null;
    }

    case "address-domains": {
      // The goal is an address that answers. A domain saved as active (a Nest name is, at once) does not
      // show that, because Nest routes it on its own dashboard: only a check that got an answer does.
      // On a replay the person wants the steps, not the card.
      if (has("app-answers") && !replay) return liveView();
      // A domain saved: the steps for it. No domain yet: the form.
      if (!has("domain-check")) return at("domain-form");
      const steps = indexOfAnchor(segment, ctx, "domain-steps");
      if (steps !== -1 && !acks.has(keyOf(segment, steps))) return viewAt(segment, ctx, acks, steps);
      return at("domain-check");
    }
  }
  return null;
}

/** The closing card of chapter 4. Shown once, after the chapter is marked done. */
export function liveView(): View {
  return {
    key: "live",
    step: LIVE_CARD_STEP,
    position: 1,
    total: 1,
    mark: { chapter: "address", status: "done" },
  };
}

/**
 * The card is due on a page that carries a link to the app when the person's address became
 * active and they were being guided (chapter 3 done), and the chapter has not been closed. The
 * address chapter itself shows it while it runs, so this is for a person who comes back later.
 */
export function liveCardDue(input: { path: string; facts: OnboardingFacts; marks: Marks; answers: boolean }): boolean {
  const { facts, marks } = input;
  const path = normalisePath(input.path);
  // `answers`: the page shows a check in which the app answered. Without one nothing proves the address works.
  const onPage = path === "/domains" || deploymentSlug(path) !== null;
  if (!onPage || !facts.hasActiveDomain || !input.answers) return false;
  if (marks.address === "done" || marks.address === "skipped") return false;
  return marks.deploy === "done" && marks.import !== "skipped";
}

/* ------------------------------------------------------------------------------------------ */
/* Replay                                                                                     */
/* ------------------------------------------------------------------------------------------ */

/** The page and chapter "Show the tour again" opens, from where the account stands. */
export function replayTarget(account: { serverStatuses: readonly string[]; projectCount: number }): {
  chapter: Chapter;
  path: string;
} {
  const facts = {
    servers: account.serverStatuses.map((status) => ({ status })),
    projectCount: account.projectCount,
    firstProject: null,
    firstDeployment: null,
    hasActiveDomain: false,
  } satisfies OnboardingFacts;
  const stage = stageOf(facts);
  const go = (chapter: Chapter, path: string) => ({ chapter, path });
  switch (stage) {
    case "no-server":
      return go("connect", "/projects");
    case "server-pending":
      return go("connect", "/connect");
    case "connected-no-project":
      return go("import", "/new");
    default:
      // A project exists: the part left to see is the address. Its first deployment page needs an id the
      // account does not carry, and the address page works from any state.
      return go("address", "/domains");
  }
}
