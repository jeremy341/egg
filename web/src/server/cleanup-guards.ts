import { and, eq, inArray, sql } from "drizzle-orm";
import { getDb, schema, type Db } from "@/server/db";
import { HttpError } from "@/server/http";

const BLOCKING_STATES = ["draining", "running", "failed"] as const;
type QueryDb = Db | Parameters<Parameters<Db["transaction"]>[0]>[0];

/** Call inside the transaction that writes project or account work. */
export async function assertCleanupAllowsWork(db: QueryDb, userId: string, projectId?: string) {
  const rows = await db.select({ scope: schema.cleanupJobs.scope, projectId: schema.cleanupJobs.projectId })
    .from(schema.cleanupJobs).where(and(eq(schema.cleanupJobs.userId, userId), inArray(schema.cleanupJobs.state, BLOCKING_STATES)));
  if (rows.some((row) => row.scope === "account" || (projectId && row.projectId === projectId))) {
    throw new HttpError(409, "Cleanup is in progress. New work is paused until cleanup completes or is canceled.", "cleanup_in_progress");
  }
}

export async function accountCleanupActive(userId: string) {
  const db = await getDb();
  return Boolean(
    await db
      .select({ id: schema.cleanupJobs.id })
      .from(schema.cleanupJobs)
      .where(
        and(
          eq(schema.cleanupJobs.userId, userId),
          eq(schema.cleanupJobs.scope, "account"),
          inArray(schema.cleanupJobs.state, BLOCKING_STATES)
        )
      )
      .get()
  );
}

export async function assertNoAccountCleanup(userId: string) {
  if (await accountCleanupActive(userId)) {
    throw new HttpError(409, "Account cleanup is in progress. Wait for it to finish or retry it before making changes.", "cleanup_in_progress");
  }
}

export async function assertNoCleanupDeletion(userId: string) {
  const db = await getDb();
  const active = await db.select({ id: schema.cleanupJobs.id }).from(schema.cleanupJobs)
    .where(and(eq(schema.cleanupJobs.userId, userId), inArray(schema.cleanupJobs.state, BLOCKING_STATES))).get();
  if (active) throw new HttpError(409, "Finish the pending cleanup before deleting account records.", "cleanup_in_progress");
}

export async function assertNoProjectCleanup(userId: string, projectId: string) {
  const db = await getDb();
  const active = await db
    .select({ id: schema.cleanupJobs.id })
    .from(schema.cleanupJobs)
    .leftJoin(schema.cleanupItems, eq(schema.cleanupItems.cleanupJobId, schema.cleanupJobs.id))
    .where(
      and(
        eq(schema.cleanupJobs.userId, userId),
        inArray(schema.cleanupJobs.state, BLOCKING_STATES),
        // Account jobs have a target row for every project. The scope check also
        // blocks a project being added while an account job is draining.
        inArray(schema.cleanupJobs.scope, ["account", "project"]),
        eq(schema.cleanupItems.projectId, projectId)
      )
    )
    .get();
  const account = await accountCleanupActive(userId);
  if (active || account) {
    throw new HttpError(409, "Cleanup is in progress for this project. Wait for it to finish or retry it before making changes.", "cleanup_in_progress");
  }
}

export async function assertNoServerCleanup(userId: string, serverId: string, allowFailed = false) {
  if (allowFailed) {
    const db = await getDb();
    const active = await db.select({ id: schema.cleanupJobs.id }).from(schema.cleanupJobs)
      .leftJoin(schema.cleanupItems, eq(schema.cleanupItems.cleanupJobId, schema.cleanupJobs.id))
      .where(and(eq(schema.cleanupJobs.userId, userId), inArray(schema.cleanupJobs.state, ["draining", "running"]),
        sql`(${schema.cleanupJobs.scope} = 'account' or ${schema.cleanupItems.serverId} = ${serverId})`)).get();
    if (active) throw new HttpError(409, "Cleanup is active. Wait for it to stop before repairing this connection.", "cleanup_in_progress");
    return;
  }
  if (await accountCleanupActive(userId)) {
    throw new HttpError(409, "Account cleanup is in progress. Remote access is temporarily paused.", "cleanup_in_progress");
  }
  const db = await getDb();
  const active = await db
    .select({ id: schema.cleanupJobs.id })
    .from(schema.cleanupJobs)
    .innerJoin(schema.cleanupItems, eq(schema.cleanupItems.cleanupJobId, schema.cleanupJobs.id))
    .where(
      and(
        eq(schema.cleanupJobs.userId, userId),
        eq(schema.cleanupItems.serverId, serverId),
        inArray(schema.cleanupJobs.state, BLOCKING_STATES)
      )
    )
    .get();
  if (active) {
    throw new HttpError(409, "Cleanup is in progress for this server. Remote access is temporarily paused.", "cleanup_in_progress");
  }
}

export const cleanupBlockingStates = BLOCKING_STATES;
