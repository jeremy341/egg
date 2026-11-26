import { and, desc, eq, gte, inArray, lt, or, sql, type SQL } from "drizzle-orm";
import { getDb, schema } from "@/server/db";
import { HttpError } from "@/server/http";

/**
 * Keyset paging for deployments. Rows are ordered newest first by `createdAt`,
 * with `id` (descending) breaking a tie, so two rows made in the same
 * millisecond always keep one fixed order and none is skipped or repeated
 * between pages. The cursor names the last row of a page.
 */

export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 100;

export type PageCursor = { at: number; id: string };

/** The cursor is opaque to clients: base64url of `createdAt(ms)|id`. */
export function encodeCursor(c: PageCursor): string {
  return Buffer.from(`${c.at}|${c.id}`, "utf8").toString("base64url");
}

/** Returns null for anything that is not a cursor this module made. */
export function decodeCursor(raw: unknown): PageCursor | null {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 200) return null;
  if (!/^[A-Za-z0-9_-]+$/.test(raw)) return null;
  const m = /^(\d{1,15})\|([A-Za-z0-9_.-]{1,64})$/.exec(Buffer.from(raw, "base64url").toString("utf8"));
  if (!m) return null;
  const at = Number(m[1]);
  if (!Number.isSafeInteger(at)) return null;
  const cursor = { at, id: m[2] };
  // Stray bits at the end of the base64 text decode to the same bytes; refuse them.
  return encodeCursor(cursor) === raw ? cursor : null;
}

export function pageLimit(value: unknown): number {
  const n = Number(value);
  if (value === undefined || value === null || value === "" || !Number.isFinite(n)) return DEFAULT_PAGE_SIZE;
  return Math.min(Math.max(Math.floor(n), 1), MAX_PAGE_SIZE);
}

export type StatusFilterValue = "all" | "ready" | "building" | "error";
export type EnvFilterValue = "all" | "production" | "preview";
export type RangeFilterValue = "any" | "24h" | "7d" | "30d";

export type DeploymentFilter = {
  status?: StatusFilterValue;
  env?: EnvFilterValue;
  range?: RangeFilterValue;
  /** Words typed in the search box. Every word has to match. */
  q?: string;
};

const RANGE_MS = { "24h": 24 * 3_600_000, "7d": 7 * 86_400_000, "30d": 30 * 86_400_000 } as const;
const MAX_WORDS = 8;
const MAX_WORD_LENGTH = 100;

export function parseStatus(v: string | null | undefined): StatusFilterValue | undefined {
  return v === "ready" || v === "building" || v === "error" ? v : undefined;
}
export function parseEnv(v: string | null | undefined): EnvFilterValue | undefined {
  return v === "production" || v === "preview" ? v : undefined;
}
export function parseRange(v: string | null | undefined): RangeFilterValue | undefined {
  return v === "24h" || v === "7d" || v === "30d" ? v : undefined;
}

/** "building" covers queued and deploying; "error" covers canceled, as the status pills do. */
function statusWhere(status: StatusFilterValue): SQL | undefined {
  const d = schema.deployments.state;
  switch (status) {
    case "ready":
      return eq(d, "ready");
    case "building":
      return inArray(d, ["queued", "building", "deploying"]);
    case "error":
      return inArray(d, ["error", "canceled"]);
    default:
      return undefined;
  }
}

/**
 * The same rule as the search box in the browser: each word has to appear
 * (any case) in the project name, branch, commit message, sha, author, source,
 * environment or pull request ("#14" or "pr 14").
 */
function searchWhere(q: string): SQL | undefined {
  const words = q
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, MAX_WORDS)
    .map((w) => w.slice(0, MAX_WORD_LENGTH));
  if (words.length === 0) return undefined;
  const d = schema.deployments;
  const has = (col: unknown, w: string) => sql`instr(lower(coalesce(${col}, '')), ${w}) > 0`;
  return and(
    ...words.map(
      (w) =>
        or(
          has(schema.projects.name, w),
          has(d.branch, w),
          has(d.commitMessage, w),
          has(d.commitSha, w),
          has(d.author, w),
          has(d.source, w),
          has(d.env, w),
          sql`${d.prNumber} is not null and instr('#' || ${d.prNumber} || ' pr ' || ${d.prNumber}, ${w}) > 0`
        ) as SQL
    )
  );
}

export type DeploymentRowPair = {
  d: typeof schema.deployments.$inferSelect;
  p: typeof schema.projects.$inferSelect;
};

/**
 * One page of a user's deployments. `limit` must already be a whole number of
 * at least 1. A cursor that is present but not valid is a 400.
 */
export async function selectDeploymentPage(
  userId: string,
  options: {
    projectId?: string;
    limit: number;
    cursor?: string | null;
    filter?: DeploymentFilter;
    now?: number;
  }
): Promise<{ rows: DeploymentRowPair[]; nextCursor: string | null }> {
  const cursor = options.cursor ? decodeCursor(options.cursor) : null;
  if (options.cursor && !cursor) throw new HttpError(400, "That cursor is not valid.", "bad_cursor");

  const d = schema.deployments;
  const f = options.filter ?? {};
  const where = and(
    eq(schema.projects.userId, userId),
    options.projectId ? eq(d.projectId, options.projectId) : undefined,
    cursor
      ? or(lt(d.createdAt, new Date(cursor.at)), and(eq(d.createdAt, new Date(cursor.at)), lt(d.id, cursor.id)))
      : undefined,
    f.status ? statusWhere(f.status) : undefined,
    f.env && f.env !== "all" ? eq(d.env, f.env) : undefined,
    f.range && f.range !== "any"
      ? gte(d.createdAt, new Date((options.now ?? Date.now()) - RANGE_MS[f.range]))
      : undefined,
    f.q ? searchWhere(f.q) : undefined
  );

  const db = await getDb();
  const found = await db
    .select({ d, p: schema.projects })
    .from(d)
    .innerJoin(schema.projects, eq(schema.projects.id, d.projectId))
    .where(where)
    .orderBy(desc(d.createdAt), desc(d.id))
    .limit(options.limit + 1);

  const rows = found.slice(0, options.limit);
  const last = rows[rows.length - 1];
  const nextCursor =
    found.length > options.limit && last ? encodeCursor({ at: last.d.createdAt.getTime(), id: last.d.id }) : null;
  return { rows, nextCursor };
}
