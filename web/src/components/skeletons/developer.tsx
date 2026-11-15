import { LoadingRegion, Skeleton, SkeletonCard, SkeletonText, skeletonWidth } from "@/components/ui/skeleton";

/** A group's title and count on the left, its note on the right, as GroupHeading lays them out. */
function GroupHeadingSkeleton({ title = "w-16", note = "w-28" }: { title?: string; note?: string }) {
  return (
    <div className="mb-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-0.5">
      <SkeletonText size="body" width={title} />
      <SkeletonText size="label" width={note} />
    </div>
  );
}

/**
 * The token list while it loads: the Active heading, then rows in one card.
 * Each row has a name and status, the prefix, Edit and Revoke, and the four
 * facts (permissions, created, last used, expiry).
 */
export function TokenListSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div aria-hidden="true">
      <GroupHeadingSkeleton />
      <SkeletonCard>
        <div className="hairline-y">
          {Array.from({ length: rows }, (_, i) => (
            <div key={i} className="px-4 py-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-3">
                    <SkeletonText size="body" width={skeletonWidth(i + 2)} />
                    <SkeletonText size="label" width="w-14" />
                  </div>
                  <SkeletonText size="caption" width="w-24" className="mt-0.5" />
                </div>
                <div className="flex shrink-0 gap-1.5">
                  <Skeleton className="h-7 w-11 max-sm:h-10" />
                  <Skeleton className="h-7 w-16 max-sm:h-10" />
                </div>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2.5 sm:grid-cols-4">
                {[0, 1, 2, 3].map((j) => (
                  <div key={j}>
                    <SkeletonText size="caption" width="w-14" />
                    <SkeletonText size="label" width="w-20" className="mt-0.5" />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </SkeletonCard>
    </div>
  );
}

/** The right column: heading, two addresses, the first call and three docs links. */
function HubSkeleton() {
  return (
    <div aria-hidden="true">
      <SkeletonText size="body" width="w-44" className="mb-2" />
      <SkeletonCard>
        <div className="hairline-y">
          {[0, 1].map((i) => (
            <div key={i} className="flex items-start gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <SkeletonText size="caption" width="w-14" />
                <SkeletonText size="label" width="w-full" lines={2} className="mt-0.5" />
              </div>
              <Skeleton className="h-7 w-16 max-sm:h-10" />
            </div>
          ))}
        </div>
        <div className="border-t px-4 py-3">
          <SkeletonText size="caption" width="w-16" />
          <SkeletonText size="label" width="w-full" lines={3} className="mt-0.5 mb-3" />
          <Skeleton className="h-28 w-full" />
        </div>
        <div className="hairline-y border-t">
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex min-h-10 items-center px-4 py-2 max-sm:min-h-11">
              <SkeletonText size="label" width={skeletonWidth(i + 3)} />
            </div>
          ))}
        </div>
      </SkeletonCard>
    </div>
  );
}

/** /developer, as the real page lays it out: header with Create token, the token list, and the addresses card. */
export function DeveloperSkeleton() {
  return (
    <LoadingRegion label="Loading developer settings…">
      <div aria-hidden="true" className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <SkeletonText size="title-1" width="w-40" />
          <SkeletonText size="body" width="w-full" lines={2} className="mt-1 w-[min(64ch,100%)] max-sm:w-full" />
        </div>
        <Skeleton className="h-8 w-32 max-sm:h-10 max-sm:w-full" />
      </div>
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start lg:gap-6">
        <TokenListSkeleton />
        <HubSkeleton />
      </div>
    </LoadingRegion>
  );
}
