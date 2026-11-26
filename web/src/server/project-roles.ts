import { eq } from "drizzle-orm";
import { getDb, schema } from "@/server/db";
import { notFound } from "@/server/http";

/**
 * Owner-only project access. Projects used to support invited members with
 * viewer/developer roles; that collaboration feature has been removed. These
 * helpers are kept as the single authorization boundary so every caller fails
 * closed with the same "Project not found" response for a non-owner.
 */
export type ProjectRole = "owner";

/** A correlated predicate for queries already joined to projects. */
export function projectReadableBy(userId: string) {
  return eq(schema.projects.userId, userId);
}

export async function getProjectRole(userId: string, projectId: string): Promise<ProjectRole | null> {
  const db = await getDb();
  const project = await db.select({ owner: schema.projects.userId }).from(schema.projects).where(eq(schema.projects.id, projectId)).get();
  return project?.owner === userId ? "owner" : null;
}

export async function requireProjectRole(userId: string, projectId: string, minimum: ProjectRole = "owner") {
  // A caller asking for anything less than owner is a programming error; fail
  // closed rather than granting access.
  if (minimum !== "owner" || (await getProjectRole(userId, projectId)) !== "owner") throw notFound("Project not found");
  return "owner" as const;
}
