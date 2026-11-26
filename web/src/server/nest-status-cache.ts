import { cacheLife } from "next/cache";
import { buildNestStatus } from "@/server/nest-status";

/**
 * The public Nest status, built at most once a minute however many people look.
 * It holds only the three targets' public figures and Hack Club's own summary:
 * nothing about a user, a project or a visitor, so sharing it is safe.
 */
export async function getCachedNestStatus() {
  "use cache";
  cacheLife({ stale: 60, revalidate: 60, expire: 3600 });
  return buildNestStatus();
}
