import { HttpError } from "@/server/http";

/**
 * How many deployment log streams (app/api/deployments/[id]/stream) one signed-in
 * user may hold open at once. Each stream lives for up to fifteen minutes and
 * polls the database, so a small cap keeps one account from parking the whole
 * process. Counted in this process only, like the terminal sessions.
 */
export const MAX_DEPLOYMENT_STREAMS_PER_USER = 3;

/**
 * Instance-wide ceiling on deployment log streams held at once, across every signed-in user. The per-user cap above
 * stops one account from parking the process; this one stops many accounts together from doing the same. Each stream
 * polls the database and lives for up to fifteen minutes, so the process-wide number has to be bounded too.
 */
export const MAX_DEPLOYMENT_STREAMS_TOTAL = 24;

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
  const all = counts();
  let total = 0;
  for (const n of all.values()) total += n;
  if (total >= MAX_DEPLOYMENT_STREAMS_TOTAL) {
    throw new HttpError(
      429,
      "Too many deployment log streams are open. Wait for one to finish and try again.",
      "rate_limited",
      { "Retry-After": "30" }
    );
  }
  const mine = all.get(userId) ?? 0;
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
