import { eq } from "drizzle-orm";
import { getDb, schema, type Db } from "@/server/db";
import { HttpError } from "@/server/http";

/**
 * Suspended accounts. An administrator's ban starts a grace period of 15 days. During it the account works
 * as usual and the user sees a banner with the end date. After it, every write is refused: new projects,
 * deployments, settings changes, security reports and API writes. Reads keep working so the user can export.
 */

export const GRACE_PERIOD_MS = 15 * 24 * 60 * 60 * 1000;

export type AccountStanding =
  | { state: "active" }
  | { state: "grace"; graceEndsAt: Date }
  | { state: "blocked"; graceEndsAt: Date };

export type AccountRecord = {
  status: "active" | "suspended";
  suspendedAt: Date | null;
  graceEndsAt: Date | null;
};

/** The moment a ban at `suspendedAt` stops being a grace period. */
export function graceEndFor(suspendedAt: Date): Date {
  return new Date(suspendedAt.getTime() + GRACE_PERIOD_MS);
}

/**
 * The state of an account at `now`. Before the end of the grace period the account is in grace. At the end
 * instant and after it, the account is blocked. A suspended account with no recorded end is blocked, because
 * a missing value must never leave writes open.
 */
export function accountStanding(account: AccountRecord, now: Date): AccountStanding {
  if (account.status !== "suspended") return { state: "active" };
  const graceEndsAt = account.graceEndsAt ?? account.suspendedAt ?? now;
  if (account.graceEndsAt && now.getTime() < account.graceEndsAt.getTime()) {
    return { state: "grace", graceEndsAt };
  }
  return { state: "blocked", graceEndsAt };
}

/** The standing of a stored account. An unknown id has no ban on record, so it is active. */
export async function accountStandingFor(
  userId: string,
  now = new Date(),
  db?: Pick<Db, "select">,
): Promise<AccountStanding> {
  const query = db ?? (await getDb());
  const row = await query
    .select({
      status: schema.users.status,
      suspendedAt: schema.users.suspendedAt,
      graceEndsAt: schema.users.graceEndsAt,
    })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .get();
  if (!row) return { state: "active" };
  return accountStanding(row, now);
}

function day(value: Date): string {
  return value.toISOString().slice(0, 10);
}

/** The refusal for a blocked account. It says what still works, so the user knows where to go. */
export function accountBlockedError(graceEndsAt: Date): HttpError {
  return new HttpError(
    403,
    `Your account is suspended, and its grace period ended on ${day(graceEndsAt)}. New projects, deployments, settings changes, security reports and API writes are blocked. You can still view and export your data.`,
    "account_suspended",
  );
}

/**
 * The single write check for suspended accounts. Call it before any write that an account owner makes, and
 * inside the transaction when there is one. Blocked accounts get 403; grace and active accounts pass.
 */
export async function assertAccountCanWrite(
  userId: string,
  options: { db?: Pick<Db, "select">; now?: Date } = {},
): Promise<void> {
  const standing = await accountStandingFor(userId, options.now ?? new Date(), options.db);
  if (standing.state === "blocked") throw accountBlockedError(standing.graceEndsAt);
}

/**
 * Requests that the route layer does not check for a blocked account. Reads and sign-out always work.
 * Cancelling a running deployment, closing a terminal and cleanup recovery are stop or recovery actions, so
 * they stay open too. Writes from deployed apps (analytics collection) and from GitHub are not the account's own
 * writes. MCP is exempt here only because its write tools are checked in the API dispatcher (callEndpoint).
 * The anonymous security report POST is exempt here as well: its route looks up a session only when a cookie is
 * present, so anonymous reports never consult the signed-in identity.
 */
export function accountExemptRequest(path: string, method: string): boolean {
  if (["GET", "HEAD", "OPTIONS"].includes(method)) return true;
  return /^\/api\/(?:auth(?:\/|$)|admin(?:\/|$)|collect\/|mcp$)/.test(path)
    || (method === "POST" && path === "/api/security-reports")
    || /^\/api\/(?:v1\/)?deployments\/[^/]+\/cancel$/.test(path)
    || path === "/api/deployments/bulk-cancel"
    || (["PATCH", "DELETE"].includes(method) && /^\/api\/cleanup\/[^/]+$/.test(path))
    || (method === "DELETE" && (
      /^\/api\/account\/sessions(?:\/|$)/.test(path)
      || /^\/api\/tokens\/[^/]+$/.test(path)
      || /^\/api\/(?:v1\/)?projects\/[^/]+\/terminal\/[^/]+$/.test(path)
    ));
}
