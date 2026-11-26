import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { assertProjectAccess } from "@/server/permissions";
import { newId } from "@/server/crypto";
import { getDb, schema } from "@/server/db";
import { HttpError, notFound } from "@/server/http";

export const createWorkspaceInput = z.object({
  projectId: z.string().min(1).max(100),
  title: z.string().trim().min(3).max(120),
  goal: z.string().trim().min(1).max(4000),
  branch: z.string().trim().max(255).optional().transform((value) => value || null),
});

export const updateWorkspaceInput = z.object({
  title: z.string().trim().min(3).max(120).optional(),
  goal: z.string().trim().min(1).max(4000).optional(),
  branch: z.string().trim().max(255).nullable().optional(),
  status: z.enum(schema.GRAFT_GREENHOUSE_STATUSES).optional(),
}).strict().refine((input) => Object.keys(input).length > 0, "Choose at least one workspace field to update.");

export const createWorkspaceNoteInput = z.object({ body: z.string().trim().min(1).max(8000) });

export type GreenhouseWorkspaceView = {
  id: string;
  userId: string;
  owner: string;
  projectId: string;
  projectName: string;
  projectSlug: string;
  title: string;
  goal: string;
  branch: string | null;
  status: (typeof schema.GRAFT_GREENHOUSE_STATUSES)[number];
  createdAt: string;
  updatedAt: string;
};

export type GreenhouseNoteView = {
  id: string;
  workspaceId: string;
  authorId: string;
  author: string;
  body: string;
  createdAt: string;
};

export type GreenhouseProjectOption = { id: string; name: string; slug: string };

export type GreenhouseAdminWorkspaceView = {
  id: string;
  owner: string;
  projectName: string;
  projectSlug: string;
  title: string;
  status: GreenhouseWorkspaceView["status"];
  updatedAt: string;
};

const workspaceProjection = {
  id: schema.graftGreenhouseWorkspaces.id,
  userId: schema.graftGreenhouseWorkspaces.userId,
  owner: schema.users.name,
  projectId: schema.graftGreenhouseWorkspaces.projectId,
  projectName: schema.projects.name,
  projectSlug: schema.projects.slug,
  title: schema.graftGreenhouseWorkspaces.title,
  goal: schema.graftGreenhouseWorkspaces.goal,
  branch: schema.graftGreenhouseWorkspaces.branch,
  status: schema.graftGreenhouseWorkspaces.status,
  createdAt: schema.graftGreenhouseWorkspaces.createdAt,
  updatedAt: schema.graftGreenhouseWorkspaces.updatedAt,
};

function toWorkspaceView(row: {
  id: string; userId: string; owner: string; projectId: string; projectName: string;
  projectSlug: string; title: string; goal: string; branch: string | null;
  status: GreenhouseWorkspaceView["status"]; createdAt: Date; updatedAt: Date;
}): GreenhouseWorkspaceView {
  return { ...row, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() };
}

export async function listUserWorkspaces(userId: string): Promise<GreenhouseWorkspaceView[]> {
  const db = await getDb();
  const rows = await db
    .select(workspaceProjection)
    .from(schema.graftGreenhouseWorkspaces)
    .innerJoin(schema.users, eq(schema.users.id, schema.graftGreenhouseWorkspaces.userId))
    .innerJoin(schema.projects, eq(schema.projects.id, schema.graftGreenhouseWorkspaces.projectId))
    .where(eq(schema.graftGreenhouseWorkspaces.userId, userId))
    .orderBy(desc(schema.graftGreenhouseWorkspaces.updatedAt))
    .limit(100);
  return rows.map(toWorkspaceView);
}

/** Select only the project fields needed by the workspace picker. */
export async function listWorkspaceProjects(userId: string): Promise<GreenhouseProjectOption[]> {
  const db = await getDb();
  return db
    .select({ id: schema.projects.id, name: schema.projects.name, slug: schema.projects.slug })
    .from(schema.projects)
    .where(eq(schema.projects.userId, userId))
    .orderBy(schema.projects.name)
    .limit(200);
}

export async function listAdminWorkspaces(): Promise<GreenhouseAdminWorkspaceView[]> {
  const db = await getDb();
  const rows = await db
    .select({
      id: schema.graftGreenhouseWorkspaces.id,
      owner: schema.users.name,
      projectName: schema.projects.name,
      projectSlug: schema.projects.slug,
      title: schema.graftGreenhouseWorkspaces.title,
      status: schema.graftGreenhouseWorkspaces.status,
      updatedAt: schema.graftGreenhouseWorkspaces.updatedAt,
    })
    .from(schema.graftGreenhouseWorkspaces)
    .innerJoin(schema.users, eq(schema.users.id, schema.graftGreenhouseWorkspaces.userId))
    .innerJoin(schema.projects, eq(schema.projects.id, schema.graftGreenhouseWorkspaces.projectId))
    .orderBy(desc(schema.graftGreenhouseWorkspaces.updatedAt))
    .limit(250);
  return rows.map((row) => ({ ...row, updatedAt: row.updatedAt.toISOString() }));
}

async function findWorkspace(id: string) {
  const db = await getDb();
  const row = await db
    .select(workspaceProjection)
    .from(schema.graftGreenhouseWorkspaces)
    .innerJoin(schema.users, eq(schema.users.id, schema.graftGreenhouseWorkspaces.userId))
    .innerJoin(schema.projects, eq(schema.projects.id, schema.graftGreenhouseWorkspaces.projectId))
    .where(eq(schema.graftGreenhouseWorkspaces.id, id))
    .get();
  if (!row) throw notFound("Greenhouse workspace not found.");
  return toWorkspaceView(row);
}

async function requireWorkspaceOwner(userId: string, workspaceId: string) {
  const db = await getDb();
  const row = await db
    .select({ id: schema.graftGreenhouseWorkspaces.id, projectId: schema.graftGreenhouseWorkspaces.projectId })
    .from(schema.graftGreenhouseWorkspaces)
    .where(and(eq(schema.graftGreenhouseWorkspaces.id, workspaceId), eq(schema.graftGreenhouseWorkspaces.userId, userId)))
    .get();
  if (!row) throw notFound("Greenhouse workspace not found.");
  return row;
}

export async function createWorkspace(userId: string, raw: unknown): Promise<string> {
  const input = createWorkspaceInput.parse(raw);
  await assertProjectAccess(userId, input.projectId, "edit");
  const db = await getDb();
  const now = new Date();
  const id = newId();
  await db.insert(schema.graftGreenhouseWorkspaces).values({
    id,
    userId,
    projectId: input.projectId,
    title: input.title,
    goal: input.goal,
    branch: input.branch,
    createdAt: now,
    updatedAt: now,
  });
  return id;
}

export async function getWorkspace(userId: string, workspaceId: string, admin = false) {
  const workspace = await findWorkspace(workspaceId);
  if (!admin && workspace.userId !== userId) throw notFound("Greenhouse workspace not found.");
  if (!admin) await assertProjectAccess(userId, workspace.projectId, "view");
  const notes = await listWorkspaceNotes(workspaceId);
  return { workspace, notes };
}

export async function updateWorkspace(userId: string, workspaceId: string, raw: unknown): Promise<void> {
  const input = updateWorkspaceInput.parse(raw);
  const workspace = await requireWorkspaceOwner(userId, workspaceId);
  await assertProjectAccess(userId, workspace.projectId, "edit");
  const db = await getDb();
  await db.update(schema.graftGreenhouseWorkspaces)
    .set({ ...input, updatedAt: new Date() })
    .where(eq(schema.graftGreenhouseWorkspaces.id, workspaceId));
}

export async function listWorkspaceNotes(workspaceId: string): Promise<GreenhouseNoteView[]> {
  const db = await getDb();
  const rows = await db
    .select({
      id: schema.graftGreenhouseNotes.id,
      workspaceId: schema.graftGreenhouseNotes.workspaceId,
      authorId: schema.graftGreenhouseNotes.authorId,
      author: schema.users.name,
      body: schema.graftGreenhouseNotes.body,
      createdAt: schema.graftGreenhouseNotes.createdAt,
    })
    .from(schema.graftGreenhouseNotes)
    .innerJoin(schema.users, eq(schema.users.id, schema.graftGreenhouseNotes.authorId))
    .where(eq(schema.graftGreenhouseNotes.workspaceId, workspaceId))
    .orderBy(schema.graftGreenhouseNotes.createdAt)
    .limit(300);
  return rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() }));
}

export async function createWorkspaceNote(userId: string, workspaceId: string, raw: unknown): Promise<void> {
  const { body } = createWorkspaceNoteInput.parse(raw);
  const workspace = await requireWorkspaceOwner(userId, workspaceId);
  await assertProjectAccess(userId, workspace.projectId, "edit");
  const db = await getDb();
  const now = new Date();
  await db.insert(schema.graftGreenhouseNotes).values({ id: newId(), workspaceId, authorId: userId, body, createdAt: now });
  await db.update(schema.graftGreenhouseWorkspaces).set({ updatedAt: now })
    .where(eq(schema.graftGreenhouseWorkspaces.id, workspaceId));
}

export async function deleteWorkspace(workspaceId: string, actorId: string, admin: boolean): Promise<void> {
  const db = await getDb();
  const row = await db
    .select({ userId: schema.graftGreenhouseWorkspaces.userId, projectId: schema.graftGreenhouseWorkspaces.projectId })
    .from(schema.graftGreenhouseWorkspaces)
    .where(eq(schema.graftGreenhouseWorkspaces.id, workspaceId))
    .get();
  if (!row) throw notFound("Greenhouse workspace not found.");
  if (!admin && row.userId !== actorId) throw new HttpError(403, "You can remove only your own workspace.", "forbidden");
  if (!admin) await assertProjectAccess(actorId, row.projectId, "edit");
  await db.delete(schema.graftGreenhouseWorkspaces).where(eq(schema.graftGreenhouseWorkspaces.id, workspaceId));
}
