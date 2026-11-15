"use client";

import type { ReactNode } from "react";
import { ExportMenu, type ExportTarget } from "@/components/analytics-export-menu";
import {
  BklitBars,
  BklitSeries,
  CHART_PRIMARY as PRIMARY,
  CHART_SECOND as SECOND,
  ChartFrame,
  type BarRow,
  type DayRow,
  type SeriesSpec,
  type Table,
} from "@/components/charts/bklit-kit";
import {
  BAND_COLOURS,
  bandRows,
  cohortRows,
  dayPoints,
  describeBands,
  describeCohorts,
  describeExtremes,
  describeLargest,
  describeReturning,
  medianRows,
  number,
  uniqueLabels,
  type Cohort,
  type Unit,
} from "@/components/charts/bklit-summaries";
import { formatDay, plural, summarise, type Day } from "@/components/charts/bklit-visits";
import { RETENTION_NOTICE } from "@/lib/analytics-defaults";
import { MIN_DAILY_REPORTS, VITAL_THRESHOLDS, formatVital } from "@/server/analytics-fields";
import type { CampaignsSummary } from "@/server/analytics";
import type { ClicksSummary, EventsSummary, TimeSummary } from "@/server/analytics-events";
import type { FunnelSummary } from "@/server/analytics-funnel";
import type { RetentionSummary } from "@/server/analytics-retention";
import type { ErrorsSummary, SpeedSummary } from "@/server/analytics-speed";

/**
 * Every chart card of the analytics page. A card takes one summary from the server, plus the
 * project id for its Export menu. Each one gives its chart a title, one sentence, and a table of
 * the same numbers, and says plainly when there is nothing to draw.
 */

const lastSeen = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "UTC",
});

const VIEWS: SeriesSpec = { key: "views", label: "Page views", color: PRIMARY };
const VISITORS: SeriesSpec = { key: "visitors", label: "Visitors", color: SECOND };

type Props<S> = { summary: S; projectId: string };

function target(projectId: string, tab: ExportTarget["tab"], card: string): ExportTarget {
  return { projectId, tab, card };
}

// ------------------------------------------------------------ building blocks

type RankedRow = {
  label: string;
  value: number;
  /** Text for the table only, one per `extraHeader`: a file and line, a share, a drop-off. */
  extra?: string | string[];
};

const list = (value: string | string[] | undefined): string[] =>
  value === undefined ? [] : Array.isArray(value) ? value : [value];

/** Categories as bars (horizontal by default), with the largest named in the sentence. */
function RankedBars({
  title,
  rows,
  unit,
  seriesLabel,
  empty,
  summary,
  categoryHeader = "Name",
  extraHeader,
  orientation = "horizontal",
  exportTarget,
  labelWidth,
  level = 2,
  note,
}: {
  title: string;
  rows: RankedRow[];
  unit: Unit;
  seriesLabel: string;
  empty: string;
  summary?: string;
  categoryHeader?: string;
  extraHeader?: string | string[];
  orientation?: "horizontal" | "vertical";
  exportTarget?: ExportTarget;
  labelWidth?: number;
  level?: 2 | 3;
  note?: ReactNode;
}) {
  const labels = uniqueLabels(rows.map((r) => r.label));
  const series: SeriesSpec = { key: "value", label: seriesLabel, color: PRIMARY };
  const chartRows: BarRow[] = rows.map((r, i) => ({ label: labels[i], values: { value: r.value } }));
  const points = rows.map((r, i) => ({ label: labels[i], value: r.value }));
  const extraHeaders = list(extraHeader);
  const table: Table = {
    caption: `${title}: ${seriesLabel.toLowerCase()} for each ${categoryHeader.toLowerCase()}`,
    headers: [categoryHeader, ...extraHeaders, seriesLabel],
    rows: rows.map((r, i) => {
      const extras = list(r.extra);
      return [labels[i], ...extraHeaders.map((_, n) => extras[n] ?? ""), number.format(r.value)];
    }),
  };
  return (
    <ChartFrame
      title={title}
      level={level}
      summary={summary ?? describeLargest(points, unit, empty)}
      chartLabel={`${orientation === "horizontal" ? "Horizontal bar" : "Bar"} chart: ${title}. ${rows.length} ${rows.length === 1 ? "category" : "categories"}.`}
      empty={rows.length === 0 ? empty : null}
      table={table}
      exportTarget={exportTarget}
      note={note}
    >
      <BklitBars rows={chartRows} series={[series]} orientation={orientation} labelWidth={labelWidth} />
    </ChartFrame>
  );
}

/** Values per day as an area. All zero is said in words instead of drawn as a flat line. */
function DailyArea({
  title,
  rows,
  seriesLabel,
  unit,
  empty,
  exportTarget,
}: {
  title: string;
  rows: { day: string; value: number }[];
  seriesLabel: string;
  unit: Unit;
  empty: string;
  exportTarget?: ExportTarget;
}) {
  const none = rows.every((r) => r.value === 0);
  const series: SeriesSpec = { key: "value", label: seriesLabel, color: PRIMARY };
  const data: DayRow[] = rows.map((r) => ({ day: r.day, value: r.value }));
  return (
    <ChartFrame
      title={title}
      summary={describeExtremes(dayPoints(rows), unit, empty)}
      chartLabel={`Area chart: ${title}, for each of the last ${rows.length} days.`}
      empty={none ? empty : null}
      table={{
        caption: `${title}, for each day`,
        headers: ["Day", seriesLabel],
        rows: rows.map((r) => [formatDay(r.day), number.format(r.value)]),
      }}
      exportTarget={exportTarget}
    >
      <BklitSeries rows={data} area={[series]} line={[]} />
    </ChartFrame>
  );
}

function Panel({ title, id, note, actions, children }: { title: string; id: string; note?: ReactNode; actions?: ReactNode; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="rounded-lg bg-card shadow-border-small">
      <div className="flex items-start justify-between gap-3 border-b px-4 py-3">
        <div className="min-w-0">
          <h2 id={id} className="text-title-3">
            {title}
          </h2>
          {note ? <p className="mt-1 text-caption text-muted-foreground">{note}</p> : null}
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}

// ------------------------------------------------------------ overview

/** Page views as an area and visitors as a line, on the same days and the same axes. */
export function AnalyticsChartBklit({ daily, projectId }: { daily: Day[]; projectId?: string }) {
  const drawn = daily.length >= 2;
  const first = daily[0]?.day;
  const last = daily.at(-1)?.day;
  const rows: DayRow[] = daily.map((d) => ({ day: d.day, views: d.views, visitors: d.visitors }));
  return (
    <ChartFrame
      title="Page views per day"
      summary={`${summarise(daily)}${daily.length > 0 ? " The line is visitors." : ""}`}
      chartLabel={`Area chart of page views and line chart of visitors for each of the last ${daily.length} days, ${first ? formatDay(first) : ""} to ${last ? formatDay(last) : ""}.`}
      empty={daily.length === 0 ? "No days to show." : null}
      table={{
        caption: `Page views and visitors for each day. ${daily.length === 0 ? "" : `${plural(daily.length, "day", "days")}.`}`,
        headers: ["Day", "Page views", "Visitors"],
        rows: daily.map((d) => [formatDay(d.day), number.format(d.views), number.format(d.visitors)]),
      }}
      exportTarget={projectId ? target(projectId, "overview", "daily") : undefined}
      legend={[VIEWS, VISITORS]}
    >
      {drawn ? <BklitSeries rows={rows} area={[VIEWS]} line={[VISITORS]} /> : null}
    </ChartFrame>
  );
}

export function PagesBklit({ rows, projectId }: { rows: { label: string; views: number }[]; projectId: string }) {
  return (
    <RankedBars
      title="Top pages"
      rows={rows.map((r) => ({ label: r.label, value: r.views }))}
      unit={{ one: "view", many: "views" }}
      seriesLabel="Page views"
      categoryHeader="Page"
      empty="No pages yet."
      exportTarget={target(projectId, "overview", "pages")}
    />
  );
}

export function ReferrersBklit({ rows, projectId }: { rows: { label: string; views: number }[]; projectId: string }) {
  return (
    <RankedBars
      title="Where visitors came from"
      rows={rows.map((r) => ({ label: r.label, value: r.views }))}
      unit={{ one: "view", many: "views" }}
      seriesLabel="Page views"
      categoryHeader="Referrer"
      empty="Most visits had no referring site."
      exportTarget={target(projectId, "overview", "referrers")}
    />
  );
}

export function CampaignsBklit({ summary, projectId }: Props<CampaignsSummary>) {
  return (
    <RankedBars
      title="Campaigns"
      rows={summary.rows.map((r) => {
        const via = [r.source, r.medium].filter(Boolean).join(" / ");
        return { label: via ? `${r.campaign} (${via})` : r.campaign, value: r.views };
      })}
      unit={{ one: "view", many: "views" }}
      seriesLabel="Page views"
      categoryHeader="Campaign (source / medium)"
      empty="No campaigns yet. Only values on the Campaigns allowlist in Setup are recorded, so list a campaign there, then add ?utm_campaign=name to a link that points at your site."
      labelWidth={176}
      exportTarget={target(projectId, "overview", "campaigns")}
      note={
        summary.rows.length === 0
          ? undefined
          : `From the utm_source, utm_medium and utm_campaign values in the address. Only values on the Campaigns allowlist are recorded. The last ${summary.days} days.`
      }
    />
  );
}

// ------------------------------------------------------------ speed and errors

const RATING_TEXT = { good: "text-success", "needs-work": "text-warning", poor: "text-destructive" } as const;

function SpeedMetric({ metric, reports, days, projectId }: { metric: SpeedSummary["metrics"][number]; reports: number; days: number; projectId: string }) {
  const [good, poor] = VITAL_THRESHOLDS[metric.metric];
  const id = `speed-${metric.metric}`;
  const bandSeries: SeriesSpec[] = metric.bands.map((b) => ({
    key: b.rating,
    label: b.label,
    color: BAND_COLOURS[b.rating],
  }));
  const bandData: BarRow[] = metric.bands.map((b) => ({
    label: b.label,
    values: { [b.rating]: b.reports },
    tip: {
      [b.rating]: `${plural(b.reports, "report", "reports")}${b.percent === null ? "" : ` (${b.percent}%)`}`,
    },
  }));
  const medianLine: SeriesSpec = { key: "median", label: `Median ${metric.metric.toUpperCase()}`, color: PRIMARY };
  const fmt = (n: number) => formatVital(metric.metric, n);
  const lineRows: DayRow[] = metric.daily.map((d) => ({ day: d.day, median: d.median }));
  const total = metric.bands.reduce((n, b) => n + b.reports, 0);
  return (
    <Panel
      id={id}
      title={`${metric.name} (${metric.metric.toUpperCase()})`}
      note={`Good up to ${fmt(good)}, poor over ${fmt(poor)}${metric.unit === "score" ? " (a score, no unit)" : ""}.`}
      actions={<ExportMenu target={target(projectId, "speed", metric.metric)} label={metric.name} />}
    >
      <dl className="grid gap-3 p-4 sm:grid-cols-3">
        <div className="rounded-md bg-background-subtle p-3">
          <dt className="text-label text-muted-foreground">Median</dt>
          <dd className="tabular mt-1 text-stat">
            {metric.median === null ? <span className="text-base font-normal text-muted-foreground">Not enough data</span> : fmt(metric.median)}
          </dd>
        </div>
        <div className="rounded-md bg-background-subtle p-3">
          <dt className="text-label text-muted-foreground">75th percentile</dt>
          <dd className="tabular mt-1 text-stat">
            {metric.p75 === null || metric.rating === null ? (
              <span className="text-base font-normal text-muted-foreground">Not enough data</span>
            ) : (
              <>
                {fmt(metric.p75)}
                <span className={`ml-2 text-label font-normal ${RATING_TEXT[metric.rating]}`}>{metric.ratingLabel}</span>
              </>
            )}
          </dd>
        </div>
        <div className="rounded-md bg-background-subtle p-3">
          <dt className="text-label text-muted-foreground">Page views reporting</dt>
          <dd className="tabular mt-1 text-stat">{number.format(metric.samples)}</dd>
          <dd className="mt-1 text-caption text-muted-foreground">of {number.format(reports)} in the last {days} days</dd>
        </div>
      </dl>
      <div className="grid gap-6 border-t p-4 lg:grid-cols-2">
        <ChartFrame
          level={3}
          title="Reports by band"
          summary={describeBands(metric.bands)}
          chartLabel={`Bar chart of ${metric.name} reports in the good, needs work and poor bands.`}
          empty={total === 0 ? "No reports of this measurement yet." : null}
          table={{
            caption: `${metric.name} reports in each band, last ${days} days`,
            headers: ["Band", "Range", "Reports", "Share"],
            rows: bandRows(metric.metric, metric.bands),
          }}
        >
          <BklitBars rows={bandData} series={bandSeries} stacked maxLabels={3} />
        </ChartFrame>
        <ChartFrame
          level={3}
          title="Median per day"
          summary={describeExtremes(
            metric.daily.map((d) => ({ label: formatDay(d.day), value: d.median })),
            { one: "report", many: "reports" },
            "",
            fmt
          )}
          chartLabel={`Line chart of the median ${metric.name} for each day with enough reports.`}
          empty={
            metric.daily.length < 2
              ? `Not enough reports per day to draw a line. A day needs at least ${MIN_DAILY_REPORTS} reports.`
              : null
          }
          table={{
            caption: `Median ${metric.name} for each day with at least ${MIN_DAILY_REPORTS} reports`,
            headers: ["Day", "Median", "Reports"],
            rows: medianRows(metric.metric, metric.daily),
          }}
        >
          <BklitSeries rows={lineRows} area={[]} line={[medianLine]} formatValue={fmt} />
        </ChartFrame>
      </div>
    </Panel>
  );
}

/** Each measurement with its bands, median, 75th percentile and day-by-day median. */
export function SpeedBklit({ summary, projectId }: Props<SpeedSummary>) {
  if (summary.reports === 0) {
    return (
      <section className="rounded-lg bg-card p-4 shadow-border-small">
        <h2 className="text-title-3">Speed</h2>
        <p className="mt-2 text-muted-foreground">
          No speed measurements yet. A summary is sent once per page view, when the visitor leaves or switches tab.
        </p>
      </section>
    );
  }
  return (
    <>
      <p className="text-label text-muted-foreground">
        {plural(summary.reports, "page view", "page views")} reported in the last {summary.days} days. The label
        judges the 75th percentile, as Google does. Medians and shares need at least {summary.minimum} reports. Times
        are in milliseconds (ms) or seconds (s). Interaction to Next Paint is the longest interaction on a page.
      </p>
      {summary.metrics.map((m) => (
        <SpeedMetric key={m.metric} metric={m} reports={summary.reports} days={summary.days} projectId={projectId} />
      ))}
    </>
  );
}

/** Errors per day as an area, and the most frequent errors as bars. */
export function ErrorsBklit({ summary, projectId }: Props<ErrorsSummary>) {
  const empty = `No JavaScript errors reported in the last ${summary.days} days.`;
  return (
    <>
      <DailyArea
        title="Errors per day"
        rows={summary.daily.map((d) => ({ day: d.day, value: d.count }))}
        seriesLabel="Errors"
        unit={{ one: "error", many: "errors" }}
        empty={empty}
        exportTarget={target(projectId, "speed", "errors-daily")}
      />
      <RankedBars
        title="Top errors"
        rows={summary.rows.map((r) => ({
          label: r.message,
          value: r.count,
          extra: [`${r.file ?? ""}${r.line ? `, line ${r.line}` : ""}`.replace(/^, /, ""), lastSeen.format(r.lastSeen)],
        }))}
        unit={{ one: "time", many: "times" }}
        seriesLabel="Times"
        categoryHeader="Message"
        extraHeader={["File and line", "Last seen (UTC)"]}
        empty={empty}
        summary={
          summary.rows.length === 0
            ? empty
            : `${plural(summary.total, "error", "errors")} in the last ${summary.days} days, grouped by message, file and line. ${describeLargest(
                summary.rows.map((r) => ({ label: r.message, value: r.count })),
                { one: "time", many: "times" },
                ""
              )}`
        }
        labelWidth={132}
        exportTarget={target(projectId, "speed", "errors")}
      />
    </>
  );
}

// ------------------------------------------------------------ events

export function EventsBklit({ summary, projectId }: Props<EventsSummary>) {
  const empty = "No events yet. They appear when a visitor clicks an element marked with data-egg-track.";
  return (
    <>
      <RankedBars
        title="Events by name"
        rows={summary.byName.map((r) => ({ label: r.name, value: r.count }))}
        unit={{ one: "event", many: "events" }}
        seriesLabel="Events"
        categoryHeader="Name"
        empty={empty}
        summary={
          summary.byName.length === 0
            ? empty
            : `${plural(summary.total, "event", "events")} in the last ${summary.days} days. ${describeLargest(
                summary.byName.map((r) => ({ label: r.name, value: r.count })),
                { one: "event", many: "events" },
                ""
              )}`
        }
        exportTarget={target(projectId, "events", "events-by-name")}
        note={
          summary.byName.length === 0
            ? undefined
            : "Set the value with data-egg-value on the same element (up to 40 plain characters). A funnel step can use the same name."
        }
      />
      {summary.rows.some((r) => r.value !== null) ? (
        <RankedBars
          title="Events by name and value"
          rows={summary.rows.map((r) => ({ label: r.value === null ? r.name : `${r.name}: ${r.value}`, value: r.count }))}
          unit={{ one: "event", many: "events" }}
          seriesLabel="Events"
          categoryHeader="Name and value"
          empty={empty}
          exportTarget={target(projectId, "events", "events")}
          labelWidth={132}
        />
      ) : null}
      <DailyArea
        title="Events per day"
        rows={summary.daily.map((d) => ({ day: d.day, value: d.count }))}
        seriesLabel="Events"
        unit={{ one: "event", many: "events" }}
        empty="No events in the last 30 days."
        exportTarget={target(projectId, "events", "events-daily")}
      />
    </>
  );
}

export function ClicksBklit({ summary }: Props<ClicksSummary>) {
  return (
    <RankedBars
      title="Top clicks"
      rows={summary.rows.map((r) => ({ label: r.label, value: r.clicks }))}
      unit={{ one: "click", many: "clicks" }}
      seriesLabel="Clicks"
      categoryHeader="Label"
      empty="No clicks recorded yet. They appear after visitors load the page with the clicks switch on."
      summary={
        summary.rows.length === 0
          ? "No clicks recorded yet."
          : `${plural(summary.total, "click", "clicks")} in the last ${summary.days} days. ${describeLargest(
              summary.rows.map((r) => ({ label: r.label, value: r.clicks })),
              { one: "click", many: "clicks" },
              ""
            )}`
      }
    />
  );
}

export function TimeBklit({ summary }: Props<TimeSummary>) {
  const median = summary.buckets.find((b) => b.bucket === summary.median)?.label;
  return (
    <RankedBars
      title="Time on page"
      rows={
        summary.total === 0
          ? []
          : summary.buckets.map((b) => ({ label: b.label, value: b.visits, extra: b.percent === null ? "Not enough data" : `${b.percent}%` }))
      }
      unit={{ one: "visit", many: "visits" }}
      seriesLabel="Visits"
      categoryHeader="Time on page"
      extraHeader="Share of visits"
      labelWidth={120}
      empty="No times recorded yet. A time is sent when a visitor leaves a page, and only while the page is visible."
      summary={`${plural(summary.total, "visit", "visits")} in the last ${summary.days} days. Median: ${median ?? `not enough data, it needs at least ${summary.minimum} visits`}.`}
    />
  );
}

export function FunnelBklit({ summary }: Props<FunnelSummary>) {
  const steps = summary.steps;
  const rows = steps.map((s, i) => ({
    label: `${i + 1}. ${s.value}`,
    value: s.visitors,
    extra:
      s.dropped === null
        ? "First step"
        : s.dropped === 0
          ? "No one dropped off"
          : `${plural(s.dropped, "visitor", "visitors")} dropped off${s.dropPercent === null ? "" : ` (${s.dropPercent}%)`}`,
  }));
  const text =
    summary.started === 0
      ? "No visitors have reached the first step yet."
      : summary.enough
        ? `Of ${plural(summary.started, "visitor", "visitors")} who started, ${number.format(summary.completed)} reached the last step (${summary.conversionPercent}%).`
        : `${plural(summary.started, "visitor", "visitors")} started. Percentages appear once ${summary.minimum} visitors have reached the step before.`;
  return (
    <RankedBars
      title="Funnel"
      rows={rows}
      unit={{ one: "visitor", many: "visitors" }}
      seriesLabel="Visitors"
      categoryHeader="Step"
      extraHeader="Drop-off"
      empty="No steps in the funnel."
      summary={`${text} A visitor counts once per day, and only after the steps before it.`}
      labelWidth={132}
    />
  );
}

// ------------------------------------------------------------ visitors

/** Return rates as bars, with the size of each cohort named, and new against returning visitors per day. */
export function RetentionBklit({ summary, projectId }: Props<RetentionSummary>) {
  const cohorts: Cohort[] = [
    { label: "Back within 7 days", ...summary.week },
    { label: "Back within 30 days", ...summary.month },
  ];
  const shown = cohorts.filter((c) => c.percent !== null);
  const bars: BarRow[] = shown.map((c) => ({
    label: `${c.label} (of ${number.format(c.cohort)})`,
    values: { rate: c.percent ?? 0 },
    tip: { rate: `${c.percent}% (${number.format(c.returned)} of ${plural(c.cohort, "visitor", "visitors")})` },
  }));
  const rate: SeriesSpec = { key: "rate", label: "Came back (%)", color: PRIMARY };
  const noDays = summary.daily.every((d) => d.newVisitors + d.returning === 0);
  const stackRows: BarRow[] = summary.daily.map((d) => ({
    label: formatDay(d.day),
    values: { fresh: d.newVisitors, back: d.returning },
  }));
  const stackSeries: SeriesSpec[] = [
    { key: "fresh", label: "New visitors", color: PRIMARY },
    { key: "back", label: "Returning visitors", color: SECOND },
  ];
  return (
    <>
      <ChartFrame
        title="Returning visitors"
        summary={`${plural(summary.visitorsThisWeek, "visitor", "visitors")} in the last 7 days. ${describeCohorts(cohorts, summary.minimum)}`}
        chartLabel="Bar chart of the share of visitors who came back within 7 days and within 30 days."
        empty={shown.length === 0 ? `Not enough visitors yet for a return rate. Each cohort needs at least ${summary.minimum}. ${describeCohorts(cohorts, summary.minimum)}` : null}
        table={{
          caption: "Visitors who came back, by cohort",
          headers: ["Cohort", "Visitors in cohort", "Came back", "Return rate"],
          rows: cohortRows(cohorts),
        }}
        exportTarget={target(projectId, "visitors", "retention")}
        note={`${RETENTION_NOTICE} A visit on a later day counts as coming back. The code stored for a visitor changes every 90 days, so someone who returns after that counts as new.`}
      >
        <BklitBars rows={bars} series={[rate]} formatValue={(n) => `${n}%`} maxLabels={2} barWidth={96} />
      </ChartFrame>
      <ChartFrame
        title="New and returning visitors per day"
        summary={noDays ? "No visitors with a retention id in the last 30 days." : describeReturning(summary.daily)}
        chartLabel={`Stacked bar chart of new and returning visitors for each of the last ${summary.daily.length} days.`}
        empty={noDays ? "No visitors with a retention id in the last 30 days." : null}
        table={{
          caption: "New and returning visitors for each day",
          headers: ["Day", "New visitors", "Returning visitors"],
          rows: summary.daily.map((d) => [formatDay(d.day), number.format(d.newVisitors), number.format(d.returning)]),
        }}
        exportTarget={target(projectId, "visitors", "returning-daily")}
        legend={stackSeries}
        note={
          noDays
            ? undefined
            : "New means the first day a visitor appears in the stored 90 days. A visitor whose code changed counts as new again."
        }
      >
        <BklitBars rows={stackRows} series={stackSeries} stacked maxLabels={6} showValues={false} />
      </ChartFrame>
    </>
  );
}
