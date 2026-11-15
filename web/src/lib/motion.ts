/**
 * True when animation should be off. It matches the CSS in globals.css: the
 * Settings choice (data-motion="reduce" on <html>) turns motion off whatever the
 * device says, and otherwise the device setting decides. Browser only: call it
 * from an effect or an event handler, never while rendering.
 */
export function motionReduced(): boolean {
  if (document.documentElement.getAttribute("data-motion") === "reduce") return true;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
