import {
  LoadingRegion,
  Skeleton,
  SkeletonCard,
  SkeletonText,
} from "@/components/ui/skeleton";

function CardBody({ children }: { children: React.ReactNode }) {
  return (
    <div className="p-5">
      <SkeletonText size="title-2" width="w-32" />
      <SkeletonText size="body" width="w-full" className="mt-1" />
      <div className="mt-4">{children}</div>
    </div>
  );
}

/** /settings: the title, then the four groups with their first control. */
export function SettingsSkeleton() {
  return (
    <LoadingRegion label="Loading settings…" className="mx-auto max-w-[720px]">
      <div className="mb-6">
        <Skeleton className="h-9 w-40" />
        <SkeletonText size="body" width="w-72" className="mt-1" />
      </div>
      <div className="space-y-6">
        <SkeletonCard footer>
          <CardBody>
            <SkeletonText size="label" width="w-28" className="mb-1.5" />
            <Skeleton className="h-9 w-full max-w-[360px] max-sm:h-10" />
          </CardBody>
        </SkeletonCard>
        <SkeletonCard footer>
          <CardBody>
            <Skeleton className="h-8 w-52 max-sm:h-10" />
          </CardBody>
        </SkeletonCard>
        <SkeletonCard footer>
          <CardBody>
            <Skeleton className="h-9 w-full max-w-[360px] max-sm:h-10" />
          </CardBody>
        </SkeletonCard>
        <SkeletonCard footer>
          <CardBody>
            <Skeleton className="h-8 w-52 max-sm:h-10" />
          </CardBody>
        </SkeletonCard>
      </div>
    </LoadingRegion>
  );
}
