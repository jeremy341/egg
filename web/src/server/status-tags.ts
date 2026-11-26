/** The cache tag for one project's public status page, named by its key. */
export const statusTag = (key: string) => `status:${key}`;

/**
 * Drop the cached public status page for a project, if it has one. Safe to
 * call anywhere: outside the Next server (the worker, the tests) there is no
 * cache to drop, so a failure is ignored and the page simply expires on its
 * own within 60 seconds.
 */
export async function invalidateStatusPage(statusKey: string | null | undefined): Promise<boolean> {
  if (!statusKey) return false;
  try {
    const { revalidateTag } = await import("next/cache");
    revalidateTag(statusTag(statusKey), { expire: 0 });
    return true;
  } catch {
    return false;
  }
}
