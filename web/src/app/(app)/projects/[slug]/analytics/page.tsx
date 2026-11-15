import { Suspense } from "react";
import { AnalyticsView, type AnalyticsPageProps } from "@/components/analytics-view";
import { AnalyticsSkeleton } from "@/components/skeletons/analytics";

export async function generateMetadata({ params }: AnalyticsPageProps) {
  const { slug } = await params;
  return { title: `${slug} analytics` };
}

export default function ProjectAnalyticsPage(props: AnalyticsPageProps) {
  return (
    <Suspense fallback={<AnalyticsSkeleton />}>
      <AnalyticsView {...props} />
    </Suspense>
  );
}
