import { and, desc, eq, isNotNull } from "drizzle-orm";
import { getDb, schema } from "@/server/db";
import { getReadableProject } from "@/server/projects";

export type LastCrash = {
  /** When the monitor recorded the crash (epoch ms). */
  at: number;
  /** The exit status of the service's main process, or null when systemd had none. */
  exitCode: number | null;
  /** systemd's reason, for example exit-code, signal or oom-kill. */
  reason: string;
  restarts: number | null;
};

/**
 * The most recent non-clean exit the monitor recorded for a project. Only the
 * status and reason are kept: the program's output is not stored, so this is
 * what can be said about the crash before the one in the journal.
 */
export async function lastCrash(userId: string, projectId: string): Promise<LastCrash | null> {
  const project = await getReadableProject(userId, projectId);
  const db = await getDb();
  const row = await db
    .select()
    .from(schema.projectSamples)
    .where(and(eq(schema.projectSamples.projectId, project.id), isNotNull(schema.projectSamples.exitReason)))
    .orderBy(desc(schema.projectSamples.at))
    .limit(1)
    .get();
  if (!row || !row.exitReason) return null;
  return { at: row.at.getTime(), exitCode: row.exitCode, reason: row.exitReason, restarts: row.restarts };
}
