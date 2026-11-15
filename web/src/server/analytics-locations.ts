import { isIP } from "node:net";
import { and, desc, eq, gte, isNotNull, sql } from "drizzle-orm";
import { COUNTRY_CODE, countryName } from "@/lib/world-codes";
import { type Count } from "@/lib/stats-format";
import { getDb, schema } from "@/server/db";
import { getProjectForUser } from "@/server/projects";
import { roundCount } from "@/server/stats";

/**
 * Visitor countries, an opt-in switch ("Record visitor countries").
 *
 * The address is used for one lookup in the same request and is not kept: only the two-letter
 * country code is stored, and only when the project has the switch on. The lookup is a database
 * bundled with the app (geoip-country, which has country data only: no city, region or
 * coordinates), so nothing is sent to any other service. An unknown, local or private address
 * has no country, and no country is stored for it.
 */

export const UNKNOWN_COUNTRY = "unknown";

/** True for an address that belongs to one network: not loopback, private, link-local, shared or reserved. */
export function isPublicIp(raw: string): boolean {
  let ip = raw.trim();
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  if (mapped) ip = mapped[1];
  const kind = isIP(ip);
  if (kind === 4) {
    const [a, b] = ip.split(".").map(Number);
    return !(
      a === 0 ||
      a === 10 ||
      a === 127 ||
      a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0) ||
      (a === 198 && (b === 18 || b === 19))
    );
  }
  if (kind === 6) {
    const lower = ip.toLowerCase();
    return !(
      lower === "::" ||
      lower === "::1" ||
      lower.startsWith("fe8") ||
      lower.startsWith("fe9") ||
      lower.startsWith("fea") ||
      lower.startsWith("feb") ||
      lower.startsWith("fc") ||
      lower.startsWith("fd") ||
      lower.startsWith("ff")
    );
  }
  return false;
}

type Lookup = (ip: string) => { country: string } | null;
let lookup: Promise<Lookup> | null = null;

/** Loaded on first use, so a server with no project recording countries never reads the database file. */
function loadLookup(): Promise<Lookup> {
  lookup ??= import("geoip-country").then((m) => (m.default ?? m).lookup);
  return lookup;
}

/**
 * The two-letter country of an address, or "unknown". Offline, and the address is not stored or
 * logged. Anything that is not a public address, or is not in the database, is "unknown".
 */
export async function countryOf(ip: string): Promise<string> {
  try {
    if (!isPublicIp(ip)) return UNKNOWN_COUNTRY;
    const found = (await loadLookup())(ip.trim().replace(/^::ffff:/i, ""));
    return found && COUNTRY_CODE.test(found.country) ? found.country : UNKNOWN_COUNTRY;
  } catch {
    return UNKNOWN_COUNTRY;
  }
}

/**
 * What to store on a page view: the country code when the switch is on and the country is
 * known, otherwise null. With the switch off the address is not even looked up.
 */
export async function countryToStore(enabled: boolean, ip: string): Promise<string | null> {
  if (!enabled) return null;
  const country = await countryOf(ip);
  return country === UNKNOWN_COUNTRY ? null : country;
}

// ------------------------------------------------------------ reading

export type LocationRow = { code: string; name: string; count: Count };
export type LocationsSummary = {
  days: number;
  /** Visits in the range that have a recorded country, rounded. */
  total: Count;
  /** Largest first. Each count is rounded: under 10 is "fewer than 10", never a small exact number. */
  rows: LocationRow[];
};

/**
 * Visits per country from stored codes. Counts under 10 become "fewer than 10" and larger ones
 * are rounded to two significant figures, the same rule the public stats use, so a quiet country
 * cannot be read as one or two people. Pure.
 */
export function summariseLocations(raw: { code: string | null; visits: number }[], days = 30): LocationsSummary {
  const rows = raw
    .filter((r): r is { code: string; visits: number } => r.code !== null && COUNTRY_CODE.test(r.code) && r.visits > 0)
    .map((r) => ({ code: r.code, name: countryName(r.code), visits: r.visits }))
    .sort((a, b) => b.visits - a.visits || a.name.localeCompare(b.name));
  return {
    days,
    total: roundCount(rows.reduce((n, r) => n + r.visits, 0)),
    rows: rows.map((r) => ({ code: r.code, name: r.name, count: roundCount(r.visits) })),
  };
}

/** Page views per country for the last `days` days, for this project only. Views with no recorded country are left out. */
export async function locationsSummary(
  userId: string,
  projectId: string,
  days = 30,
  now = new Date()
): Promise<LocationsSummary> {
  const project = await getProjectForUser(userId, projectId);
  const db = await getDb();
  const since = new Date(now.getTime() - days * 86_400_000);
  const rows = await db
    .select({ code: schema.pageviews.country, visits: sql<number>`count(*)` })
    .from(schema.pageviews)
    .where(and(eq(schema.pageviews.projectId, project.id), gte(schema.pageviews.at, since), isNotNull(schema.pageviews.country)))
    .groupBy(schema.pageviews.country)
    .orderBy(desc(sql`count(*)`))
    .limit(300);
  return summariseLocations(rows.map((r) => ({ code: r.code, visits: Number(r.visits) })), days);
}
