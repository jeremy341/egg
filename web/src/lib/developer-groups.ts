import { tokenStatus } from "@/lib/developer";

/**
 * How the Developer page groups the token list. Pure: give it the tokens and
 * the moment to read them against.
 */

const DAY = 86_400_000;

/** An active token that ends within this many days is flagged in the list. */
export const EXPIRING_SOON_DAYS = 7;

type Dated = { revokedAt: string | null; expiresAt: string };

const time = (iso: string | null) => (iso ? new Date(iso).getTime() : 0);

/** True for an active token that stops working within 7 days, counting exactly 7. */
export function isExpiringSoon(t: Dated, now: number): boolean {
  return tokenStatus(t, now) === "active" && time(t.expiresAt) - now <= EXPIRING_SOON_DAYS * DAY;
}

export type TokenGroups<T> = {
  /** Soonest expiry first. */
  active: { token: T; expiringSoon: boolean }[];
  /** How many active tokens are flagged. */
  expiringSoon: number;
  /** Most recently expired first. */
  expired: T[];
  /** Most recently revoked first. A revoked token is never active, whatever its expiry. */
  revoked: T[];
};

/** Every token lands in exactly one group. Ties keep the order they came in. */
export function groupTokens<T extends Dated>(tokens: readonly T[], now: number): TokenGroups<T> {
  const active: T[] = [];
  const expired: T[] = [];
  const revoked: T[] = [];
  for (const t of tokens) {
    const status = tokenStatus(t, now);
    (status === "active" ? active : status === "expired" ? expired : revoked).push(t);
  }
  active.sort((a, b) => time(a.expiresAt) - time(b.expiresAt));
  expired.sort((a, b) => time(b.expiresAt) - time(a.expiresAt));
  revoked.sort((a, b) => time(b.revokedAt) - time(a.revokedAt));

  const entries = active.map((token) => ({ token, expiringSoon: isExpiringSoon(token, now) }));
  return {
    active: entries,
    expiringSoon: entries.filter((e) => e.expiringSoon).length,
    expired,
    revoked,
  };
}
