import { and, eq, isNull, or } from "drizzle-orm";
import { getDb, schema } from "@/server/db";

/**
 * One build at a time on a container, so a preview build cannot starve a production
 * build of memory, and so two source extractions cannot both measure the same free disk
 * space. The lock is two columns on the server row (holder and last renewal) and is shared
 * by all Egg workers.
 *
 * How the lock ends, and what a waiting build may do about it:
 *
 *  - A build that finishes, fails or is canceled gives the lock back, but only after it has
 *    confirmed on the container that its own build scope is stopped and its files are removed.
 *    If it could not confirm that (the connection died, the cleanup did not run), it keeps the
 *    lock and stops renewing it, so the lock goes stale instead of opening early.
 *  - A lock that was not renewed for LOCK_STALE_AFTER_MS is stale. A stale lock is never taken
 *    blindly: its holder may be a paused Egg worker whose build is still running on the
 *    container. A waiting build first has to verify over its own SSH session that no
 *    egg-build scope is running (stopping any that is) and that the holder's leftovers are
 *    removed. That is the `verifyStale` callback. Only when it succeeds is the lock taken, with a
 *    compare-and-swap on the stale holder and its timestamp, so of several waiting builds only
 *    one takes it and the others go back to waiting. If the check fails, the waiting build fails
 *    closed with the callback's error, and the lock stays as it was.
 *  - A holder that comes back after its lock was taken has its renewal refused. It is then told
 *    (`handle.lost`) and has to stop its own build.
 *
 * Without a `verifyStale` callback a stale lock is never taken at all.
 */
export const LOCK_STALE_AFTER_MS = 90_000;
export const LOCK_RENEW_EVERY_MS = 20_000;
export const LOCK_POLL_MS = 3_000;
/** How long a build waits for the build ahead of it before it gives up. */
export const LOCK_MAX_WAIT_MS = 30 * 60_000;

export class BuildLockError extends Error {}

/** The holder and last renewal of a lock that has gone stale. */
export type StaleLock = { holder: string; at: Date | null };

/** Take the lock if it is free or already ours. A stale lock is not taken here; see `takeOverBuildLock`. */
export async function tryAcquireBuildLock(
  serverId: string,
  holder: string,
  now = new Date()
): Promise<boolean> {
  const db = await getDb();
  const taken = await db
    .update(schema.servers)
    .set({ buildLockHolder: holder, buildLockAt: now })
    .where(
      and(
        eq(schema.servers.id, serverId),
        or(isNull(schema.servers.buildLockHolder), eq(schema.servers.buildLockHolder, holder))
      )
    )
    .returning({ id: schema.servers.id });
  return taken.length === 1;
}

/**
 * Take a stale lock over, only if it still has exactly the holder and timestamp that were seen
 * when it was found stale. A renewal, a release or another build's takeover in between changes
 * one of them, and then this returns false and changes nothing. The caller must already have
 * verified that the stale holder's remote build is stopped.
 */
export async function takeOverBuildLock(
  serverId: string,
  stale: StaleLock,
  holder: string,
  now = new Date()
): Promise<boolean> {
  const db = await getDb();
  const taken = await db
    .update(schema.servers)
    .set({ buildLockHolder: holder, buildLockAt: now })
    .where(
      and(
        eq(schema.servers.id, serverId),
        eq(schema.servers.buildLockHolder, stale.holder),
        stale.at ? eq(schema.servers.buildLockAt, stale.at) : isNull(schema.servers.buildLockAt)
      )
    )
    .returning({ id: schema.servers.id });
  return taken.length === 1;
}

/** Keep the lock. False when it is no longer ours. */
export async function renewBuildLock(serverId: string, holder: string, now = new Date()): Promise<boolean> {
  const db = await getDb();
  const renewed = await db
    .update(schema.servers)
    .set({ buildLockAt: now })
    .where(and(eq(schema.servers.id, serverId), eq(schema.servers.buildLockHolder, holder)))
    .returning({ id: schema.servers.id });
  return renewed.length === 1;
}

/** Give the lock back. Does nothing if someone else holds it by now. */
export async function releaseBuildLock(serverId: string, holder: string): Promise<void> {
  const db = await getDb();
  await db
    .update(schema.servers)
    .set({ buildLockHolder: null, buildLockAt: null })
    .where(and(eq(schema.servers.id, serverId), eq(schema.servers.buildLockHolder, holder)));
}

export async function buildLockForServer(serverId: string) {
  const db = await getDb();
  return db.select({ holder: schema.servers.buildLockHolder, at: schema.servers.buildLockAt })
    .from(schema.servers).where(eq(schema.servers.id, serverId)).get();
}

export type BuildLockOptions = {
  signal?: AbortSignal;
  /** Called once, when the lock is taken by someone else and this build has to wait. */
  onWait?: () => void;
  /**
   * Called with a stale lock's holder. It must check on the container that the holder's build is
   * stopped and clean up after it, and throw if it cannot confirm that. When it returns, the lock
   * is taken over (compare-and-swap). Without it a stale lock fails the wait.
   */
  verifyStale?: (stale: StaleLock) => Promise<void>;
  pollMs?: number;
  maxWaitMs?: number;
  renewMs?: number;
  /** How long without a renewal makes a lock stale. Defaults to LOCK_STALE_AFTER_MS. */
  staleAfterMs?: number;
};

/** What the build running under the lock is given. */
export type BuildLockHandle = {
  /** Aborts when this build no longer holds the lock (it was taken over, or renewals kept failing). The build must stop. */
  lost: AbortSignal;
  /**
   * Call before throwing when the remote build could not be confirmed stopped. The lock is then
   * not released on that error: it goes stale, and the next build verifies and takes it over.
   */
  keep: () => void;
};

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal?.removeEventListener("abort", done);
      resolve();
    }
    signal?.addEventListener("abort", done, { once: true });
  });

/**
 * Run `fn` while holding the server's build lock, waiting for the build ahead if there is
 * one. `fn` is told whether it had to wait (a stale lock that was taken over counts as waiting,
 * because the disk may have changed). A canceled deployment stops waiting at once and never
 * takes the lock.
 */
export async function withBuildLock<T>(
  serverId: string,
  holder: string,
  options: BuildLockOptions,
  fn: (waited: boolean, lock: BuildLockHandle) => Promise<T>
): Promise<T> {
  const pollMs = options.pollMs ?? LOCK_POLL_MS;
  const maxWaitMs = options.maxWaitMs ?? LOCK_MAX_WAIT_MS;
  const staleAfterMs = options.staleAfterMs ?? LOCK_STALE_AFTER_MS;
  const startedAt = Date.now();
  let waited = false;

  for (;;) {
    if (options.signal?.aborted) throw new BuildLockError("The deployment was canceled.");
    if (await tryAcquireBuildLock(serverId, holder)) break;
    const lock = await buildLockForServer(serverId);
    // Released between the two reads: try again at once.
    if (!lock?.holder) continue;
    if (lock.holder.startsWith("recovery:")) {
      throw new BuildLockError("An operator recovery guard is present and must be resolved before another build can start.");
    }
    if (!lock.at || Date.now() - lock.at.getTime() >= staleAfterMs) {
      if (!options.verifyStale) {
        throw new BuildLockError(
          "A previous build lock expired without confirming that its remote process stopped, and nothing here could check. The build was not started."
        );
      }
      const stale: StaleLock = { holder: lock.holder, at: lock.at ?? null };
      waited = true;
      await options.verifyStale(stale);
      if (options.signal?.aborted) throw new BuildLockError("The deployment was canceled.");
      if (await takeOverBuildLock(serverId, stale, holder)) break;
      // Someone else took it, or the holder renewed or released it while we checked: look again.
      continue;
    }
    if (!waited) {
      waited = true;
      options.onWait?.();
    }
    if (Date.now() - startedAt >= maxWaitMs) {
      throw new BuildLockError(
        "Another build has been running on this container for more than 30 minutes, so this one did not start. Your app is still running."
      );
    }
    await sleep(pollMs, options.signal);
  }

  const lostController = new AbortController();
  let lastRenewed = Date.now();
  const lose = () => {
    clearInterval(timer);
    lostController.abort();
  };
  const timer = setInterval(() => {
    void renewBuildLock(serverId, holder)
      .then((ok) => {
        // Refused: someone verified us stale and took the lock. Our build must stop.
        if (ok) lastRenewed = Date.now();
        else lose();
      })
      .catch(() => {
        // Could not tell. Past the stale time someone else may take the lock, so stop before that.
        if (Date.now() - lastRenewed >= staleAfterMs) lose();
      });
  }, options.renewMs ?? LOCK_RENEW_EVERY_MS);

  let kept = false;
  let failed = false;
  try {
    return await fn(waited, { lost: lostController.signal, keep: () => (kept = true) });
  } catch (err) {
    failed = true;
    throw err;
  } finally {
    clearInterval(timer);
    // Kept on an error whose remote stop was not confirmed: nobody renews it, so it goes stale.
    if (!(failed && kept)) await releaseBuildLock(serverId, holder).catch(() => {});
  }
}
