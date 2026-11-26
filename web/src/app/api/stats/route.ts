import type { NextRequest } from "next/server";
import { connection } from "next/server";
import { jsonWithEtag } from "@/server/etag";
import { getPublicStats } from "@/server/stats-cache";

/**
 * Public, aggregate usage figures. Counts and totals only, already rounded in
 * server/stats.ts: nothing here names a person or a project. Anyone may read
 * it, so there is no sign-in and no cookie, and browsers and CDNs may keep it
 * for five minutes. An ETag lets a client that already has the figures get an
 * empty 304 instead of the body.
 */
export async function GET(req: NextRequest) {
  await connection();
  const stats = await getPublicStats();
  return jsonWithEtag(req, stats, "public, max-age=300");
}
