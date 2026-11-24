import { eq } from "drizzle-orm";
import { z } from "zod";
import { audit } from "@/server/audit";
import { getDb, schema } from "@/server/db";
import { HttpError } from "@/server/http";
import { getProjectForUser, getReadableProject } from "@/server/projects";

/**
 * Which statistics a project shows. Every switch starts off, and only the owner
 * can change them. A project without a row has everything off.
 */
export type StatisticsSwitches = {
  deployCount: boolean;
  deploySuccess: boolean;
  buildTime: boolean;
  visitors: boolean;
};

export const NO_STATISTICS: StatisticsSwitches = {
  deployCount: false,
  deploySuccess: false,
  buildTime: false,
  visitors: false,
};

export const STATISTICS_KEYS = Object.keys(NO_STATISTICS) as (keyof StatisticsSwitches)[];

export const statisticsPatch = z
  .object({
    deployCount: z.boolean().optional(),
    deploySuccess: z.boolean().optional(),
    buildTime: z.boolean().optional(),
    visitors: z.boolean().optional(),
  })
  .strict();
export type StatisticsPatch = z.input<typeof statisticsPatch>;

type Row = typeof schema.projectStatistics.$inferSelect;

function fromRow(row: Pick<Row, keyof StatisticsSwitches> | undefined): StatisticsSwitches {
  if (!row) return { ...NO_STATISTICS };
  return {
    deployCount: row.deployCount === true,
    deploySuccess: row.deploySuccess === true,
    buildTime: row.buildTime === true,
    visitors: row.visitors === true,
  };
}

/** The switches for a project. No permission check: for internal callers that already have one. */
export async function getStatistics(projectId: string): Promise<StatisticsSwitches> {
  const db = await getDb();
  const row = await db
    .select()
    .from(schema.projectStatistics)
    .where(eq(schema.projectStatistics.projectId, projectId))
    .get();
  return fromRow(row);
}

/** The switches for a project the person can read (the owner). */
export async function getStatisticsForUser(userId: string, projectId: string): Promise<StatisticsSwitches> {
  const project = await getReadableProject(userId, projectId);
  return getStatistics(project.id);
}

/** Change some switches. Anything left out keeps its value. Owner only. */
export async function updateStatistics(
  userId: string,
  projectId: string,
  raw: StatisticsPatch
): Promise<StatisticsSwitches> {
  const parsed = statisticsPatch.safeParse(raw);
  if (!parsed.success) {
    throw new HttpError(400, parsed.error.issues[0]?.message ?? "Invalid statistics settings", "validation");
  }
  const patch = parsed.data;
  const project = await getProjectForUser(userId, projectId);
  const db = await getDb();
  const current = await getStatistics(project.id);
  const next: StatisticsSwitches = { ...current };
  for (const key of STATISTICS_KEYS) {
    if (patch[key] !== undefined) next[key] = patch[key];
  }
  const values = { ...next, updatedAt: new Date() };
  await db
    .insert(schema.projectStatistics)
    .values({ projectId: project.id, ...values })
    .onConflictDoUpdate({ target: schema.projectStatistics.projectId, set: values });
  const changed = STATISTICS_KEYS.filter((key) => current[key] !== next[key]);
  if (changed.length) await audit(userId, "statistics.settings", project.id, { changed: changed.join(",") });
  return next;
}
