import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { audit } from "@/server/audit";
import { assertCleanupAllowsWork } from "@/server/cleanup-guards";
import { newId } from "@/server/crypto";
import { getDb, schema } from "@/server/db";
import { HttpError } from "@/server/http";
import { assertDeletable, assertProjectIdle, getProjectForUser, type ProjectRow } from "@/server/projects";
import { moveProjectToTrash, trashProject } from "@/server/project-trash";
import { removeProjectFromServer } from "@/server/runtime-info";
import { getServerForUser } from "@/server/servers";

/** Long enough for one remote removal. A crash leaves the row to expire into the cleanup recovery path. */
const RESERVATION_LEASE_MS = 10 * 60_000;
const RESERVATION_RENEW_MS = 30_000;

type Tx = Parameters<Parameters<Awaited<ReturnType<typeof getDb>>["transaction"]>[0]>[0];

export type ProjectDeleteOptions = { remote: boolean; deleteData?: boolean };

export type ProjectDeleteDeps = {
  /** Replaces the remote removal, so tests can spy on it or hold it open. */
  removeRemote?: (userId: string, projectId: string, opts: { deleteData: boolean }) => Promise<void>;
};

/**
 * Delete a project, optionally removing its service and releases from the Nest server first.
 *
 * With `remote`, a cleanup row is written before anything touches the server. Every path that
 * starts work checks that row, so no deployment can be queued between the check and the removal.
 * If the removal fails, the row is deleted again and the project records stay.
 */
export async function deleteProject(
  userId: string,
  projectId: string,
  opts: ProjectDeleteOptions,
  deps: ProjectDeleteDeps = {}
) {
  if (!opts.remote) return trashProject(userId, projectId);
  const project = await getProjectForUser(userId, projectId);
  assertDeletable(project);
  const reservation = await reserveProject(userId, project);
  // Keep the lease alive while the removal runs, so a slow server does not make the
  // reservation look abandoned and open it to the cleanup retry flow.
  const heartbeat = setInterval(() => void renewReservation(reservation).catch(() => {}), RESERVATION_RENEW_MS);
  try {
    const removeRemote = deps.removeRemote ?? defaultRemoveRemote;
    await removeRemote(userId, project.id, { deleteData: opts.deleteData ?? false });
  } catch (err) {
    // The original error matters more; a row left behind expires into cleanup's recovery path.
    await releaseReservation(reservation).catch(() => {});
    throw err;
  } finally {
    clearInterval(heartbeat);
  }
  await finishDelete(userId, project, reservation);
}

async function renewReservation(reservation: Reservation) {
  const db = await getDb();
  const now = new Date();
  await db.update(schema.cleanupJobs)
    .set({ leaseUntil: new Date(now.getTime() + RESERVATION_LEASE_MS), updatedAt: now })
    .where(and(eq(schema.cleanupJobs.id, reservation.jobId), eq(schema.cleanupJobs.leaseOwner, reservation.owner)));
}

async function defaultRemoveRemote(userId: string, projectId: string, opts: { deleteData: boolean }) {
  // The cleanup row already blocks new work, so the connection is allowed past it.
  await removeProjectFromServer(userId, projectId, {
    deleteData: opts.deleteData,
    connect: { allowDuringCleanup: true, cleanupExecutor: true },
  });
}

/** Same refusals as trashProject, checked in the same transaction as the reservation. */
async function assertNoProjectWork(tx: Tx, projectId: string) {
  await assertProjectIdle(tx, projectId);
}

type Reservation = { jobId: string; owner: string };

async function reserveProject(userId: string, project: ProjectRow): Promise<Reservation> {
  const db = await getDb();
  const server = await getServerForUser(userId, project.serverId);
  const jobId = newId();
  const owner = `delete-${randomUUID()}`;
  for (let attempt = 0; ; attempt++) {
    const now = new Date();
    try {
      await db.transaction(async (tx) => {
        await assertCleanupAllowsWork(tx, userId, project.id);
        await assertNoProjectWork(tx, project.id);
        await tx.insert(schema.cleanupJobs).values({
          id: jobId,
          userId,
          scope: "project",
          projectId: project.id,
          state: "running",
          requestedAt: now,
          notBefore: now,
          startedAt: now,
          attempts: 1,
          step: "deleting",
          leaseOwner: owner,
          leaseUntil: new Date(now.getTime() + RESERVATION_LEASE_MS),
          updatedAt: now,
        });
        await tx.insert(schema.cleanupItems).values({
          id: newId(),
          cleanupJobId: jobId,
          projectId: project.id,
          serverId: project.serverId,
          projectName: project.name,
          projectSlug: project.slug,
          serverLabel: `${server.nestUsername}.hackclub.app`,
          state: "running",
          attempts: 1,
          step: "deleting",
          updatedAt: now,
        });
      });
      return { jobId, owner };
    } catch (err) {
      if (err instanceof HttpError) throw err;
      if (isUnique(err)) throw new HttpError(409, "Cleanup is already in progress for this project.", "cleanup_in_progress");
      // SQLite can refuse competing write transactions at once. Retry only lock contention.
      if (attempt >= 49 || !(err instanceof Error) || !/SQLITE_BUSY|SQLITE_LOCKED/.test(err.message)) throw err;
      await new Promise((resolve) => setTimeout(resolve, 20 + attempt * 5));
    }
  }
}

async function releaseReservation(reservation: Reservation) {
  const db = await getDb();
  // Items go with the job (foreign keys cascade). Only our own lease can release it.
  await db.delete(schema.cleanupJobs).where(and(
    eq(schema.cleanupJobs.id, reservation.jobId),
    eq(schema.cleanupJobs.leaseOwner, reservation.owner)
  ));
}

async function finishDelete(userId: string, project: ProjectRow, reservation: Reservation) {
  const db = await getDb();
  const now = new Date();
  await db.transaction(async (tx) => {
    // Only finish a reservation that is still ours. If the lease was lost and the cleanup
    // retry flow took the row over, that flow finishes the project, not this request.
    const mine = await tx.update(schema.cleanupJobs)
      .set({ state: "done", step: "complete", finishedAt: now, leaseOwner: null, leaseUntil: null, updatedAt: now })
      .where(and(eq(schema.cleanupJobs.id, reservation.jobId), eq(schema.cleanupJobs.leaseOwner, reservation.owner)))
      .returning({ id: schema.cleanupJobs.id });
    if (mine.length === 0) {
      throw new HttpError(409, "The app was removed from your container, but cleanup took over before the records were deleted. Open the project's settings to finish it.", "cleanup_in_progress");
    }
    await tx.update(schema.cleanupItems)
      .set({ state: "done", step: "remote_complete", error: null, updatedAt: now })
      .where(eq(schema.cleanupItems.cleanupJobId, reservation.jobId));
    await moveProjectToTrash(tx, userId, project);
  });
  await audit(userId, "project.delete", null, { name: project.name });
}

function isUnique(err: unknown) {
  return err instanceof Error && /UNIQUE constraint failed/.test(err.message);
}
