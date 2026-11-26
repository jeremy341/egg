import { and, desc, eq, gt, isNull, or } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/server/db";
import { newId } from "@/server/crypto";
import { notFound } from "@/server/http";

const titleInput = z.string().trim().min(1).max(120);
const bodyInput = z.string().trim().min(1).max(8000);

export const createAnnouncementInput = z.object({ title: titleInput, body: bodyInput });
export const updateAnnouncementInput = z.object({
  title: titleInput.optional(),
  body: bodyInput.optional(),
  status: z.enum(["draft", "published"]).optional(),
  pinned: z.boolean().optional(),
  expiresAt: z.string().datetime().nullable().optional(),
}).strict().refine((input) => Object.keys(input).length > 0, "Choose at least one field to update.");

export type AnnouncementView = {
  id: string;
  title: string;
  body: string;
  status: "draft" | "published";
  pinned: boolean;
  publishedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
  author: string;
  dismissedAt?: string | null;
};

function toIso(value: Date | null) {
  return value?.toISOString() ?? null;
}

/** The published feed is scoped to the signed-in user so dismissals stay private. */
export async function listActiveAnnouncements(userId: string, options: { undismissedOnly?: boolean } = {}) {
  const db = await getDb();
  const filters = [
    eq(schema.graftAnnouncements.status, "published"),
    or(isNull(schema.graftAnnouncements.expiresAt), gt(schema.graftAnnouncements.expiresAt, new Date())),
  ];
  if (options.undismissedOnly) filters.push(isNull(schema.graftAnnouncementDismissals.dismissedAt));
  const rows = await db
    .select({
      id: schema.graftAnnouncements.id,
      title: schema.graftAnnouncements.title,
      body: schema.graftAnnouncements.body,
      status: schema.graftAnnouncements.status,
      pinned: schema.graftAnnouncements.pinned,
      publishedAt: schema.graftAnnouncements.publishedAt,
      expiresAt: schema.graftAnnouncements.expiresAt,
      createdAt: schema.graftAnnouncements.createdAt,
      updatedAt: schema.graftAnnouncements.updatedAt,
      author: schema.users.name,
      dismissedAt: schema.graftAnnouncementDismissals.dismissedAt,
    })
    .from(schema.graftAnnouncements)
    .innerJoin(schema.users, eq(schema.users.id, schema.graftAnnouncements.createdBy))
    .leftJoin(
      schema.graftAnnouncementDismissals,
      and(
        eq(schema.graftAnnouncementDismissals.announcementId, schema.graftAnnouncements.id),
        eq(schema.graftAnnouncementDismissals.userId, userId)
      )
    )
    .where(and(...filters))
    .orderBy(desc(schema.graftAnnouncements.pinned), desc(schema.graftAnnouncements.publishedAt))
    .limit(30);
  return rows.map((row): AnnouncementView => ({
    ...row,
    publishedAt: toIso(row.publishedAt),
    expiresAt: toIso(row.expiresAt),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    dismissedAt: toIso(row.dismissedAt),
  }));
}

export async function listManagedAnnouncements(): Promise<AnnouncementView[]> {
  const db = await getDb();
  const rows = await db
    .select({
      id: schema.graftAnnouncements.id,
      title: schema.graftAnnouncements.title,
      body: schema.graftAnnouncements.body,
      status: schema.graftAnnouncements.status,
      pinned: schema.graftAnnouncements.pinned,
      publishedAt: schema.graftAnnouncements.publishedAt,
      expiresAt: schema.graftAnnouncements.expiresAt,
      createdAt: schema.graftAnnouncements.createdAt,
      updatedAt: schema.graftAnnouncements.updatedAt,
      author: schema.users.name,
    })
    .from(schema.graftAnnouncements)
    .innerJoin(schema.users, eq(schema.users.id, schema.graftAnnouncements.createdBy))
    .orderBy(desc(schema.graftAnnouncements.updatedAt))
    .limit(100);
  return rows.map((row) => ({
    ...row,
    publishedAt: toIso(row.publishedAt),
    expiresAt: toIso(row.expiresAt),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }));
}

export async function createAnnouncement(actorId: string, raw: unknown): Promise<void> {
  const input = createAnnouncementInput.parse(raw);
  const db = await getDb();
  const now = new Date();
  await db.insert(schema.graftAnnouncements).values({
    id: newId(),
    ...input,
    createdBy: actorId,
    createdAt: now,
    updatedAt: now,
  });
}

export async function updateAnnouncement(id: string, raw: unknown): Promise<void> {
  const input = updateAnnouncementInput.parse(raw);
  const db = await getDb();
  const current = await db
    .select({ id: schema.graftAnnouncements.id, status: schema.graftAnnouncements.status })
    .from(schema.graftAnnouncements)
    .where(eq(schema.graftAnnouncements.id, id))
    .get();
  if (!current) throw notFound("Announcement not found.");

  const values: Partial<typeof schema.graftAnnouncements.$inferInsert> = {
    updatedAt: new Date(),
  };
  if (input.title !== undefined) values.title = input.title;
  if (input.body !== undefined) values.body = input.body;
  if (input.pinned !== undefined) values.pinned = input.pinned;
  if (input.expiresAt !== undefined) values.expiresAt = input.expiresAt ? new Date(input.expiresAt) : null;
  if (input.status !== undefined) {
    values.status = input.status;
    if (input.status !== current.status) values.publishedAt = input.status === "published" ? new Date() : null;
  }
  await db.update(schema.graftAnnouncements).set(values).where(eq(schema.graftAnnouncements.id, id));
}

export async function deleteAnnouncement(id: string): Promise<void> {
  const db = await getDb();
  const removed = await db
    .delete(schema.graftAnnouncements)
    .where(eq(schema.graftAnnouncements.id, id))
    .returning({ id: schema.graftAnnouncements.id });
  if (removed.length === 0) throw notFound("Announcement not found.");
}

export async function dismissAnnouncement(userId: string, announcementId: string): Promise<void> {
  const db = await getDb();
  const announcement = await db
    .select({ id: schema.graftAnnouncements.id })
    .from(schema.graftAnnouncements)
    .where(and(
      eq(schema.graftAnnouncements.id, announcementId),
      eq(schema.graftAnnouncements.status, "published"),
      or(isNull(schema.graftAnnouncements.expiresAt), gt(schema.graftAnnouncements.expiresAt, new Date()))
    ))
    .get();
  if (!announcement) throw notFound("Announcement not found.");
  await db.insert(schema.graftAnnouncementDismissals).values({
    announcementId,
    userId,
    dismissedAt: new Date(),
  }).onConflictDoNothing();
}

