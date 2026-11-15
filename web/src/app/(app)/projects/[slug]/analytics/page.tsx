import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChartLineUpIcon } from "@phosphor-icons/react/dist/ssr";
import { AnalyticsChart } from "@/components/analytics-chart";
import { AnalyticsFeatures } from "@/components/analytics-features";
import { ClicksCard, FunnelCard, TimeCard } from "@/components/analytics-insights";
import { AnalyticsSetup } from "@/components/analytics-setup";
import { TopList } from "@/components/analytics-top-list";
import { Stagger } from "@/components/motion/stagger";
import { PageHeader } from "@/components/page-header";
import { DocsLink } from "@/components/settings-ui";
import { AnalyticsSkeleton } from "@/components/skeletons/analytics";
import { buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { requireUser } from "@/server/auth/current";
import { analyticsSummary, snippet } from "@/server/analytics";
import { getFeatures } from "@/server/analytics-config";
import { clicksSummary, timeSummary } from "@/server/analytics-events";
import { funnelSummary } from "@/server/analytics-funnel";
import { projectViews } from "@/server/queries";
import { cn } from "@/lib/utils";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props) {
  const { slug } = await params;
  return { title: `${slug} analytics` };
}

const number = new Intl.NumberFormat("en");

function Stat({
  label,
  value,
  note,
  lead = false,
}: {
  label: string;
  value: string;
  note?: string;
  /** The number the page is about: set larger than its neighbour. */
  lead?: boolean;
}) {
  return (
    <div className="rounded-lg bg-card p-4 shadow-border-small">
      <p className="text-label text-muted-foreground">{label}</p>
      <p
        className={
          lead
            ? "tabular mt-1 text-[44px] leading-[48px] font-semibold tracking-[-0.03em]"
            : "tabular mt-1 text-stat"
        }
      >
        {value}
      </p>
      {note ? <p className="mt-1 text-caption text-muted-foreground">{note}</p> : null}
    </div>
  );
}

async function Content({ params }: Props) {
  const { slug } = await params;
  const user = await requireUser();
  const project = (await projectViews(user.id)).find((p) => p.slug === slug);
  if (!project) notFound();
  const on = Boolean(project.analyticsKey);
  const features = await getFeatures(project.id);
  // Only what the owner switched on is read, so a project with everything off does no extra work.
  const [summary, clicks, time, funnel] = await Promise.all([
    analyticsSummary(user.id, project.id, 30),
    features.clicks ? clicksSummary(user.id, project.id, 30) : null,
    features.time ? timeSummary(user.id, project.id, 30) : null,
    features.funnel ? funnelSummary(user.id, project.id, 30) : null,
  ]);

  return (
    <div className="motion-enter space-y-6">
      <PageHeader
        className="max-sm:gap-y-0"
        title="Analytics"
        description={`Visits to ${project.name} over the last 30 days, counted by a script on your site.`}
        actions={<DocsLink href="/docs/analytics" topic="analytics" className="max-sm:hidden" />}
      />

      {summary.views === 0 ? (
        <EmptyState
          icon={<ChartLineUpIcon />}
          title={on ? "Nothing counted yet" : "Analytics is off"}
          description={
            on
              ? "Add the snippet below to your site, redeploy, and visit a page."
              : "Turn it on below to get a snippet for your site."
          }
          action={
            on ? undefined : (
              <Link href="#analytics-setup" className={cn(buttonVariants({ variant: "outline" }))}>
                Set up analytics
              </Link>
            )
          }
        />
      ) : (
        <>
          <Stagger as="div" className="grid gap-4 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            <Stat lead label="Page views" value={number.format(summary.views)} />
            <Stat
              label="Visitors"
              value={number.format(summary.visitors)}
              note="Counted per day. Someone who visits on two days counts twice."
            />
          </Stagger>
          <AnalyticsChart daily={summary.daily} />
          <div className="grid gap-4 md:grid-cols-2">
            <TopList
              title="Top pages"
              rows={summary.pages.map((p) => ({ label: p.path, views: p.views }))}
              empty="No pages yet."
            />
            <TopList
              title="Where visitors came from"
              rows={summary.referrers.map((r) => ({ label: r.host, views: r.views }))}
              empty="Most visits had no referring site."
            />
          </div>
        </>
      )}

      {funnel ? <FunnelCard summary={funnel} /> : null}
      {clicks || time ? (
        <div className="grid gap-4 md:grid-cols-2">
          {time ? <TimeCard summary={time} /> : null}
          {clicks ? <ClicksCard summary={clicks} /> : null}
        </div>
      ) : null}

      <AnalyticsSetup
        projectId={project.id}
        initialSnippet={project.analyticsKey ? snippet(project.analyticsKey) : null}
      />
      {on ? <AnalyticsFeatures projectId={project.id} initial={features} /> : null}
    </div>
  );
}

export default function ProjectAnalyticsPage({ params }: Props) {
  return (
    <Suspense fallback={<AnalyticsSkeleton />}>
      <Content params={params} />
    </Suspense>
  );
}
