import { and, eq, isNull, like, lt, or, inArray } from "drizzle-orm";
import { z } from "zod";
import { audit } from "@/server/audit";
import { isInstanceAdmin } from "@/server/admin-identity";
import { getDb, schema, withLockRetry } from "@/server/db";
import { LOCK_STALE_AFTER_MS, renewBuildLock } from "@/server/deploy/build-lock";
import { isValidSlug, unitName } from "@/server/deploy/layout";
import * as remote from "@/server/deploy/remote";
import { HttpError } from "@/server/http";
import { connectToServer, type ServerRow } from "@/server/servers";
import { shellQuote } from "@/server/ssh/connection";
import type { NestSession } from "@/server/ssh/connection";

const inputSchema = z.object({
  confirm: z.literal(true), workerStoppedConfirmed: z.literal(true),
  workerId: z.string().min(1).max(200),
  // A stale recovery attempt leaves a "recovery:<id>" fence as the holder; a retry
  // may pass that fence or the bare deployment id, both resolve to the same holder.
  holder: z.string().regex(/^(?:recovery:)?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i),
  lockAt: z.string().datetime(),
}).strict();
const JOB_STALE_MS = 60_000;
const STOP_SCOPES = `set -euo pipefail
listing=$(systemctl list-units --type=scope --all --no-legend --plain --no-pager 'egg-build-*.scope')
while read -r unit rest; do
  [ -n "$unit" ] || continue
  [[ "$unit" =~ ^egg-build-[0-9a-f]{8}\.scope$ ]] || exit 1
  state=$(systemctl show "$unit" -p ActiveState --value)
  case "$state" in
    active|activating|deactivating|reloading) systemctl stop "$unit" ;;
    inactive|failed) ;;
    *) exit 1 ;;
  esac
  state=$(systemctl show "$unit" -p ActiveState --value)
  case "$state" in inactive|failed) ;; *) exit 1;; esac
done <<< "$listing"
`;
/** Activation commands run outside any build scope, so a deployment recovered mid-activation must
 * also have its unit, containers and Compose services stopped: the recovered deployment is
 * recorded as errored, and a remote half-activated unit would silently keep serving instead.
 * A crash before activation began never touched the unit, containers or Compose stack — the
 * previous release is still serving from them — so those lines are omitted. A preview deployment
 * never gets the Compose teardown: aux services belong to the project's Compose project, which
 * the production deployment owns, and tearing it down would take production's aux services. */
function recoveryStopScript(a: {
  slug: string; unit: string; container: string; composeProject: string;
  activationBegun: boolean; production: boolean;
}) {
  if (!isValidSlug(a.slug)) throw new HttpError(400, "The project name is not valid.", "validation");
  return (
    STOP_SCOPES +
    (a.activationBegun
      ? `systemctl stop ${shellQuote(a.unit)} >/dev/null 2>&1 || true\n` +
        `docker rm -f -- ${shellQuote(a.container)} ${shellQuote(`${a.container}-back`)} >/dev/null 2>&1 || true\n` +
        (a.production
          ? `docker compose -p ${shellQuote(a.composeProject)} down --remove-orphans >/dev/null 2>&1 || true\n`
          : "")
      : "")
  );
}
async function adminOnly(userId: string) {
  if (!(await isInstanceAdmin(userId))) throw new HttpError(403, "Only an instance administrator can recover jobs.", "forbidden");
}

/** Administrative inspection omits credentials and never changes a guard. */
export async function inspectRecovery(userId: string) {
  await adminOnly(userId);
  const db = await getDb();
  const rows = await db.select({ serverId: schema.servers.id, holder: schema.servers.buildLockHolder,
    lockAt: schema.servers.buildLockAt, jobId: schema.jobs.id, jobState: schema.jobs.state,
    workerId: schema.jobs.lockedBy, heartbeatAt: schema.jobs.lockedAt, deploymentState: schema.deployments.state })
    .from(schema.servers).leftJoin(schema.deployments, eq(schema.deployments.id, schema.servers.buildLockHolder))
    .leftJoin(schema.jobs, and(eq(schema.jobs.deploymentId, schema.deployments.id), eq(schema.jobs.state, "running")));
  const jobs = await db.select({ jobId: schema.jobs.id, deploymentId: schema.jobs.deploymentId, workerId: schema.jobs.lockedBy,
    heartbeatAt: schema.jobs.lockedAt, state: schema.deployments.state, serverId: schema.projects.serverId })
    .from(schema.jobs).innerJoin(schema.deployments, eq(schema.deployments.id, schema.jobs.deploymentId))
    .innerJoin(schema.projects, eq(schema.projects.id, schema.deployments.projectId))
    .where(and(eq(schema.jobs.state, "running"), lt(schema.jobs.lockedAt, new Date(Date.now() - JOB_STALE_MS))));
  await audit(userId, "admin.recovery.inspect");
  const adoptions = await db.select({ id: schema.adoptionPlans.id, projectId: schema.adoptionPlans.projectId,
    confirmedAt: schema.adoptionPlans.confirmedAt }).from(schema.adoptionPlans).where(eq(schema.adoptionPlans.state, "executing"));
  return { locks: rows.filter(row => row.holder && (!row.lockAt || Date.now() - row.lockAt.getTime() >= LOCK_STALE_AFTER_MS)), jobs,
    adoptions: adoptions.map(p => ({ ...p, resolution: "Guard retained: verify the original and Egg services, their ports and all workers manually. App-import guards are never cleared by build-lock recovery." })) };
}

/** The operator must establish the original worker is stopped; heartbeat age alone cannot prove that. */
export async function recoverBuild(admin: string, serverId: string, raw: unknown,
  connect: (server: ServerRow) => Promise<NestSession> = connectToServer): Promise<void> {
  await adminOnly(admin);
  const input = inputSchema.parse(raw);
  const holder = input.holder.replace(/^recovery:/i, "").toLowerCase();
  const db = await getDb();
  const at = new Date(input.lockAt);
  // The fence embeds the holder it recovers, so it is deterministic: when a
  // recovery attempt fails after re-locking (SSH down, scopes still running),
  // the guard it leaves is the same fence the retry derives, so the retry can
  // adopt it and finish instead of the server being locked out forever.
  const fence = `recovery:${holder}`;
  await audit(admin, "admin.recovery.attempt", serverId, { holder, workerId: input.workerId, workerStoppedConfirmed: true });
  let session: NestSession | undefined;
  let renewal: ReturnType<typeof setInterval> | undefined;
  let lost = false;
  try {
    // A second operator can be writing the same rows at the same moment; retry
    // SQLite lock contention so the loser still gets the clean 409 from the
    // guards instead of a raw database error.
    const snapshot = await withLockRetry(() => db.transaction(async tx => {
      const row = await tx.select({ server: schema.servers, job: schema.jobs, deployment: schema.deployments, project: schema.projects })
        .from(schema.servers)
        .innerJoin(schema.projects, eq(schema.projects.serverId, schema.servers.id))
        .innerJoin(schema.deployments, eq(schema.deployments.projectId, schema.projects.id))
        .innerJoin(schema.jobs, eq(schema.jobs.deploymentId, schema.deployments.id))
        .where(and(eq(schema.servers.id, serverId), eq(schema.deployments.id, holder),
          eq(schema.jobs.state, "running"),
          // A running job is either the stale worker's claim or a fence left by
          // an earlier recovery attempt of this same deployment.
          or(eq(schema.jobs.lockedBy, input.workerId), like(schema.jobs.lockedBy, "recovery:%")))).get();
      const now = Date.now();
      if (!row || !row.job.lockedAt || now - row.job.lockedAt.getTime() < JOB_STALE_MS) {
        throw new HttpError(409, "The guard or worker changed, or is not stale. Inspect it again.", "conflict");
      }
      // The build lock is held through the build; during activation it is
      // already released. A null lock fences nothing, and when another build
      // owns the lock it is not this deployment's to recover.
      const currentHolder = row.server.buildLockHolder;
      const lockHeld = currentHolder === holder || currentHolder === fence;
      const lockTaken = currentHolder !== null && currentHolder !== undefined;
      if (lockTaken && !lockHeld) {
        throw new HttpError(409, "The build lock belongs to another build. Inspect it again.", "conflict");
      }
      if (lockHeld && (row.server.buildLockAt?.getTime() !== at.getTime()
        || now - at.getTime() < LOCK_STALE_AFTER_MS)) {
        throw new HttpError(409, "The guard changed, or is not stale. Inspect it again.", "conflict");
      }
      const job = await tx.update(schema.jobs).set({ lockedBy: fence, lockedAt: new Date() })
        .where(and(eq(schema.jobs.id, row.job.id), eq(schema.jobs.state, "running"), eq(schema.jobs.lockedBy, row.job.lockedBy ?? ""), eq(schema.jobs.lockedAt, row.job.lockedAt))).returning({ id: schema.jobs.id });
      // The build lock is fenced even when the crash left it free: recovery sweeps
      // every build scope on the server, so a build that starts while recovery is
      // running must be refused rather than killed mid-flight.
      const lock = lockHeld && currentHolder
        ? await tx.update(schema.servers).set({ buildLockHolder: fence, buildLockAt: new Date() })
            .where(and(eq(schema.servers.id, serverId), eq(schema.servers.buildLockHolder, currentHolder), eq(schema.servers.buildLockAt, at)))
            .returning({ id: schema.servers.id })
        : await tx.update(schema.servers).set({ buildLockHolder: fence, buildLockAt: new Date() })
            .where(and(eq(schema.servers.id, serverId), isNull(schema.servers.buildLockHolder)))
            .returning({ id: schema.servers.id });
      if (job.length !== 1 || lock.length !== 1) throw new HttpError(409, "The guard changed; inspect it again.", "conflict");
      return { row, lockHeld };
    }));
    renewal = setInterval(() => {
      void (async () => {
        // The lock is always fenced now, so renewal always finds it; a false
        // return means the lock was taken over and recovery must stop. The
        // job lease refresh keeps a second operator from re-fencing a live
        // recovery once the original heartbeat staleness window passes.
        const ok = await renewBuildLock(serverId, fence).catch(() => false);
        if (!ok) { lost = true; return; }
        try {
          await db.update(schema.jobs).set({ lockedAt: new Date() })
            .where(and(eq(schema.jobs.id, snapshot.row.job.id), eq(schema.jobs.lockedBy, fence)));
        } catch { lost = true; }
      })();
    }, 20_000);
    const preview = snapshot.row.deployment.env === "preview";
    const unit = unitName(snapshot.row.project.slug, preview ? { releaseId: snapshot.row.deployment.releaseId } : undefined);
    const container = remote.dockerContainerName(snapshot.row.project.slug, preview ? { releaseId: snapshot.row.deployment.releaseId } : undefined);
    session = await connect(snapshot.row.server);
    const result = await session.script(recoveryStopScript({
      slug: snapshot.row.project.slug,
      unit,
      container,
      composeProject: remote.dockerComposeProjectName(snapshot.row.project.slug),
      activationBegun: snapshot.row.deployment.activationStartedAt !== null,
      production: !preview,
    }), { timeoutMs: 60_000 });
    if (result.code !== 0 || lost) throw new Error("Remote build scopes could not be confirmed stopped; the recovery guard remains in place.");
    await withLockRetry(() => db.transaction(async tx => {
      const lock = await tx.update(schema.servers).set({ buildLockHolder: null, buildLockAt: null })
        .where(and(eq(schema.servers.id, serverId), eq(schema.servers.buildLockHolder, fence))).returning({ id: schema.servers.id });
      const job = await tx.update(schema.jobs).set({ state: "failed", error: "Recovered after the operator confirmed the worker stopped." })
        .where(and(eq(schema.jobs.id, snapshot.row.job.id), eq(schema.jobs.state, "running"), eq(schema.jobs.lockedBy, fence))).returning({ id: schema.jobs.id });
      if (job.length !== 1 || lost) throw new Error("Recovery guard changed; the guard remains in place.");
      if (lock.length !== 1) throw new Error("Recovery guard changed; the guard remains in place.");
      // A deployment still in a live run state when recovery started is marked
      // errored so the user can redeploy or roll back. Any other state — the
      // user canceled it during the stale window, or it finished before the
      // crash — stays untouched; only the queue guard is released.
      await tx.update(schema.deployments).set({ state: "error", error: "The operator recovered an interrupted deployment.", finishedAt: new Date() })
        .where(and(eq(schema.deployments.id, holder), eq(schema.deployments.state, snapshot.row.deployment.state),
          inArray(schema.deployments.state, ["queued", "building", "deploying"])));
    }));
    await audit(admin, "admin.recovery.complete", serverId, { holder, workerId: input.workerId });
  } catch (err) {
    await audit(admin, "admin.recovery.failed", serverId, { holder, workerId: input.workerId });
    throw err;
  } finally {
    if (renewal) clearInterval(renewal);
    session?.close();
  }
}

