import { and, desc, eq, inArray, isNull, lt } from "drizzle-orm";
import { audit } from "@/server/audit";
import { assertCleanupAllowsWork } from "@/server/cleanup-guards";
import { isUniqueViolation } from "@/server/db/errors";
import { getDb, schema } from "@/server/db";
import { HttpError } from "@/server/http";
import { assertDeletable, assertOwned, assertProjectIdle, type ProjectRow } from "@/server/projects";
import { forgetDeliveriesForDeployments } from "@/server/webhooks";

/** A deleted app stays restorable for this long, then the cleanup job removes it for good. */
export const TRASH_KEEP_MS = 30 * 86_400_000;

type Tx = Parameters<Parameters<Awaited<ReturnType<typeof getDb>>["transaction"]>[0]>[0];
type Row = Record<string, unknown>;

/**
 * What a deleted app is restored from: its own row and the rows that cascade from
 * it. Sealed fields stay sealed, and the ids are kept so the rows point back at
 * the same project. Scheduled jobs, deployment history and env vars are kept;
 * analytics, samples, alert history and deployment logs are not.
 */
export type TrashSnapshot = {
  project: Row;
  envVars: Row[];
  deployments: Row[];
  scheduledJobs: Row[];
  /** Domains that pointed at the app. They are kept by the database and re-linked on restore. */
  domainIds: string[];
};

const DATE_KEY = "__date";

/** JSON cannot hold Dates, so each one is written as a tagged millisecond value. */
function pack(row: Record<string, unknown>): Row {
  return Object.fromEntries(
    Object.entries(row).map(([k, v]) => [k, v instanceof Date ? { [DATE_KEY]: v.getTime() } : v])
  );
}

function unpack(row: Row): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(row).map(([k, v]) => [
      k,
      v !== null && typeof v === "object" && DATE_KEY in v ? new Date((v as Record<string, number>)[DATE_KEY]) : v,
    ])
  );
}

export function encodeSnapshot(snapshot: TrashSnapshot): string {
  return JSON.stringify(snapshot);
}

export function decodeSnapshot(text: string): TrashSnapshot {
  return JSON.parse(text) as TrashSnapshot;
}


/**
 * Move a project out of the live tables and into the trash, inside the caller's
 * transaction. Deleting the project row cascades to its deployments and env vars,
 * so the snapshot is taken first.
 */
export async function moveProjectToTrash(tx: Tx, userId: string, project: ProjectRow, now = new Date()) {
  const deployments = await tx.select().from(schema.deployments).where(eq(schema.deployments.projectId, project.id));
  const envVars = await tx.select().from(schema.envVars).where(eq(schema.envVars.projectId, project.id));
  const scheduledJobs = await tx.select().from(schema.scheduledJobs).where(eq(schema.scheduledJobs.projectId, project.id));
  const domains = await tx
    .select({ id: schema.domains.id })
    .from(schema.domains)
    .where(eq(schema.domains.projectId, project.id));
  const snapshot: TrashSnapshot = {
    project: pack(project),
    envVars: envVars.map(pack),
    deployments: deployments.map(pack),
    scheduledJobs: scheduledJobs.map(pack),
    domainIds: domains.map((d) => d.id),
  };
  await tx.insert(schema.projectTrash).values({
    projectId: project.id,
    userId,
    name: project.name,
    slug: project.slug,
    serverId: project.serverId,
    payload: encodeSnapshot(snapshot),
    deletedAt: now,
    purgeAt: new Date(now.getTime() + TRASH_KEEP_MS),
  });
  await tx.delete(schema.projects).where(eq(schema.projects.id, project.id));
  // The cascade removes the deployments; their delivery history survives by
  // design, so the links that would now point at nothing are forgotten here.
  await forgetDeliveriesForDeployments(tx, deployments.map((d) => d.id));
}

/** Delete an app by moving it to the trash. Refused while protected or while work is running. */
export async function trashProject(userId: string, projectId: string, now = new Date()) {
  const project = await assertOwned(userId, projectId);
  const db = await getDb();
  await db.transaction(async (tx) => {
    const current = await tx.select().from(schema.projects).where(eq(schema.projects.id, projectId)).get();
    if (!current) throw new HttpError(404, "Project not found", "not_found");
    assertDeletable(current);
    await assertCleanupAllowsWork(tx, userId, projectId);
    await assertProjectIdle(tx, projectId);
    await moveProjectToTrash(tx, userId, current, now);
  });
  await audit(userId, "project.delete", null, { name: project.name });
}

export type TrashedProjectView = {
  projectId: string;
  name: string;
  slug: string;
  serverId: string;
  deletedAt: Date;
  purgeAt: Date;
};

/** The owner's trashed apps, most recently deleted first. */
export async function listTrashedProjects(userId: string): Promise<TrashedProjectView[]> {
  const db = await getDb();
  return db
    .select({
      projectId: schema.projectTrash.projectId,
      name: schema.projectTrash.name,
      slug: schema.projectTrash.slug,
      serverId: schema.projectTrash.serverId,
      deletedAt: schema.projectTrash.deletedAt,
      purgeAt: schema.projectTrash.purgeAt,
    })
    .from(schema.projectTrash)
    .where(eq(schema.projectTrash.userId, userId))
    .orderBy(desc(schema.projectTrash.deletedAt));
}


/**
 * Put a trashed app back with its rows. A name, port, webhook or domain that
 * another app has taken since then is refused, so nothing is overwritten.
 * Records come back, but the service on the server does not: an app removed
 * from the server must be deployed again.
 */
export async function restoreTrashedProject(userId: string, projectId: string): Promise<ProjectRow> {
  const db = await getDb();
  const trashed = await db
    .select()
    .from(schema.projectTrash)
    .where(and(eq(schema.projectTrash.projectId, projectId), eq(schema.projectTrash.userId, userId)))
    .get();
  if (!trashed) throw new HttpError(404, "Trashed project not found", "not_found");
  const server = await db
    .select({ id: schema.servers.id })
    .from(schema.servers)
    .where(eq(schema.servers.id, trashed.serverId))
    .get();
  if (!server) throw new HttpError(409, "The server this app ran on has been removed, so the app cannot be restored.", "conflict");

  const snapshot = decodeSnapshot(trashed.payload);
  const project = unpack(snapshot.project) as ProjectRow;
  try {
    await db.transaction(async (tx) => {
      await tx.insert(schema.projects).values(project as typeof schema.projects.$inferInsert);
      if (snapshot.deployments.length) {
        await tx.insert(schema.deployments).values(snapshot.deployments.map((r) => unpack(r) as typeof schema.deployments.$inferInsert));
      }
      if (snapshot.envVars.length) {
        await tx.insert(schema.envVars).values(snapshot.envVars.map((r) => unpack(r) as typeof schema.envVars.$inferInsert));
      }
      if (snapshot.scheduledJobs.length) {
        await tx.insert(schema.scheduledJobs).values(snapshot.scheduledJobs.map((r) => unpack(r) as typeof schema.scheduledJobs.$inferInsert));
      }
      if (snapshot.domainIds.length) {
        await tx
          .update(schema.domains)
          .set({ projectId: project.id })
          .where(and(inArray(schema.domains.id, snapshot.domainIds), isNull(schema.domains.projectId)));
      }
      await tx.delete(schema.projectTrash).where(eq(schema.projectTrash.projectId, projectId));
    });
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new HttpError(
        409,
        "Another app on this server now uses this name, port, webhook or domain. Rename or change it, then restore.",
        "conflict"
      );
    }
    throw err;
  }
  await audit(userId, "project.restore", project.id, { name: project.name });
  return project;
}

/**
 * The cleanup job's hard delete: trash rows past their 30 days are removed for
 * good. Nothing else removes a project's stored records. Returns how many were purged.
 */
export async function purgeExpiredTrash(now = new Date(), limit = 100): Promise<number> {
  const db = await getDb();
  const due = await db
    .select({ projectId: schema.projectTrash.projectId, userId: schema.projectTrash.userId, name: schema.projectTrash.name })
    .from(schema.projectTrash)
    .where(lt(schema.projectTrash.purgeAt, now))
    .limit(limit);
  for (const row of due) {
    await db.delete(schema.projectTrash).where(eq(schema.projectTrash.projectId, row.projectId));
    await audit(row.userId, "project.purge", null, { name: row.name });
  }
  return due.length;
}
