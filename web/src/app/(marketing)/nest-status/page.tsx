import { Suspense } from "react";
import { connection } from "next/server";
import { LoadingRegion, Skeleton, SkeletonText } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { getCachedNestStatus } from "@/server/nest-status-cache";
import { PAD, SURFACE, WRAP } from "../stats/_components/layout";
import { NestStatusView } from "./_components/view";

export const metadata = {
  title: "Nest status",
  description:
    "Whether Egg can reach Nest, checked every minute from Egg's server, with the last 30 days. Hack Club's own status is shown beside it, and is not part of these checks.",
};

async function Body() {
  // Request time, not build time: the figures come from the database.
  await connection();
  const status = await getCachedNestStatus();
  return <NestStatusView status={status} />;
}

function Loading() {
  return (
    <LoadingRegion label="Loading Nest status…">
      <div className={SURFACE} aria-hidden="true">
        <div className={PAD}>
          <Skeleton className="h-9 w-72" />
          <SkeletonText size="body" width="w-full" className="mt-3 max-w-[65ch]" />
        </div>
        {[0, 1, 2].map((i) => (
          <div key={i} className={PAD}>
            <SkeletonText size="title-3" width="w-40" />
            <Skeleton className="mt-4 h-6 w-48" />
            <Skeleton className="mt-5 h-6 w-full" />
          </div>
        ))}
      </div>
    </LoadingRegion>
  );
}

export default function NestStatusPage() {
  return (
    <>
      <header className={cn(WRAP, "pt-14 pb-10 lg:pt-20 lg:pb-12")}>
        <h1 className="font-pixel text-docs-h1 text-foreground max-sm:text-[44px] max-sm:leading-12">Nest status</h1>
        <p className="mt-5 max-w-[56ch] text-docs-lead text-muted-foreground">
          Whether Egg can reach Nest, checked every minute, with the last 30 days.
        </p>
      </header>
      <div className={cn(WRAP, "pb-20 lg:pb-28")}>
        <Suspense fallback={<Loading />}>
          <Body />
        </Suspense>
      </div>
    </>
  );
}
