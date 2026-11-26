import type { NextRequest } from "next/server";
import { connection } from "next/server";
import { jsonWithEtag } from "@/server/etag";
import { getCachedNestStatus } from "@/server/nest-status-cache";

/**
 * Public and read-only: whether Egg can reach Nest, the last 30 days as a daily
 * strip, and Hack Club's own summary beside it. It carries no user or project
 * data and has no sign-in or cookie. Visitors cannot start a check: the worker
 * runs them on a fixed schedule. Kept for 60 seconds, with an ETag so a client
 * that already has the figures gets an empty 304.
 */
export async function GET(req: NextRequest) {
  await connection();
  const status = await getCachedNestStatus();
  return jsonWithEtag(req, status, "public, max-age=60");
}
