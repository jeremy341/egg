import { cacheLife, cacheTag } from "next/cache";
import { publicStatus } from "@/server/status-page";
import { statusTag } from "@/server/status-tags";

/**
 * The public status page data, kept for 60 seconds however many people look.
 * It holds one project's public figures and nothing about any signed-in user,
 * so sharing it between visitors is safe. Tagged with the page's key so the
 * monitor, and switching the page off, can drop it early.
 */
export async function getCachedPublicStatus(key: string) {
  "use cache";
  cacheLife({ stale: 60, revalidate: 60, expire: 3600 });
  cacheTag(statusTag(key));
  return publicStatus(key);
}
