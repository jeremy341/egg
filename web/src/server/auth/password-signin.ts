import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { getDb, schema } from "@/server/db";
import { config, hackClubConfigured, localModeEnabled } from "@/server/config";
import { newId } from "@/server/crypto";
import { hashLocalPassword, verifyLocalPassword } from "@/server/auth/local-password";
import { revokeOtherSessions } from "@/server/account";

/**
 * Optional password sign-in. Each person turns it on for their own account; it is
 * off until then. Only a salted scrypt hash of the password and of the recovery
 * key is stored. The credential row is the switch: no row means off.
 */

/** The one message for a wrong password or recovery key, known or unknown account. */
export const PASSWORD_AUTH_ERROR = "That password or recovery key is not right.";

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const KEY_CHARS = 32;
const SETUP_TICKET_MS = 15 * 60 * 1000;

/** 160 random bits as 32 base32 characters in groups of four, e.g. ABCD-EFGH-... */
export function generateRecoveryKey(): string {
  const bytes = randomBytes(20);
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  return out.match(/.{4}/g)!.join("-");
}

/** Upper-case and drop dashes and spaces, so a pasted key matches however it was typed. */
export function normalizeRecoveryKey(input: string): string {
  return input.toUpperCase().replace(/[^A-Z2-7]/g, "");
}

export function normalizeEmail(input: unknown): string {
  return typeof input === "string" ? input.trim().toLowerCase().slice(0, 254) : "";
}

export type SignInEnvironment = {
  hackClubConfigured: boolean;
  devLogin: boolean;
  production: boolean;
  localMode: boolean;
};

export function signInEnvironment(): SignInEnvironment {
  return {
    hackClubConfigured: hackClubConfigured(),
    devLogin: config().DEV_LOGIN,
    production: process.env.NODE_ENV === "production",
    localMode: localModeEnabled(),
  };
}

/**
 * The lockout rule. A password may be turned off only while the account has
 * another way to sign in:
 * - a Hack Club account (any id that is not `dev:` or `local:`) needs Hack Club
 *   sign-in to be set up on this installation;
 * - a development account (`dev:`) needs the development sign-in, which exists
 *   only with DEV_LOGIN, outside production, and with local mode off (local
 *   mode puts a password in front of it);
 * - the local-mode owner (`local:`) has no other way, so it is never allowed.
 */
export function hasOtherSignIn(user: { hackClubId: string }, env: SignInEnvironment): boolean {
  if (user.hackClubId.startsWith("local:")) return false;
  if (user.hackClubId.startsWith("dev:")) return env.devLogin && !env.production && !env.localMode;
  return env.hackClubConfigured;
}

/** Proof that this server generated this key for this user a moment ago. */
function ticketFor(userId: string, recoveryKey: string, expiresAt: number): string {
  return createHmac("sha256", config().APP_SECRET)
    .update(`egg-password-setup\n${userId}\n${normalizeRecoveryKey(recoveryKey)}\n${expiresAt}`)
    .digest("base64url");
}

/** Step one of turning on: a fresh key, shown once, bound to the user by a signed ticket. Nothing is stored. */
export function prepareSetup(userId: string, now = Date.now()) {
  const recoveryKey = generateRecoveryKey();
  const expiresAt = now + SETUP_TICKET_MS;
  return { recoveryKey, expiresAt, ticket: ticketFor(userId, recoveryKey, expiresAt) };
}

export function setupTicketValid(
  userId: string,
  recoveryKey: string,
  expiresAt: number,
  ticket: string,
  now = Date.now()
): boolean {
  if (!Number.isFinite(expiresAt) || expiresAt < now || expiresAt > now + SETUP_TICKET_MS) return false;
  const expected = Buffer.from(ticketFor(userId, recoveryKey, expiresAt));
  const given = Buffer.from(ticket);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

export type PasswordCredential = typeof schema.localAuthCredentials.$inferSelect;

export async function passwordCredential(userId: string): Promise<PasswordCredential | undefined> {
  const db = await getDb();
  return db
    .select()
    .from(schema.localAuthCredentials)
    .where(eq(schema.localAuthCredentials.userId, userId))
    .get();
}

/** Store the hashes for a user. False when one already exists (a racing turn-on). */
export async function createPasswordCredential(
  userId: string,
  password: string,
  recoveryKey: string
): Promise<boolean> {
  const [passwordHash, recoveryKeyHash] = await Promise.all([
    hashLocalPassword(password),
    hashLocalPassword(normalizeRecoveryKey(recoveryKey)),
  ]);
  const db = await getDb();
  const now = new Date();
  const inserted = await db
    .insert(schema.localAuthCredentials)
    .values({ id: newId(), userId, passwordHash, recoveryKeyHash, createdAt: now, updatedAt: now })
    .onConflictDoNothing()
    .returning({ id: schema.localAuthCredentials.id });
  return inserted.length === 1;
}

/** Compare-and-set on the stored password hash, so a concurrent change cannot be overwritten. */
export async function replacePasswordCredential(
  userId: string,
  expectedPasswordHash: string,
  next: { password: string; newRecoveryKey?: string }
): Promise<boolean> {
  const passwordHash = await hashLocalPassword(next.password);
  const recoveryKeyHash = next.newRecoveryKey
    ? await hashLocalPassword(normalizeRecoveryKey(next.newRecoveryKey))
    : undefined;
  const db = await getDb();
  const updated = await db
    .update(schema.localAuthCredentials)
    .set({ passwordHash, ...(recoveryKeyHash ? { recoveryKeyHash } : {}), updatedAt: new Date() })
    .where(
      and(
        eq(schema.localAuthCredentials.userId, userId),
        eq(schema.localAuthCredentials.passwordHash, expectedPasswordHash)
      )
    )
    .returning({ id: schema.localAuthCredentials.id });
  return updated.length === 1;
}

/** Turn the password off for good: the hashes are deleted, not just marked. */
export async function deletePasswordCredential(userId: string, expectedPasswordHash: string): Promise<boolean> {
  const db = await getDb();
  const gone = await db
    .delete(schema.localAuthCredentials)
    .where(
      and(
        eq(schema.localAuthCredentials.userId, userId),
        eq(schema.localAuthCredentials.passwordHash, expectedPasswordHash)
      )
    )
    .returning({ id: schema.localAuthCredentials.id });
  return gone.length === 1;
}

/** True if the supplied password or recovery key matches this credential. */
export async function credentialAccepts(
  credential: Pick<PasswordCredential, "passwordHash" | "recoveryKeyHash">,
  proof: { password?: string; recoveryKey?: string }
): Promise<boolean> {
  if (proof.password) return verifyLocalPassword(proof.password, credential.passwordHash);
  if (proof.recoveryKey) {
    const key = normalizeRecoveryKey(proof.recoveryKey);
    return key.length === KEY_CHARS && !!credential.recoveryKeyHash && verifyLocalPassword(key, credential.recoveryKeyHash);
  }
  return false;
}

/** Every session of this user ends, the caller's included. Terminals close with them. */
export async function revokeAllSessions(userId: string): Promise<number> {
  return revokeOtherSessions(userId, undefined);
}

let dummyHash: Promise<string> | null = null;
/** A real hash nobody can match, so an unknown account costs the same time as a known one. */
function decoyHash(): Promise<string> {
  return (dummyHash ??= hashLocalPassword(randomBytes(18).toString("base64url")));
}

export type PasswordAccount = { userId: string; credential: PasswordCredential };

/**
 * Find the account whose email matches and whose password or recovery key
 * checks out. Unknown email, no password turned on, and a wrong secret all give
 * null after the same hashing work, so the result does not reveal which it was.
 */
export async function authenticatePasswordAccount(
  email: string,
  proof: { password?: string; recoveryKey?: string }
): Promise<PasswordAccount | null> {
  const db = await getDb();
  const candidates =
    email.length === 0
      ? []
      : await db
          .select({ userId: schema.users.id, credential: schema.localAuthCredentials })
          .from(schema.users)
          .innerJoin(schema.localAuthCredentials, eq(schema.localAuthCredentials.userId, schema.users.id))
          .where(sql`lower(${schema.users.email}) = ${email}`)
          .limit(3);
  if (candidates.length === 0) {
    const decoy = await decoyHash();
    await credentialAccepts({ passwordHash: decoy, recoveryKeyHash: decoy }, proof);
    return null;
  }
  for (const candidate of candidates) {
    if (await credentialAccepts(candidate.credential, proof)) return candidate;
  }
  return null;
}
