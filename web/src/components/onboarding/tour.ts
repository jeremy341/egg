import type { Driver } from "driver.js";
import type { TourLink, TourSide } from "@/lib/onboarding";

/**
 * A thin wrapper around Driver.js, loaded only when a tour first shows a step. The library draws
 * the dimming layer and the cut-out; this file adds what it leaves to the caller: motion that
 * follows the app's setting, a dialog role and name on the popover, focus that goes somewhere
 * sensible and comes back, Escape from anywhere, a polite announcement, and text that is escaped.
 *
 * It shows ONE step at a time. The host decides which step that is (see lib/onboarding-flow.ts)
 * and calls `showStep` again when it changes; Driver keeps the layer and moves the cut-out.
 * See docs/design/onboarding-spike-results.md for the problems this works around.
 */

export type StepSpec = {
  /** A `data-tour` value. Omit for a centred step with nothing highlighted. */
  anchor?: string;
  title: string;
  body: string;
  /** do: the person acts on the highlighted control (no primary button). read: they press the primary button. */
  kind: "read" | "do";
  side?: TourSide;
  /** Label of the primary button of a read step. */
  button: string;
  /** Label of the leave button. */
  leave: string;
  /** "2 of 5". Hidden when there is only one step. */
  position: number;
  total: number;
  /** Whether a Back button is offered. */
  back: boolean;
  link?: TourLink;
  /** A selector for something that stays clickable without being highlighted (the Confirm button of the host key step). */
  allow?: string;
};

export type StepHandlers = {
  /** The primary button of a read step. */
  primary: () => void;
  back: () => void;
  /** Skip tour, the close control, or Escape. */
  leave: () => void;
};

type DriverModule = typeof import("driver.js");

let driverModule: Promise<DriverModule> | null = null;
let instance: Driver | null = null;
let instanceReduced = false;
let current: { spec: StepSpec; handlers: StepHandlers } | null = null;
let returnTo: HTMLElement | null = null;
let token = 0;
let listening = false;

const LIVE_REGION = "egg-tour-live";
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function loadLibrary(): Promise<DriverModule> {
  if (!driverModule) {
    driverModule = Promise.all([
      import("driver.js"),
      import("driver.js/dist/driver.css"),
      import("@/components/onboarding/onboarding.css"),
    ]).then(([lib]) => lib);
    // A failed load (offline) must be tried again next time.
    driverModule.catch(() => {
      driverModule = null;
    });
  }
  return driverModule;
}

/** The app's own setting wins over the device setting, as in globals.css. */
export function motionReduced(): boolean {
  const mode = document.documentElement.dataset.motion;
  if (mode === "reduce") return true;
  if (mode === "no-preference") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Driver sets title and description as HTML, and the reason text can come from the server. */
function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/** Say something to a screen reader without moving focus. */
function announce(text: string) {
  let region = document.getElementById(LIVE_REGION);
  if (!region) {
    region = document.createElement("div");
    region.id = LIVE_REGION;
    region.className = "sr-only";
    region.setAttribute("role", "status");
    region.setAttribute("aria-live", "polite");
    document.body.appendChild(region);
  }
  const target = region;
  target.textContent = "";
  // A change after a tick is what makes the reader speak it.
  window.setTimeout(() => {
    target.textContent = text;
  }, 50);
}

function targetOf(anchor: string | undefined): HTMLElement | null {
  if (!anchor) return null;
  return document.querySelector<HTMLElement>(`[data-tour="${anchor}"]`);
}

/** True when the element is on screen and not hidden. */
function isShown(el: Element): boolean {
  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0 && getComputedStyle(el).visibility !== "hidden";
}

export function anchorShown(anchor: string): boolean {
  const el = targetOf(anchor);
  return el !== null && isShown(el);
}

/** The thing the person will use: the target itself when focusable, else the first control inside it. */
function focusTargetOf(el: HTMLElement): HTMLElement | null {
  if (el.matches(FOCUSABLE)) return el;
  return Array.from(el.querySelectorAll<HTMLElement>(FOCUSABLE)).find(isShown) ?? null;
}

/**
 * On a phone the popover is docked at the bottom, so the target is moved up the screen until it
 * sits clear above the popover (or, if it is taller than the room, until its top is just under the
 * top bar). Nothing is covered that the person has to use.
 */
function clearOfDockedPopover(el: HTMLElement, popover: HTMLElement, reduce: boolean) {
  if (!window.matchMedia("(max-width: 639px)").matches) {
    releaseDock();
    return;
  }
  const gap = 12;
  // A target at the very end of the page (the Deploy button) cannot scroll above the popover unless
  // the page has room below it, so the page gets that room while the popover is docked.
  document.body.style.paddingBottom = `${Math.ceil(popover.getBoundingClientRect().height + gap * 2)}px`;
  const top = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--topbar-height")) || 56;
  const room = popover.getBoundingClientRect().top - gap;
  const rect = el.getBoundingClientRect();
  let delta = 0;
  if (rect.bottom > room) delta = rect.bottom - room;
  // Never push the target's top above the top bar, and always show the top of a tall target.
  delta = Math.min(delta, rect.top - (top + gap));
  if (rect.top < top + gap) delta = rect.top - (top + gap);
  if (Math.abs(delta) > 1) window.scrollBy({ top: delta, behavior: reduce ? "auto" : "smooth" });
}

function releaseDock() {
  document.body.style.paddingBottom = "";
}

function decoratePopover(popover: import("driver.js").PopoverDOM, spec: StepSpec) {
  const wrapper = popover.wrapper;
  wrapper.setAttribute("role", "dialog");
  wrapper.setAttribute("aria-modal", "false");
  wrapper.setAttribute("data-kind", spec.kind);

  // The progress reads "Step 2 of 5" to a screen reader and "2 of 5" to everyone else.
  popover.progress.id = "driver-popover-progress";
  popover.progress.textContent = "";
  const hidden = document.createElement("span");
  hidden.className = "sr-only";
  hidden.textContent = "Step ";
  popover.progress.append(hidden, `${spec.position} of ${spec.total}`);
  wrapper.setAttribute("aria-labelledby", `${popover.title.id} ${popover.progress.id}`);
  wrapper.setAttribute("aria-describedby", popover.description.id);

  // The visible label says what the button does. A bare cross is not read as "skip".
  popover.closeButton.textContent = spec.leave;
  popover.closeButton.removeAttribute("aria-label");

  popover.wrapper.querySelector(".egg-tour-link")?.remove();
  if (spec.link) {
    const link = document.createElement("a");
    link.className = "egg-tour-link link";
    link.href = spec.link.href;
    link.target = "_blank";
    link.rel = "noreferrer";
    link.textContent = spec.link.label;
    const note = document.createElement("span");
    note.className = "sr-only";
    note.textContent = " (opens in a new tab)";
    link.append(note);
    popover.description.after(link);
  }
}

function onEscape(e: KeyboardEvent) {
  if (e.key !== "Escape" || !current) return;
  e.stopPropagation();
  e.preventDefault();
  current.handlers.leave();
}

function listen() {
  if (listening) return;
  // Driver ignores Escape while a text field has focus, which is exactly where a step that asks
  // for an action puts focus. A tour has to be closable from the keyboard wherever focus is.
  document.addEventListener("keydown", onEscape, true);
  listening = true;
}

function unlisten() {
  document.removeEventListener("keydown", onEscape, true);
  listening = false;
}

function destroyDriver() {
  releaseDock();
  const d = instance;
  instance = null;
  d?.destroy();
}

/**
 * Show one step. Returns false when it could not be shown (the target is not on the page, or a
 * newer call replaced this one while the library loaded); the host then decides what to do.
 */
export async function showStep(spec: StepSpec, handlers: StepHandlers): Promise<boolean> {
  const mine = ++token;
  const lib = await loadLibrary();
  if (mine !== token) return false;

  const target = targetOf(spec.anchor);
  if (spec.anchor && (!target || !isShown(target))) return false;

  if (!instance && !returnTo) {
    returnTo = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null;
  }

  const reduce = motionReduced();
  // The motion setting can change between steps; a layer made for the old one is rebuilt.
  if (instance && instanceReduced !== reduce) destroyDriver();
  current = { spec, handlers };

  if (!instance) {
    instanceReduced = reduce;
    instance = lib.driver({
      animate: !reduce,
      duration: 250,
      smoothScroll: !reduce,
      stagePadding: 6,
      stageRadius: 8,
      popoverOffset: 10,
      allowClose: false,
      allowKeyboardControl: false,
      overlayClickBehavior: "none",
      popoverClass: "egg-tour",
      // Colour and strength come from onboarding.css (theme tokens); these only have to be valid.
      overlayColor: "#000",
      overlayOpacity: 0.6,
      onDestroyed: () => {
        instance = null;
      },
    });
  }

  const step = spec;
  const allowed = step.allow ? Array.from(document.querySelectorAll<Element>(step.allow)) : undefined;
  instance.highlight({
    element: target ?? undefined,
    allowedElements: allowed && allowed.length > 0 ? allowed : undefined,
    popover: {
      title: escapeHtml(step.title),
      description: escapeHtml(step.body),
      side: step.side ?? "bottom",
      align: "start",
      popoverClass: "egg-tour",
      showButtons: [...(step.kind === "read" ? (["next"] as const) : []), ...(step.back ? (["previous"] as const) : []), "close"],
      showProgress: step.total > 1,
      progressText: `${step.position} of ${step.total}`,
      nextBtnText: step.button,
      prevBtnText: "Back",
      closeBtnLabel: step.leave,
      onNextClick: () => current?.handlers.primary(),
      onPrevClick: () => current?.handlers.back(),
      onCloseClick: () => current?.handlers.leave(),
      onPopoverRender: (popover) => decoratePopover(popover, step),
    },
    onHighlighted: (el) => {
      if (mine !== token) return;
      const wrapper = document.querySelector<HTMLElement>(".driver-popover.egg-tour");
      if (el instanceof HTMLElement && wrapper) clearOfDockedPopover(el, wrapper, reduce);
      if (step.kind === "do") {
        // The person has to act on the target, so focus goes there and the instruction is announced.
        const focus = el instanceof HTMLElement ? focusTargetOf(el) : null;
        if (focus) focus.focus({ preventScroll: true });
        else wrapper?.focus({ preventScroll: true });
        announce(`Step ${step.position} of ${step.total}. ${step.title} ${step.body}`);
      } else {
        // A step that explains puts focus on its main button.
        wrapper?.querySelector<HTMLElement>(".driver-popover-next-btn")?.focus({ preventScroll: true });
      }
    },
  });
  listen();
  return true;
}

/** Take the layer and the popover away (the step is waiting for something) but keep where focus returns to. */
export function hideStep() {
  token += 1;
  current = null;
  // Focus inside the popover is about to be lost with it; give it back to where it came from.
  const lost = document.activeElement?.closest(".driver-popover") != null;
  destroyDriver();
  if (lost) restoreFocus();
}

function restoreFocus() {
  if (returnTo?.isConnected) returnTo.focus({ preventScroll: true });
  else focusPage();
}

/** The page heading, or failing that the main region, so keyboard focus is not left on the body. */
function focusPage() {
  const target = document.querySelector<HTMLElement>("h1") ?? document.querySelector<HTMLElement>("#main");
  if (!target) return;
  if (!target.hasAttribute("tabindex")) target.setAttribute("tabindex", "-1");
  target.focus({ preventScroll: true });
}

/** Whether a step is on screen now. */
export function stepVisible(): boolean {
  return instance !== null;
}

/**
 * End the tour on this page. `focus` gives focus back to what had it before the tour
 * started, or to the page heading if that is gone; a route change passes false because the old
 * page is gone and the new one has its own focus.
 */
export function endTour(focus: boolean) {
  token += 1;
  current = null;
  // Escape from a field the step sent focus to: the person is typing there, so focus stays.
  const a = document.activeElement;
  const onPage = a instanceof HTMLElement && a !== document.body && !a.closest(".driver-popover");
  destroyDriver();
  unlisten();
  if (focus && !onPage) restoreFocus();
  returnTo = null;
}
