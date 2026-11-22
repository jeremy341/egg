import { and, eq, gt, lt } from "drizzle-orm";
import { getDb, schema } from "@/server/db";
import { newId, randomToken, sha256Hex } from "@/server/crypto";

export const SESSION_COOKIE = "egg_session";
export const OAUTH_COOKIE = "egg_oauth";
export const SESSION_DAYS = 30;

export type SessionUser = {
  id: string;
  name: string;
  email: string | null;
  hackClubId: string;
};

/** Insert or update the user for a Hack Club identity. */
export async function upsertUser(profile: {
  id: string;
  name: string;
  email: string | null;
  slackId: string | null;
  emailVerified?: boolean;
}): Promise<SessionUser> {
  const db = await getDb();
  // Store the email the way sign-in lookups normalize it (normalizeEmail):
  // a stored form with surrounding spaces or non-ASCII case could never match.
  const email = profile.email?.trim().toLowerCase().slice(0, 254) ?? null;
  const refresh = async (userId: string, hackClubId: string): Promise<SessionUser> => {
    await db
      .update(schema.users)
      .set({ name: profile.name, email, emailVerified: profile.emailVerified === true, slackId: profile.slackId })
      .where(eq(schema.users.id, userId));
    return { id: userId, name: profile.name, email, hackClubId };
  };
  const existing = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.hackClubId, profile.id))
    .get();

  if (existing) return refresh(existing.id, existing.hackClubId);

  const id = newId();
  const inserted = await db
    .insert(schema.users)
    .values({
      id,
      hackClubId: profile.id,
      name: profile.name,
      email,
      slackId: profile.slackId,
      emailVerified: profile.emailVerified === true,
      createdAt: new Date(),
    })
    .onConflictDoNothing()
    .returning({ id: schema.users.id });
  if (inserted.length === 0) {
    // Another first sign-in created this identity between our select and insert.
    const raced = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.hackClubId, profile.id))
      .get();
    if (raced) return refresh(raced.id, raced.hackClubId);
  }
  return { id, name: profile.name, email, hackClubId: profile.id };
}

/**
 * Returns the raw token to put in the cookie. Only its hash is stored. Pass the
 * token from the request's existing cookie as `replacing` at sign-in: every
 * sign-in gets a new token, and the one it replaces stops working.
 */
export async function createSession(
  userId: string,
  userAgent?: string | null,
  replacing?: string,
  options: { freshHackClubAuth?: boolean } = {}
): Promise<{ token: string; expiresAt: Date }> {
  const db = await getDb();
  if (replacing) await db.delete(schema.sessions).where(eq(schema.sessions.id, sha256Hex(replacing)));
  const token = randomToken(32);
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  await db.insert(schema.sessions).values({
    id: sha256Hex(token),
    userId,
    expiresAt,
    createdAt: new Date(),
    userAgent: userAgent?.slice(0, 200) ?? null,
    freshAuthAt: options.freshHackClubAuth ? new Date() : null,
  });
  // Opportunistic cleanup keeps the table small without a cron job.
  await db.delete(schema.sessions).where(lt(schema.sessions.expiresAt, new Date()));
  return { token, expiresAt };
}

export async function userForSessionToken(
  token: string | undefined
): Promise<SessionUser | null> {
  if (!token) return null;
  const db = await getDb();
  const row = await db
    .select({
      id: schema.users.id,
      name: schema.users.name,
      email: schema.users.email,
      hackClubId: schema.users.hackClubId,
    })
    .from(schema.sessions)
    .innerJoin(schema.users, eq(schema.users.id, schema.sessions.userId))
    .where(
      and(
        eq(schema.sessions.id, sha256Hex(token)),
        gt(schema.sessions.expiresAt, new Date())
      )
    )
    .get();
  return row ?? null;
}

export async function deleteSession(token: string | undefined) {
  if (!token) return;
  const db = await getDb();
  await db.delete(schema.sessions).where(eq(schema.sessions.id, sha256Hex(token)));
}

export function sessionCookieOptions(expires: Date) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires,
  };
}

/** How long a Hack Club sign-in counts as "just now" for sensitive switches. */
export const REAUTH_WINDOW_MS = 5 * 60 * 1000;

/** Record a fresh Hack Club sign-in on this session. Only ever for the session's own user. */
export async function markFreshAuth(token: string, now = new Date()): Promise<void> {
  const db = await getDb();
  await db
    .update(schema.sessions)
    .set({ freshAuthAt: now })
    .where(eq(schema.sessions.id, sha256Hex(token)));
}

/**
 * True when this session confirmed with Hack Club within the window.
 * Pass `userId` at every authorization call site so a fresh session belonging
 * to another account can never satisfy someone else's step-up check.
 */
export async function isFreshAuth(
  token: string | undefined,
  now = Date.now(),
  userId?: string
): Promise<boolean> {
  if (!token) return false;
  const db = await getDb();
  const row = await db
    .select({ freshAuthAt: schema.sessions.freshAuthAt })
    .from(schema.sessions)
    .where(
      and(
        eq(schema.sessions.id, sha256Hex(token)),
        ...(userId ? [eq(schema.sessions.userId, userId)] : [])
      )
    )
    .get();
  return !!row?.freshAuthAt && now - row.freshAuthAt.getTime() <= REAUTH_WINDOW_MS;
}
