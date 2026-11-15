import type { Chapter } from "@/lib/onboarding-marks";

/**
 * "Show the tour again" in the account menu asks for one chapter on one page. The request has to
 * survive a client-side move to that page, where a different layout (and so a different host) may
 * be mounted, so it lives in this module and not in a component or in storage. A full page reload
 * forgets it, which is right: a reload is not the person asking.
 */
export type ReplayRequest = { chapter: Chapter; path: string };

const MAX_AGE_MS = 30_000;

let pending: (ReplayRequest & { at: number }) | null = null;
const listeners = new Set<() => void>();

export function requestReplay(request: ReplayRequest) {
  pending = { ...request, at: Date.now() };
  for (const listener of listeners) listener();
}

/** The chapter asked for on this page, if the request is still fresh. Does not clear it. */
export function peekReplay(path: string): Chapter | null {
  if (!pending) return null;
  if (Date.now() - pending.at > MAX_AGE_MS) {
    pending = null;
    return null;
  }
  return pending.path === path ? pending.chapter : null;
}

/** The host calls this once the replay has started, so it runs once. */
export function clearReplay() {
  pending = null;
}

/** Called when a request is made, so a host that is already on the page can react. Returns the unsubscribe. */
export function onReplayRequest(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
