import { cacheLife, cacheTag } from "next/cache";
import { buildPublicFeed, type FeedRow } from "@/server/public-feed";
import { PUBLIC_FEED_TAG } from "@/server/public-feed-tags";

/**
 * The homepage feed, built at most once a minute however many people look. It holds only the fields
 * of FeedRow, the same for every visitor, so sharing it is safe. If anything goes wrong the feed is
 * empty (and the homepage shows its sample list); an empty answer is kept for the same minute.
 * Tagged so that switching a project off drops it at once.
 */
export async function getPublicFeed(): Promise<FeedRow[]> {
  "use cache";
  cacheLife({ stale: 60, revalidate: 60, expire: 3600 });
  cacheTag(PUBLIC_FEED_TAG);
  try {
    return await buildPublicFeed();
  } catch (err) {
    console.warn("public feed failed", err instanceof Error ? err.message : err);
    return [];
  }
}
