import { HttpError } from "@/server/http";

/**
 * How many deployment log streams (app/api/deployments/[id]/stream) one signed-in
 * user may hold open at once. Each stream lives for up to fifteen minutes and
 * polls the database, so a small cap keeps one account from parking the whole
 * process. Counted in this process only, like the terminal sessions.
 */
export const MAX_DEPLOYMENT_STREAMS_PER_USER = 3;

const KEY = Symbol.for("egg.deployment-streams");

function counts(): Map<string, number> {
  const g = globalThis as unknown as Record<symbol, Map<string, number> | undefined>;
  return (g[KEY] ??= new Map<string, number>());
}

/**
 * Reserve a stream for `userId`, or throw 429 when they already hold the cap. The returned function frees the
 * slot; calling it again does nothing. A stream that is never freed is dropped by the route's expiry timer.
 */
export function takeDeploymentStream(userId: string): () => void {
  const mine = counts().get(userId) ?? 0;
  if (mine >= MAX_DEPLOYMENT_STREAMS_PER_USER) {
    throw new HttpError(
      429,
      "Too many deployment log streams open. Wait for one to finish and try again.",
      "rate_limited",
      { "Retry-After": "30" }
    );
  }
  counts().set(userId, mine + 1);
  let held = true;
  return () => {
    if (!held) return;
    held = false;
    const left = (counts().get(userId) ?? 1) - 1;
    if (left > 0) counts().set(userId, left);
    else counts().delete(userId);
  };
}

/** How many streams each user holds right now. For tests. */
export function deploymentStreamsInUse(): Record<string, number> {
  return Object.fromEntries(counts());
}

/** Forget every held stream. For tests. */
export function resetDeploymentStreams(): void {
  counts().clear();
}
