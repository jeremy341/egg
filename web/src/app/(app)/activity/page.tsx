import { Suspense } from "react";
import { ActivityView } from "@/components/activity-view";
import { PageHeader } from "@/components/page-header";
import { ActivityBodySkeleton } from "@/components/skeletons/activity";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { requireUser } from "@/server/auth/current";
import { PAGE_SIZE, parseFilters, serializeFilters } from "@/server/activity";
import { queryActivity } from "@/server/activity-query";

export const metadata = { title: "Activity" };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default function ActivityPage({ searchParams }: Props) {
  return (
    <div className="motion-enter">
      <PageHeader
        title="Activity"
        description="Changes to your projects, domains and servers, newest first. Times are UTC."
        actions={
          <Suspense fallback={null}>
            <ExportCsv searchParams={searchParams} />
          </Suspense>
        }
      />
      <Suspense fallback={<ActivityBodySkeleton />}>
        <ActivityContent searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

/** Filters come from the URL, so a filtered view can be bookmarked. The server applies them. */
async function ActivityContent({ searchParams }: Props) {
  const user = await requireUser();
  const filters = parseFilters(await searchParams);
  const page = await queryActivity(user.id, filters, { limit: PAGE_SIZE, now: new Date() });
  return <ActivityView filters={filters} initial={page} />;
}

/** A plain download link, no script. It carries the filters in the URL, so the file matches what the list shows. */
async function ExportCsv({ searchParams }: Props) {
  const query = serializeFilters(parseFilters(await searchParams));
  return (
    <div className="flex flex-col items-start gap-1 max-sm:w-full">
      <a
        href={`/api/activity/export${query ? `?${query}` : ""}`}
        download
        className={cn(buttonVariants({ variant: "outline" }), "px-3 max-sm:w-full")}
      >
        Export CSV
      </a>
      <p className="text-xs text-muted-foreground">
        Up to 5,000 entries with these filters. Secrets are left out.
      </p>
    </div>
  );
}
