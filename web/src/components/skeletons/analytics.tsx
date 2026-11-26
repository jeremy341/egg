import {
  LoadingRegion,
  Skeleton,
  SkeletonCard,
  SkeletonPageHeader,
  SkeletonText,
} from "@/components/ui/skeleton";

/** Fixed bar widths (percent), longest first like a ranked list, so the server and client markup match. */
const BAR_WIDTHS = [92, 64, 41, 38, 36, 33];

/** The header of a chart card: its title and one-sentence summary on the left, the Export button on the right. */
function ChartHeader() {
  return (
    <div className="flex items-start justify-between gap-3 border-b px-4 py-3">
      <div className="min-w-0">
        <SkeletonText size="title-3" width="w-36" />
        <SkeletonText size="label" width="w-64" className="mt-0.5 max-w-full" />
      </div>
      <Skeleton className="h-7 w-20 shrink-0 max-sm:h-10" />
    </div>
  );
}

/** /projects/[slug]/analytics, Overview tab: the tab bar, two totals, the daily chart and two ranked bar charts. */
export function AnalyticsSkeleton() {
  return (
    <LoadingRegion label="Loading analytics…" className="space-y-6">
      <SkeletonPageHeader description />

      <div className="flex h-11 items-center gap-6 border-b px-3" aria-hidden="true">
        {["w-16", "w-28", "w-12", "w-14", "w-10"].map((w, i) => (
          <SkeletonText key={i} size="body" width={w} />
        ))}
      </div>

      <div className="grid gap-4 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        {[0, 1].map((i) => (
          <SkeletonCard key={i} className="p-4">
            <SkeletonText size="label" width="w-20" />
            <div className={i === 0 ? "mt-1 flex h-12 items-center" : "mt-1 flex h-10 items-center"}>
              <Skeleton className={i === 0 ? "h-9 w-32" : "h-8 w-24"} />
            </div>
          </SkeletonCard>
        ))}
      </div>

      <SkeletonCard>
        <ChartHeader />
        <div className="p-4">
          <Skeleton className="h-44 w-full" />
          <SkeletonText size="caption" width="w-40" className="mt-2" />
        </div>
      </SkeletonCard>

      <div className="grid gap-4 md:grid-cols-2">
        {[0, 1].map((c) => (
          <SkeletonCard key={c}>
            <ChartHeader />
            <div className="flex flex-col gap-3 p-4">
              {BAR_WIDTHS.slice(0, c === 0 ? 6 : 4).map((w, i) => (
                <div key={i} className="grid grid-cols-[7rem_minmax(0,1fr)] items-center gap-2">
                  <SkeletonText size="label" width="w-20" className="justify-self-end" />
                  <Skeleton className="h-5 rounded-[3px]" style={{ width: `${w}%` }} />
                </div>
              ))}
            </div>
          </SkeletonCard>
        ))}
      </div>
    </LoadingRegion>
  );
}
