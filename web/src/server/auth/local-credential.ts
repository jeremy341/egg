import { eq } from "drizzle-orm";
import { getDb, schema } from "@/server/db";

const LOCAL_CREDENTIAL_ID = "local-owner";

export async function localCredential() {
  const db = await getDb();
  return db
    .select()
    .from(schema.localAuthCredentials)
    .where(eq(schema.localAuthCredentials.id, LOCAL_CREDENTIAL_ID))
    .get();
}

export async function localPasswordConfigured(): Promise<boolean> {
  return !!(await localCredential());
}

/** Atomically complete first sign-in enrollment. A racing winner owns the verifier. */
export async function createLocalCredential(passwordHash: string): Promise<boolean> {
  const db = await getDb();
  const now = new Date();
  const inserted = await db
    .insert(schema.localAuthCredentials)
    .values({ id: LOCAL_CREDENTIAL_ID, passwordHash, createdAt: now, updatedAt: now })
    .onConflictDoNothing()
    .returning({ id: schema.localAuthCredentials.id });
  return inserted.length === 1;
}

/** Compare-and-set so a concurrent reset/change cannot silently overwrite another password. */
export async function replaceLocalCredential(expectedHash: string, passwordHash: string): Promise<boolean> {
  const db = await getDb();
  const updated = await db
    .update(schema.localAuthCredentials)
    .set({ passwordHash, updatedAt: new Date() })
    .where(eq(schema.localAuthCredentials.passwordHash, expectedHash))
    .returning({ id: schema.localAuthCredentials.id });
  return updated.some((row) => row.id === LOCAL_CREDENTIAL_ID);
}
