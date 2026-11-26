import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { newId } from "@/server/crypto";
import { getDb, schema } from "@/server/db";
import { HttpError, notFound } from "@/server/http";

export const FORUM_CATEGORIES = [
  { id: "bug", label: "Bug report" },
  { id: "feature", label: "Feature idea" },
  { id: "question", label: "Question" },
  { id: "discussion", label: "Discussion" },
] as const;

export type ForumCategory = (typeof FORUM_CATEGORIES)[number]["id"];
export const createThreadInput = z.object({
  category: z.enum(schema.GRAFT_FORUM_CATEGORIES),
  title: z.string().trim().min(4).max(140),
  body: z.string().trim().min(1).max(12000),
});
export const createReplyInput = z.object({ body: z.string().trim().min(1).max(8000) });
export const moderateThreadInput = z.object({
  status: z.enum(schema.GRAFT_FORUM_STATUSES).optional(),
  priority: z.enum(schema.GRAFT_FORUM_PRIORITIES).optional(),
  pinned: z.boolean().optional(),
  locked: z.boolean().optional(),
}).strict().refine((input) => Object.keys(input).length > 0, "Choose a moderation change.");

export type ForumThreadView = {
  id: string;
  category: ForumCategory;
  title: string;
  body: string;
  status: (typeof schema.GRAFT_FORUM_STATUSES)[number];
  priority: (typeof schema.GRAFT_FORUM_PRIORITIES)[number];
  pinned: boolean;
  locked: boolean;
  authorId: string;
  author: string;
  createdAt: string;
  updatedAt: string;
  replyCount: number;
  voteCount: number;
  hasVoted: boolean;
};

export type ForumReplyView = {
  id: string;
  threadId: string;
  authorId: string;
  author: string;
  body: string;
  createdAt: string;
};

const threadProjection = {
  id: schema.graftForumThreads.id,
  category: schema.graftForumThreads.category,
  title: schema.graftForumThreads.title,
  body: schema.graftForumThreads.body,
  status: schema.graftForumThreads.status,
  priority: schema.graftForumThreads.priority,
  pinned: schema.graftForumThreads.pinned,
  locked: schema.graftForumThreads.locked,
  authorId: schema.graftForumThreads.authorId,
  author: schema.users.name,
  createdAt: schema.graftForumThreads.createdAt,
  updatedAt: schema.graftForumThreads.updatedAt,
  replyCount: sql<number>`(select count(*) from graft_forum_replies r where r.thread_id = ${schema.graftForumThreads.id})`,
  voteCount: sql<number>`(select count(*) from graft_forum_votes v where v.thread_id = ${schema.graftForumThreads.id})`,
};

function toThreadView(value: {
  id: string; category: ForumCategory; title: string; body: string;
  status: ForumThreadView["status"]; priority: ForumThreadView["priority"];
  pinned: boolean; locked: boolean; authorId: string; author: string;
  createdAt: Date; updatedAt: Date; replyCount: number; voteCount: number;
}): ForumThreadView {
  return {
    ...value,
    createdAt: value.createdAt.toISOString(),
    updatedAt: value.updatedAt.toISOString(),
    replyCount: Number(value.replyCount),
    voteCount: Number(value.voteCount),
    hasVoted: false,
  };
}

export async function listForumThreads(userId: string): Promise<ForumThreadView[]> {
  const db = await getDb();
  const rows = await db
    .select(threadProjection)
    .from(schema.graftForumThreads)
    .innerJoin(schema.users, eq(schema.users.id, schema.graftForumThreads.authorId))
    .orderBy(desc(schema.graftForumThreads.pinned), desc(schema.graftForumThreads.updatedAt))
    .limit(100);
  // The user id is projected separately to keep the query correlated to the signed-in viewer.
  if (rows.length === 0) return [];
  const voted = new Set((await db
    .select({ threadId: schema.graftForumVotes.threadId })
    .from(schema.graftForumVotes)
    .where(eq(schema.graftForumVotes.userId, userId))).map((row) => row.threadId));
  return rows.map((row) => ({ ...toThreadView(row), hasVoted: voted.has(row.id) }));
}

export async function getForumThread(userId: string, id: string): Promise<{ thread: ForumThreadView; replies: ForumReplyView[] }> {
  const db = await getDb();
  const row = await db
    .select(threadProjection)
    .from(schema.graftForumThreads)
    .innerJoin(schema.users, eq(schema.users.id, schema.graftForumThreads.authorId))
    .where(eq(schema.graftForumThreads.id, id))
    .get();
  if (!row) throw notFound("Forum topic not found.");
  const vote = await db
    .select({ userId: schema.graftForumVotes.userId })
    .from(schema.graftForumVotes)
    .where(and(eq(schema.graftForumVotes.threadId, id), eq(schema.graftForumVotes.userId, userId)))
    .get();
  const replies = await db
    .select({
      id: schema.graftForumReplies.id,
      threadId: schema.graftForumReplies.threadId,
      authorId: schema.graftForumReplies.authorId,
      author: schema.users.name,
      body: schema.graftForumReplies.body,
      createdAt: schema.graftForumReplies.createdAt,
    })
    .from(schema.graftForumReplies)
    .innerJoin(schema.users, eq(schema.users.id, schema.graftForumReplies.authorId))
    .where(eq(schema.graftForumReplies.threadId, id))
    .orderBy(schema.graftForumReplies.createdAt)
    .limit(300);
  return {
    thread: { ...toThreadView(row), hasVoted: Boolean(vote) },
    replies: replies.map((reply) => ({ ...reply, createdAt: reply.createdAt.toISOString() })),
  };
}

export async function createForumThread(authorId: string, raw: unknown): Promise<string> {
  const input = createThreadInput.parse(raw);
  const db = await getDb();
  const now = new Date();
  const id = newId();
  await db.insert(schema.graftForumThreads).values({ id, ...input, authorId, createdAt: now, updatedAt: now });
  return id;
}

export async function createForumReply(authorId: string, threadId: string, raw: unknown): Promise<void> {
  const { body } = createReplyInput.parse(raw);
  const db = await getDb();
  const thread = await db
    .select({ id: schema.graftForumThreads.id, locked: schema.graftForumThreads.locked })
    .from(schema.graftForumThreads)
    .where(eq(schema.graftForumThreads.id, threadId))
    .get();
  if (!thread) throw notFound("Forum topic not found.");
  if (thread.locked) throw new HttpError(409, "This topic is locked, so it cannot accept new replies.", "locked");
  const now = new Date();
  await db.insert(schema.graftForumReplies).values({ id: newId(), threadId, authorId, body, createdAt: now });
  await db.update(schema.graftForumThreads).set({ updatedAt: now }).where(eq(schema.graftForumThreads.id, threadId));
}

export async function setForumVote(userId: string, threadId: string, voted: boolean): Promise<void> {
  const db = await getDb();
  const thread = await db
    .select({ id: schema.graftForumThreads.id })
    .from(schema.graftForumThreads)
    .where(eq(schema.graftForumThreads.id, threadId))
    .get();
  if (!thread) throw notFound("Forum topic not found.");
  if (voted) {
    await db.insert(schema.graftForumVotes).values({ threadId, userId, createdAt: new Date() }).onConflictDoNothing();
  } else {
    await db.delete(schema.graftForumVotes).where(and(
      eq(schema.graftForumVotes.threadId, threadId),
      eq(schema.graftForumVotes.userId, userId)
    ));
  }
}

export async function moderateForumThread(threadId: string, raw: unknown): Promise<void> {
  const input = moderateThreadInput.parse(raw);
  const db = await getDb();
  const result = await db.update(schema.graftForumThreads).set({ ...input, updatedAt: new Date() })
    .where(eq(schema.graftForumThreads.id, threadId))
    .returning({ id: schema.graftForumThreads.id });
  if (result.length === 0) throw notFound("Forum topic not found.");
}

export async function deleteForumThread(actorId: string, threadId: string, admin: boolean): Promise<void> {
  const db = await getDb();
  const row = await db
    .select({ authorId: schema.graftForumThreads.authorId })
    .from(schema.graftForumThreads)
    .where(eq(schema.graftForumThreads.id, threadId))
    .get();
  if (!row) throw notFound("Forum topic not found.");
  if (!admin && row.authorId !== actorId) throw new HttpError(403, "You can remove only topics you started.", "forbidden");
  await db.delete(schema.graftForumThreads).where(eq(schema.graftForumThreads.id, threadId));
}

export async function deleteForumReply(actorId: string, threadId: string, replyId: string, admin: boolean): Promise<void> {
  const db = await getDb();
  const row = await db
    .select({ authorId: schema.graftForumReplies.authorId })
    .from(schema.graftForumReplies)
    .where(and(eq(schema.graftForumReplies.id, replyId), eq(schema.graftForumReplies.threadId, threadId)))
    .get();
  if (!row) throw notFound("Reply not found.");
  if (!admin && row.authorId !== actorId) throw new HttpError(403, "You can remove only replies you wrote.", "forbidden");
  await db.delete(schema.graftForumReplies).where(eq(schema.graftForumReplies.id, replyId));
  await db.update(schema.graftForumThreads).set({ updatedAt: new Date() }).where(eq(schema.graftForumThreads.id, threadId));
}
