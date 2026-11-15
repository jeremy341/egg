import {
  fillTokens,
  normalisePath,
  selectSegment,
  type Context,
  type Segment,
} from "@/lib/onboarding";
import {
  currentView,
  isGithubState,
  liveCardDue,
  liveView,
  variantFrom,
  type Signals,
  type View,
} from "@/lib/onboarding-flow";
import type { Chapter, MarkStatus, Marks, OnboardingFacts } from "@/lib/onboarding-marks";
import { clearReplay, peekReplay } from "@/components/onboarding/replay";
import { endTour, hideStep, showStep, type StepHandlers, type StepSpec } from "@/components/onboarding/tour";

/**
 * Runs the tour on one page. The host makes one of these per page and disposes it on every route
 * change, so no tour state lives in memory across pages: the next page works the segment out again
 * from the data. See docs/design/onboarding-tour-plan.md ("Rules of behaviour").
 *
 * The decision of what to show is lib/onboarding-flow.ts (pure, tested). This file is the part that
 * touches the document: it reads what the page shows, waits for things to be ready, asks tour.ts to
 * draw, and saves the marks.
 */

export type ControllerEnv = {
  path: string;
  data: () => { facts: OnboardingFacts; marks: Marks; localMode: boolean };
  saveMark: (chapter: Chapter, status: MarkStatus) => void;
  navigate: (href: string) => void;
};

export type Controller = {
  /** The data or the page may have changed: look again. */
  refresh: () => void;
  dispose: () => void;
};

/** Nothing starts in the first second after a page loads. */
const START_DELAY_MS = 1000;
/** A step whose target is not on the page waits this long, then is skipped quietly. */
const MISSING_MS = 2000;

/** Things that sit above the page and want the person's attention. The tour waits for them to go. */
const BLOCKING =
  '[data-slot="dialog-content"], [data-slot="alert-dialog-content"], [role="alertdialog"], [role="menu"], [role="dialog"]:not(.driver-popover), dialog[open], .toast-content';
/** A page that is still drawing its content. */
const LOADING = '[role="status"][aria-busy="true"]';

/** A control that must stay usable on a step without being highlighted. */
const ALLOW: Record<string, string> = {
  // The Confirm button of the host key. The tour points at the fingerprint; the person decides.
  "host-key": '[data-tour-allow="host-key"]',
};

/** An action on the target that has to be recorded before the page changes. */
const BEFORE_CLICK: Record<string, { chapter: Chapter; status: MarkStatus }> = {
  // Pressing Deploy creates the project and opens its page. A person with a project and no mark
  // counts as someone from before the tour, so chapter 2 must be marked done first.
  deploy: { chapter: "import", status: "done" },
};

type Session = {
  segment: Segment | null;
  /** The closing card of chapter 4 on its own (the person came back to a page after the address went active). */
  live: boolean;
  replay: Chapter | null;
  acks: Set<string>;
  shownKey: string | null;
  pendingKey: string | null;
  skipped: Set<string>;
  missing: { key: string; timer: number } | null;
};

function isRendered(el: Element): boolean {
  return el.getClientRects().length > 0;
}

/** What the page shows right now, from the `data-tour` attributes. */
export function readSignals(root: ParentNode = document): Signals {
  const present = new Set<string>();
  let github: Signals["github"] = null;
  let testFailure: string | null = null;
  let deployment: Signals["deployment"] = null;
  for (const el of root.querySelectorAll<HTMLElement>("[data-tour]")) {
    const name = el.dataset.tour;
    if (!name || !isRendered(el) || present.has(name)) continue;
    present.add(name);
    if (name === "repo-source" && isGithubState(el.dataset.tourState)) github = el.dataset.tourState;
    if (name === "test-failure") testFailure = el.textContent?.replace(/\s+/g, " ").trim() || "";
    if (name === "deployment-status") {
      const port = Number(el.dataset.tourPort);
      deployment = { state: el.dataset.tourState ?? "", port: Number.isInteger(port) && port > 0 ? port : null };
    }
  }
  return { present: [...present], github, testFailure, deployment };
}

function toSpec(view: View, signals: Signals): StepSpec {
  const step = view.step;
  const goalReached = view.mark?.status === "done";
  return {
    anchor: step.anchor,
    title: step.title,
    body: fillTokens(step.body, { port: signals.deployment?.port ?? undefined }),
    kind: step.kind ?? "read",
    side: step.side,
    button: step.button ?? "Next",
    // Once the goal is reached, closing is not skipping: say Close.
    leave: step.skip ?? (goalReached ? "Close" : "Skip tour"),
    position: view.position,
    total: view.total,
    back: Boolean(view.backKey),
    link: step.link,
    allow: step.anchor ? ALLOW[step.anchor] : undefined,
  };
}

export function createController(env: ControllerEnv): Controller {
  const path = normalisePath(env.path);
  const born = Date.now();
  const suppressed = new Set<string>();
  let session: Session | null = null;
  let disposed = false;
  let observer: MutationObserver | null = null;
  let frame = 0;
  let startTimer = 0;
  let seq = 0;
  let unbindClick: (() => void) | null = null;

  /* ---------------------------------------------------------------------------------------- */
  /* Watching the page                                                                        */
  /* ---------------------------------------------------------------------------------------- */

  function schedule() {
    if (disposed || frame) return;
    frame = window.requestAnimationFrame(evaluate);
  }

  /** Watch the document only while there is something to start or to follow. */
  function watch(on: boolean) {
    if (on && !observer) {
      observer = new MutationObserver(schedule);
      observer.observe(document.body, {
        childList: true,
        subtree: true,
        characterData: true,
        attributes: true,
        attributeFilter: ["data-tour", "data-tour-state", "data-tour-port"],
      });
    } else if (!on && observer) {
      observer.disconnect();
      observer = null;
    }
  }

  function blocked(): boolean {
    return Boolean(document.querySelector(BLOCKING)) || Boolean(document.querySelector(LOADING));
  }

  /* ---------------------------------------------------------------------------------------- */
  /* Starting                                                                                 */
  /* ---------------------------------------------------------------------------------------- */

  function candidate(): { segment: Segment | null; live: boolean; replay: Chapter | null } | null {
    const { facts, marks, localMode } = env.data();
    const variant = variantFrom(readSignals(), localMode);
    const replay = peekReplay(path);
    const ctx: Context = { path, facts, marks, variant, replay: replay ?? undefined };
    if (replay) {
      const segment = selectSegment(ctx);
      return segment ? { segment, live: false, replay } : null;
    }
    if (!suppressed.has("live") && liveCardDue({ path, facts, marks, answers: readSignals().present.includes("app-answers") })) return { segment: null, live: true, replay: null };
    const segment = selectSegment(ctx);
    return segment && !suppressed.has(segment.id) ? { segment, live: false, replay: null } : null;
  }

  function evaluate() {
    frame = 0;
    if (disposed) return;
    if (!session) {
      const found = candidate();
      watch(found !== null);
      if (!found) return;
      const age = Date.now() - born;
      if (age < START_DELAY_MS) {
        if (!startTimer) startTimer = window.setTimeout(evaluate, START_DELAY_MS - age + 20);
        return;
      }
      if (document.visibilityState === "hidden" || blocked()) return;
      session = {
        segment: found.segment,
        live: found.live,
        replay: found.replay,
        acks: new Set(),
        shownKey: null,
        pendingKey: null,
        skipped: new Set(),
        missing: null,
      };
      if (found.replay) clearReplay();
    }
    drive(session);
  }

  /* ---------------------------------------------------------------------------------------- */
  /* Showing the step the data points at                                                      */
  /* ---------------------------------------------------------------------------------------- */

  function drive(s: Session) {
    const { facts, marks, localMode } = env.data();
    const signals = readSignals();
    const variant = variantFrom(signals, localMode);
    const ctx: Context = { path, facts, marks, variant, replay: s.replay ?? undefined };
    const view = s.live || !s.segment
      ? liveView()
      : currentView({ segment: s.segment, ctx, signals, acks: s.acks, replay: Boolean(s.replay) });

    if (!view) {
      // Nothing to show for now (the build is running). The tour stays, the screen is free.
      clearMissing(s);
      hideShown(s);
      return;
    }
    if (view.key === s.shownKey || view.key === s.pendingKey) return;

    s.pendingKey = view.key;
    unbind();
    const mine = ++seq;
    void showStep(toSpec(view, signals), handlersFor(s, view)).then((ok) => {
      if (disposed || mine !== seq || session !== s) return;
      s.pendingKey = null;
      if (!ok) {
        s.shownKey = null;
        armMissing(s, view);
        return;
      }
      clearMissing(s);
      s.shownKey = view.key;
      bind(view);
      // The goal of the chapter was reached (or could not be): record it as soon as the person sees it.
      if (view.mark) env.saveMark(view.mark.chapter, view.mark.status);
    });
  }

  function hideShown(s: Session) {
    seq += 1;
    s.pendingKey = null;
    if (s.shownKey !== null) {
      s.shownKey = null;
      unbind();
      hideStep();
    }
  }

  function clearMissing(s: Session) {
    if (s.missing) window.clearTimeout(s.missing.timer);
    s.missing = null;
  }

  /** The target is not there. Wait for the page to draw it; after two seconds leave the step out. */
  function armMissing(s: Session, view: View) {
    hideStep();
    if (s.missing?.key === view.key) return;
    clearMissing(s);
    s.missing = { key: view.key, timer: window.setTimeout(() => missingElapsed(s, view), MISSING_MS) };
  }

  function missingElapsed(s: Session, view: View) {
    if (disposed || session !== s) return;
    s.missing = null;
    if (s.shownKey === view.key) return;
    // A step that asks for an action cannot be passed over, and a step passed over twice is a loop: end quietly.
    if (s.skipped.has(view.key) || view.step.kind === "do" || view.key === "live") {
      suppressed.add(s.segment?.id ?? "live");
      endSession(s, true);
      return;
    }
    s.skipped.add(view.key);
    s.acks.add(view.key);
    drive(s);
  }

  /* ---------------------------------------------------------------------------------------- */
  /* Buttons                                                                                  */
  /* ---------------------------------------------------------------------------------------- */

  function handlersFor(s: Session, view: View): StepHandlers {
    return {
      primary: () => {
        if (session !== s) return;
        if (view.key === "live") {
          const href = document.querySelector('[data-tour="visit"]')?.getAttribute("href");
          if (href) window.open(href, "_blank", "noopener,noreferrer");
          endSession(s, true);
          return;
        }
        // A step that leads to another page: the route change ends this segment, and the next page starts its own.
        if (view.step.next) {
          env.navigate(view.step.next);
          return;
        }
        s.acks.add(view.key);
        drive(s);
      },
      back: () => {
        if (session !== s || !view.backKey) return;
        s.acks.delete(view.backKey);
        drive(s);
      },
      leave: () => {
        if (session !== s) return;
        // Closing a chapter marks it skipped, unless it is already done or paused (a failed build can still finish it).
        const chapter = s.segment?.chapter;
        if (chapter && !view.mark) {
          const status = env.data().marks[chapter];
          if (status !== "done" && status !== "paused") env.saveMark(chapter, "skipped");
        }
        suppressed.add(s.segment?.id ?? "live");
        endSession(s, true);
      },
    };
  }

  /** Record an action on the target before the page changes (see BEFORE_CLICK). */
  function bind(view: View) {
    unbind();
    const anchor = view.step.anchor;
    const mark = anchor ? BEFORE_CLICK[anchor] : undefined;
    const el = anchor ? document.querySelector(`[data-tour="${anchor}"]`) : null;
    if (!mark || !el) return;
    const onClick = () => env.saveMark(mark.chapter, mark.status);
    el.addEventListener("click", onClick, true);
    unbindClick = () => el.removeEventListener("click", onClick, true);
  }

  function unbind() {
    unbindClick?.();
    unbindClick = null;
  }

  function endSession(s: Session, restoreFocus: boolean) {
    clearMissing(s);
    unbind();
    seq += 1;
    session = null;
    endTour(restoreFocus);
    // Whatever could still start (nothing, for a segment that was suppressed) decides whether to keep watching.
    watch(candidate() !== null);
  }

  /* ---------------------------------------------------------------------------------------- */

  // First look once the page has had a second to settle.
  startTimer = window.setTimeout(evaluate, START_DELAY_MS);

  return {
    refresh: schedule,
    dispose() {
      disposed = true;
      window.clearTimeout(startTimer);
      if (frame) window.cancelAnimationFrame(frame);
      watch(false);
      unbind();
      if (session) {
        clearMissing(session);
        session = null;
        seq += 1;
        // The page is gone: do not move focus into the page that replaces it.
        endTour(false);
      }
    },
  };
}
