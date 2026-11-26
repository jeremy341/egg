import type { ReactNode } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChartLineUpIcon } from "@phosphor-icons/react/dist/ssr";
import {
  AnalyticsChartBklit,
  CampaignsBklit,
  ClicksBklit,
  ErrorsBklit,
  EventsBklit,
  FunnelBklit,
  PagesBklit,
  ReferrersBklit,
  RetentionBklit,
  SpeedBklit,
  TimeBklit,
} from "@/components/analytics-bklit-cards";
import { LocationsBklit } from "@/components/analytics-locations-card";
import { AnalyticsFeatures } from "@/components/analytics-features";
import { LiveCard } from "@/components/analytics-live";
import { AnalyticsSetup } from "@/components/analytics-setup";
import { AnalyticsTabs } from "@/components/analytics-tabs";
import { Stagger } from "@/components/motion/stagger";
import { PageHeader } from "@/components/page-header";
import { DocsLink } from "@/components/settings-ui";
import { buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { parseTab, type AnalyticsTab } from "@/lib/analytics-tabs";
import { cn } from "@/lib/utils";
import { requireUser } from "@/server/auth/current";
import { analyticsSummary, campaignsSummary, snippet } from "@/server/analytics";
import { getFeatures, type AnalyticsFeatures as FeatureSwitches } from "@/server/analytics-config";
import { clicksSummary, eventsSummary, timeSummary } from "@/server/analytics-events";
import { locationsSummary } from "@/server/analytics-locations";
import { funnelSummary } from "@/server/analytics-funnel";
import { liveSummary, retentionSummary } from "@/server/analytics-retention";
import { errorsSummary, speedSummary } from "@/server/analytics-speed";
import { projectViews } from "@/server/queries";
import { worldShapes } from "@/server/world-map";

export type AnalyticsPageProps = {
  params: Promise<{ slug: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

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

/** Shown on a tab whose switch is off, with the way to turn it on. */
function Off({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-lg bg-card p-4 text-muted-foreground shadow-border-small">
      {children}{" "}
      <Link href="?tab=setup" className="text-foreground underline underline-offset-2">
        Open Setup
      </Link>
      .
    </p>
  );
}

type Context = { userId: string; projectId: string; on: boolean; features: FeatureSwitches };

/** Page views, visitors, the chart, top pages, referrers and campaigns, with the live view above them. */
async function Overview({ userId, projectId, on, features }: Context) {
  const [summary, campaigns, live, locations] = await Promise.all([
    analyticsSummary(userId, projectId, 30),
    features.campaigns ? campaignsSummary(userId, projectId, 30) : null,
    features.live ? liveSummary(userId, projectId) : null,
    features.locations ? locationsSummary(userId, projectId, 30) : null,
  ]);
  return (
    <>
      {live ? <LiveCard summary={live} /> : null}

      {summary.views === 0 ? (
        <EmptyState
          icon={<ChartLineUpIcon />}
          title={on ? "Nothing counted yet" : "Analytics is off"}
          description={
            on
              ? "Add the snippet from the Setup tab to your site, redeploy, and visit a page."
              : "Turn it on in the Setup tab to get a snippet for your site."
          }
          action={
            on ? undefined : (
              <Link href="?tab=setup" className={cn(buttonVariants({ variant: "outline" }))}>
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
          <AnalyticsChartBklit daily={summary.daily} projectId={projectId} />
          <div className="grid gap-4 md:grid-cols-2">
            <PagesBklit rows={summary.pages.map((p) => ({ label: p.path, views: p.views }))} projectId={projectId} />
            {features.referrers || summary.referrers.length ? (
              <ReferrersBklit
                rows={summary.referrers.map((r) => ({ label: r.host, views: r.views }))}
                projectId={projectId}
              />
            ) : null}
          </div>
          {campaigns ? <CampaignsBklit summary={campaigns} projectId={projectId} /> : null}
          <LocationsBklit summary={locations} shapes={worldShapes()} />
        </>
      )}
    </>
  );
}

/** Page speed and JavaScript errors. Both come from the one "Speed and errors" switch. */
async function Speed({ userId, projectId, features }: Context) {
  if (!features.vitals) return <Off>Speed and errors is off.</Off>;
  const [speed, errors] = await Promise.all([
    speedSummary(userId, projectId, 30),
    errorsSummary(userId, projectId, 30),
  ]);
  return (
    <>
      <SpeedBklit summary={speed} projectId={projectId} />
      <ErrorsBklit summary={errors} projectId={projectId} />
    </>
  );
}

/** The funnel, time on page, clicks and custom events. */
async function Events({ userId, projectId, features }: Context) {
  const [funnel, time, clicks, events] = await Promise.all([
    features.funnel ? funnelSummary(userId, projectId, 30) : null,
    features.time ? timeSummary(userId, projectId, 30) : null,
    features.clicks ? clicksSummary(userId, projectId, 30) : null,
    features.events ? eventsSummary(userId, projectId, 30) : null,
  ]);
  if (!funnel && !time && !clicks && !events) {
    return <Off>Custom events, clicks, time on page and funnels are off.</Off>;
  }
  return (
    <>
      {funnel ? <FunnelBklit summary={funnel} projectId={projectId} /> : null}
      {clicks || time ? (
        <div className="grid gap-4 md:grid-cols-2">
          {time ? <TimeBklit summary={time} projectId={projectId} /> : null}
          {clicks ? <ClicksBklit summary={clicks} projectId={projectId} /> : null}
        </div>
      ) : null}
      {events ? <EventsBklit summary={events} projectId={projectId} /> : null}
    </>
  );
}

/** Who is on the site now and who comes back. */
async function Visitors({ userId, projectId, features }: Context) {
  const [live, retention] = await Promise.all([
    features.live ? liveSummary(userId, projectId) : null,
    features.retention ? retentionSummary(userId, projectId) : null,
  ]);
  if (!live && !retention) return <Off>The live view and returning visitors are off.</Off>;
  return (
    <>
      {live ? <LiveCard summary={live} /> : null}
      {retention ? <RetentionBklit summary={retention} projectId={projectId} /> : null}
    </>
  );
}

/**
 * The project analytics page. Every chart on it is a Bklit UI chart from
 * `analytics-bklit-cards`; the live view is two figures and stays a card of
 * numbers. Only the selected tab's data is read.
 */
export async function AnalyticsView({ params, searchParams }: AnalyticsPageProps) {
  const { slug } = await params;
  const tab: AnalyticsTab = parseTab((await searchParams)?.tab);
  const user = await requireUser();
  const project = (await projectViews(user.id)).find((p) => p.slug === slug);
  if (!project) notFound();
  const on = Boolean(project.analyticsKey);
  const features = await getFeatures(project.id);
  const ctx: Context = { userId: user.id, projectId: project.id, on, features };

  return (
    <div className="motion-enter space-y-6">
      <PageHeader
        className="max-sm:gap-y-0"
        title="Analytics"
        description={`Visits to ${project.name} over the last 30 days, counted by a script on your site.`}
        actions={<DocsLink href="/docs/analytics" topic="analytics" className="max-sm:hidden" />}
      />
      <AnalyticsTabs value={tab}>
        {tab === "overview" ? <Overview {...ctx} /> : null}
        {tab === "speed" ? <Speed {...ctx} /> : null}
        {tab === "events" ? <Events {...ctx} /> : null}
        {tab === "visitors" ? <Visitors {...ctx} /> : null}
        {tab === "setup" ? (
          <>
            <AnalyticsSetup
              projectId={project.id}
              initialSnippet={project.analyticsKey ? snippet(project.analyticsKey) : null}
            />
            {on ? <AnalyticsFeatures projectId={project.id} initial={features} /> : null}
          </>
        ) : null}
      </AnalyticsTabs>
    </div>
  );
}
