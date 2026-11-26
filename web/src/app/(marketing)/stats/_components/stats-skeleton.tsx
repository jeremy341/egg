import {
  LoadingRegion,
  Skeleton,
  SkeletonText,
} from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { CELL, PAD, PLOT_H, SPLIT, SURFACE } from "./layout";
import { Cells } from "./figures";

/** Fixed, not random: server and client must agree. */
const BARS = [
  30, 42, 24, 56, 48, 36, 62, 44, 28, 70, 52, 40, 66, 34, 58, 46, 26, 60, 50,
  38, 72, 54, 32, 64, 44, 30, 56, 48, 40, 68,
];

function SectionHeadSkeleton({ width = "w-24" }: { width?: string }) {
  return (
    <div className="p-5 sm:p-[30px]">
      <Skeleton className={cn("h-9", width)} />
      <SkeletonText size="body" width="w-80" className="mt-3" />
    </div>
  );
}

function BandSkeleton({ width = "w-48" }: { width?: string }) {
  return (
    <div className="border-b px-5 py-3 sm:px-[30px]">
      <SkeletonText size="label" width={width} />
    </div>
  );
}

function StatCell({ i }: { i: number }) {
  return (
    <div className={CELL}>
      <SkeletonText size="body" width={i % 2 ? "w-28" : "w-36"} />
      <div className="mt-3 flex min-h-10 items-center">
        <Skeleton className="h-7 w-24" />
      </div>
      <SkeletonText size="caption" width="w-full" className="mt-2" />
    </div>
  );
}

function MeasureBlock() {
  return (
    <div className={PAD}>
      <SkeletonText size="body" width="w-40" />
      <div className="mt-3 flex min-h-10 items-center">
        <Skeleton className="h-8 w-20" />
      </div>
      <SkeletonText size="caption" width="w-full" lines={2} className="mt-2" />
    </div>
  );
}

/** Same surface, bands, cells and bar area as the page, so nothing moves when the figures arrive. */
export function StatsSkeleton() {
  return (
    <LoadingRegion label="Loading stats…">
      <div className={SURFACE} aria-hidden="true">
        <div className="divide-y">
          <SectionHeadSkeleton />

          <div className={PAD}>
            <SkeletonText size="body" width="w-52" />
            <Skeleton className="mt-4 h-16 w-40 lg:h-24" />
            <div className="mt-8 border-t pt-8">
              <div className="flex flex-col gap-1">
                <SkeletonText size="body" width="w-36" />
                <SkeletonText size="caption" width="w-28" />
              </div>
              <div className="mt-4 grid grid-cols-[2.25rem_minmax(0,1fr)] gap-x-2">
                <div className={cn("flex flex-col justify-between", PLOT_H)}>
                  <Skeleton className="h-3 w-full" />
                  <Skeleton className="h-3 w-3 self-end" />
                </div>
                <div
                  className={cn(
                    "flex items-end gap-[2px] border-b sm:gap-[3px]",
                    PLOT_H,
                  )}
                >
                  {BARS.map((h, i) => (
                    <Skeleton
                      key={i}
                      className="min-w-0 flex-1 rounded-none"
                      style={{ height: `${h}%` }}
                    />
                  ))}
                </div>
                <div />
                <div className="mt-2 flex h-4 justify-between">
                  <Skeleton className="h-3 w-10" />
                  <Skeleton className="h-3 w-20" />
                </div>
              </div>
              <div className="mt-5 flex flex-wrap gap-x-5 gap-y-1.5">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-4 w-48" />
                <Skeleton className="h-4 w-24" />
              </div>
              <div className="mt-6 border-t pt-3">
                <div className="flex h-10 items-center sm:h-[34px]">
                  <Skeleton className="h-4 w-48" />
                </div>
              </div>
            </div>
          </div>

          <div>
            <BandSkeleton width="w-16" />
            <Cells className="sm:grid-cols-2 lg:grid-cols-5">
              {[0, 1, 2, 3, 4].map((i) => (
                <StatCell key={i} i={i} />
              ))}
            </Cells>
          </div>

          <div className={cn("grid lg:grid-cols-2", SPLIT)}>
            <div>
              <BandSkeleton />
              <div className={PAD}>
                <div className="mt-3 flex min-h-10 items-center">
                  <Skeleton className="h-8 w-40" />
                </div>
                <SkeletonText
                  size="caption"
                  width="w-full"
                  lines={2}
                  className="mt-2"
                />
              </div>
            </div>
            <div>
              <BandSkeleton width="w-40" />
              <Cells className="sm:grid-cols-2">
                {[0, 1].map((i) => (
                  <StatCell key={i} i={i} />
                ))}
              </Cells>
            </div>
          </div>
        </div>

        {["w-40", "w-52"].map((w, n) => (
          <div key={w} className="divide-y">
            <SectionHeadSkeleton width={w} />
            {n === 0 ? (
              <>
                <div>
                  <BandSkeleton width="w-64" />
                  <Cells className="sm:grid-cols-3">
                    {[0, 1, 2].map((i) => (
                      <StatCell key={i} i={i} />
                    ))}
                  </Cells>
                </div>
                <div className={cn("grid lg:grid-cols-3", SPLIT)}>
                  <MeasureBlock />
                  <MeasureBlock />
                  <MeasureBlock />
                </div>
              </>
            ) : (
              <div
                className={cn(
                  "grid lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]",
                  SPLIT,
                )}
              >
                <div className={PAD}>
                  <SkeletonText size="body" width="w-44" />
                  <Skeleton className={cn("mt-4 w-full", PLOT_H)} />
                </div>
                <div className="divide-y">
                  <div>
                    <BandSkeleton width="w-56" />
                    <Cells className="sm:grid-cols-2">
                      {[0, 1].map((i) => (
                        <StatCell key={i} i={i} />
                      ))}
                    </Cells>
                  </div>
                  <MeasureBlock />
                </div>
              </div>
            )}
          </div>
        ))}

        <div className="grid max-lg:divide-y lg:grid-cols-[minmax(0,4fr)_minmax(0,8fr)] lg:divide-x">
          <div className={PAD}>
            <Skeleton className="h-9 w-48" />
          </div>
          <div className={PAD}>
            <SkeletonText
              size="body"
              width="w-full"
              lines={5}
              className="max-w-[65ch]"
            />
          </div>
        </div>
      </div>
    </LoadingRegion>
  );
}
