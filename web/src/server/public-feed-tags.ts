/** The cache tag of the public homepage feed. */
export const PUBLIC_FEED_TAG = "public-feed";

/**
 * Drop the cached homepage feed, so a project that was switched off stops showing at once instead of
 * after the 60 seconds the feed may be kept. Safe to call anywhere: outside the Next server (the
 * worker, the tests) there is no cache to drop, so a failure is ignored and the feed expires on its own.
 */
export async function invalidatePublicFeed(): Promise<boolean> {
  try {
    const { revalidateTag } = await import("next/cache");
    revalidateTag(PUBLIC_FEED_TAG, { expire: 0 });
    return true;
  } catch {
    return false;
  }
}
