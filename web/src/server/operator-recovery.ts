import { and, eq, lt } from "drizzle-orm";
import { z } from "zod";
import { audit } from "@/server/audit";
import { isInstanceAdmin } from "@/server/admin-identity";
import { newId } from "@/server/crypto";
import { getDb, schema } from "@/server/db";
import { LOCK_STALE_AFTER_MS, renewBuildLock } from "@/server/deploy/build-lock";
import { HttpError } from "@/server/http";
import { connectToServer, type ServerRow } from "@/server/servers";
import type { NestSession } from "@/server/ssh/connection";

const inputSchema = z.object({
  confirm: z.literal(true), workerStoppedConfirmed: z.literal(true),
  workerId: z.string().min(1).max(200), holder: z.string().uuid(), lockAt: z.string().datetime(),
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
function adminOnly(userId: string) {
  if (!isInstanceAdmin(userId)) throw new HttpError(403, "Only the instance administrator can recover jobs.", "forbidden");
}

/** Administrative inspection omits credentials and never changes a guard. */
export async function inspectRecovery(userId: string) {
  adminOnly(userId);
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
  adminOnly(admin);
  const input = inputSchema.parse(raw);
  const db = await getDb();
  const at = new Date(input.lockAt);
  const fence = `recovery:${newId()}`;
  await audit(admin, "admin.recovery.attempt", serverId, { holder: input.holder, workerId: input.workerId, workerStoppedConfirmed: true });
  let session: NestSession | undefined;
  let renewal: ReturnType<typeof setInterval> | undefined;
  let lost = false;
  try {
    const snapshot = await db.transaction(async tx => {
      const row = await tx.select({ server: schema.servers, job: schema.jobs, deployment: schema.deployments })
        .from(schema.servers)
        .innerJoin(schema.projects, eq(schema.projects.serverId, schema.servers.id))
        .innerJoin(schema.deployments, eq(schema.deployments.projectId, schema.projects.id))
        .innerJoin(schema.jobs, eq(schema.jobs.deploymentId, schema.deployments.id))
        .where(and(eq(schema.servers.id, serverId), eq(schema.deployments.id, input.holder),
          eq(schema.jobs.state, "running"), eq(schema.jobs.lockedBy, input.workerId))).get();
      const now = Date.now();
      if (!row || row.server.buildLockHolder !== input.holder || row.server.buildLockAt?.getTime() !== at.getTime()
        || now - at.getTime() < LOCK_STALE_AFTER_MS || !row.job.lockedAt || now - row.job.lockedAt.getTime() < JOB_STALE_MS
        || row.deployment.state !== "building" || row.deployment.activationStartedAt) {
        throw new HttpError(409, "The guard or worker changed, is not stale, or has reached activation. Inspect it again.", "conflict");
      }
      const job = await tx.update(schema.jobs).set({ lockedBy: fence, lockedAt: new Date() })
        .where(and(eq(schema.jobs.id, row.job.id), eq(schema.jobs.state, "running"), eq(schema.jobs.lockedBy, input.workerId), eq(schema.jobs.lockedAt, row.job.lockedAt))).returning({ id: schema.jobs.id });
      const lock = await tx.update(schema.servers).set({ buildLockHolder: fence, buildLockAt: new Date() })
        .where(and(eq(schema.servers.id, serverId), eq(schema.servers.buildLockHolder, input.holder), eq(schema.servers.buildLockAt, at)))
        .returning({ id: schema.servers.id });
      if (job.length !== 1 || lock.length !== 1) throw new HttpError(409, "The guard changed; inspect it again.", "conflict");
      return row;
    });
    renewal = setInterval(() => { void renewBuildLock(serverId, fence).then(ok => { if (!ok) lost = true; }).catch(() => { lost = true; }); }, 20_000);
    session = await connect(snapshot.server);
    const result = await session.script(STOP_SCOPES, { timeoutMs: 60_000 });
    if (result.code !== 0 || lost) throw new Error("Remote build scopes could not be confirmed stopped; the recovery guard remains in place.");
    await db.transaction(async tx => {
      const lock = await tx.update(schema.servers).set({ buildLockHolder: null, buildLockAt: null })
        .where(and(eq(schema.servers.id, serverId), eq(schema.servers.buildLockHolder, fence))).returning({ id: schema.servers.id });
      const job = await tx.update(schema.jobs).set({ state: "failed", error: "Recovered after the operator confirmed the worker stopped." })
        .where(and(eq(schema.jobs.id, snapshot.job.id), eq(schema.jobs.state, "running"), eq(schema.jobs.lockedBy, fence))).returning({ id: schema.jobs.id });
      if (lock.length !== 1 || job.length !== 1 || lost) throw new Error("Recovery guard changed; the guard remains in place.");
      await tx.update(schema.deployments).set({ state: "error", error: "The operator recovered an interrupted build.", finishedAt: new Date() })
        .where(and(eq(schema.deployments.id, input.holder), eq(schema.deployments.state, "building")));
    });
    await audit(admin, "admin.recovery.complete", serverId, { holder: input.holder, workerId: input.workerId });
  } catch (err) {
    await audit(admin, "admin.recovery.failed", serverId, { holder: input.holder, workerId: input.workerId });
    throw err;
  } finally {
    if (renewal) clearInterval(renewal);
    session?.close();
  }
}

