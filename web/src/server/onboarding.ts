import { and, asc, count, desc, eq, sql } from "drizzle-orm";
import { getDb, schema } from "@/server/db";
import { parseMarks, type Chapter, type Marks, type MarkStatus, type OnboardingFacts } from "@/lib/onboarding-marks";

/**
 * The guided first-project tour: the marks a person has set per chapter, and the facts
 * the tour is worked out from. See docs/design/onboarding-tour-plan.md.
 *
 * Marks live in one JSON column of user_preferences. Every change reads, changes and
 * writes inside one transaction, so two quick requests cannot lose each other's mark.
 * Every query is by the given user id.
 */

/** The saved marks. No row, or damaged text, reads as no marks. */
export async function getMarks(userId: string): Promise<Marks> {
  const db = await getDb();
  const row = await db
    .select({ onboarding: schema.userPreferences.onboarding })
    .from(schema.userPreferences)
    .where(eq(schema.userPreferences.userId, userId))
    .get();
  return parseMarks(row?.onboarding);
}

/**
 * The stored text as a JSON object, or "{}" when it is not one. Damaged text reads as no marks
 * and the next write replaces it.
 */
const stored = sql`CASE WHEN json_valid(${schema.userPreferences.onboarding}) THEN CASE WHEN json_type(${schema.userPreferences.onboarding}) = 'object' THEN ${schema.userPreferences.onboarding} ELSE '{}' END ELSE '{}' END`;

/*
 * Each change is ONE upsert statement that reads the stored object, changes one key and writes it
 * back, so two quick requests cannot lose each other's update. It is a single statement rather than
 * a transaction on purpose: libsql gives each transaction its own pooled connection without a busy
 * timeout, so two overlapping transactions fail with SQLITE_BUSY instead of waiting. The row is
 * created when it is missing, and the other preferences keep their defaults.
 */

/** Record a mark for one chapter. The other chapters keep their marks. */
export async function setMark(userId: string, chapter: Chapter, status: MarkStatus): Promise<Marks> {
  const db = await getDb();
  const now = new Date();
  const [row] = await db
    .insert(schema.userPreferences)
    .values({ userId, onboarding: JSON.stringify({ [chapter]: status }), updatedAt: now })
    .onConflictDoUpdate({
      target: schema.userPreferences.userId,
      set: { onboarding: sql`json_set(${stored}, ${`$.${chapter}`}, ${status})`, updatedAt: now },
    })
    .returning({ onboarding: schema.userPreferences.onboarding });
  return parseMarks(row?.onboarding);
}

/** Remove one chapter's mark, or every mark when no chapter is given ("show me again"). */
export async function clearMarks(userId: string, chapter?: Chapter): Promise<Marks> {
  const db = await getDb();
  const now = new Date();
  const [row] = await db
    .insert(schema.userPreferences)
    .values({ userId, onboarding: "{}", updatedAt: now })
    .onConflictDoUpdate({
      target: schema.userPreferences.userId,
      set: {
        onboarding: chapter ? sql`json_remove(${stored}, ${`$.${chapter}`})` : "{}",
        updatedAt: now,
      },
    })
    .returning({ onboarding: schema.userPreferences.onboarding });
  return parseMarks(row?.onboarding);
}

/** What the tour needs to know about the person's account. A handful of small queries, no secrets. */
export async function onboardingFacts(userId: string): Promise<OnboardingFacts> {
  const db = await getDb();

  const servers = await db
    .select({ status: schema.servers.status })
    .from(schema.servers)
    .where(eq(schema.servers.userId, userId));

  const [{ projectCount }] = await db
    .select({ projectCount: count() })
    .from(schema.projects)
    .where(eq(schema.projects.userId, userId));

  const first = await db
    .select({ id: schema.projects.id, slug: schema.projects.slug })
    .from(schema.projects)
    .where(eq(schema.projects.userId, userId))
    .orderBy(asc(schema.projects.createdAt))
    .limit(1)
    .get();

  let firstDeployment: OnboardingFacts["firstDeployment"] = null;
  if (first) {
    const latest = await db
      .select({ state: schema.deployments.state })
      .from(schema.deployments)
      .where(eq(schema.deployments.projectId, first.id))
      .orderBy(desc(schema.deployments.createdAt))
      .limit(1)
      .get();
    if (latest) firstDeployment = { state: latest.state };
  }

  const active = await db
    .select({ id: schema.domains.id })
    .from(schema.domains)
    .where(and(eq(schema.domains.userId, userId), eq(schema.domains.status, "valid")))
    .limit(1)
    .get();

  return {
    servers,
    projectCount,
    firstProject: first ? { slug: first.slug } : null,
    firstDeployment,
    hasActiveDomain: active !== undefined,
  };
}
