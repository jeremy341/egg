import { TopList } from "@/components/analytics-top-list";
import type { ClicksSummary, TimeSummary } from "@/server/analytics-events";
import type { FunnelSummary } from "@/server/analytics-funnel";

const number = new Intl.NumberFormat("en");

function plural(n: number, one: string, many: string): string {
  return `${number.format(n)} ${n === 1 ? one : many}`;
}

/** The labels of the links and buttons visitors clicked most. */
export function ClicksCard({ summary }: { summary: ClicksSummary }) {
  return (
    <div className="space-y-2">
      <TopList
        title="Top clicks"
        unit="clicks"
        rows={summary.rows.map((r) => ({ label: r.label, views: r.clicks }))}
        empty="No clicks recorded yet. They appear after visitors load the page with the clicks switch on."
      />
      <p className="px-1 text-caption text-muted-foreground">
        {plural(summary.total, "click", "clicks")} in the last {summary.days} days, by the label of the link or button.
      </p>
    </div>
  );
}

/** How long visits lasted, as four ranges. A table first: the numbers are the point. */
export function TimeCard({ summary }: { summary: TimeSummary }) {
  const medianLabel = summary.buckets.find((b) => b.bucket === summary.median)?.label;
  return (
    <section aria-labelledby="time-on-page" className="overflow-hidden rounded-lg bg-card shadow-border-small">
      <h2 id="time-on-page" className="border-b px-4 py-3 text-title-3">
        Time on page
      </h2>
      {summary.total === 0 ? (
        <p className="px-4 py-5 text-muted-foreground">
          No times recorded yet. A time is sent when a visitor leaves a page, and only while the page is visible.
        </p>
      ) : (
        <>
          <p className="px-4 pt-3 text-label text-muted-foreground">
            Median:{" "}
            <span className="text-foreground">{medianLabel ?? "Not enough data"}</span>
            {" · "}
            {plural(summary.total, "visit", "visits")} in the last {summary.days} days
          </p>
          <table className="mt-2 w-full text-left text-[13px]">
            <caption className="sr-only">Visits by time spent on the page, last {summary.days} days</caption>
            <thead>
              <tr className="border-y text-label text-muted-foreground">
                <th scope="col" className="px-4 py-2 font-normal">
                  Time on page
                </th>
                <th scope="col" className="px-4 py-2 text-right font-normal">
                  Visits
                </th>
                <th scope="col" className="px-4 py-2 text-right font-normal">
                  Share of visits
                </th>
              </tr>
            </thead>
            <tbody className="hairline-y">
              {summary.buckets.map((b) => (
                <tr key={b.bucket}>
                  <th scope="row" className="px-4 py-2.5 font-normal">
                    {b.label}
                  </th>
                  <td className="tabular px-4 py-2.5 text-right">{number.format(b.visits)}</td>
                  <td className="tabular px-4 py-2.5 text-right text-muted-foreground">
                    {b.percent === null ? "Not enough data" : `${b.percent}%`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
      {summary.total > 0 && !summary.enough ? (
        <p className="border-t px-4 py-3 text-caption text-muted-foreground">
          Shares and the median need at least {summary.minimum} visits. {plural(summary.total, "visit has", "visits have")}{" "}
          reported a time so far.
        </p>
      ) : summary.total > 0 ? (
        <p className="border-t px-4 py-3 text-caption text-muted-foreground">
          Shares are rounded to whole percents. Time in a hidden tab is not counted.
        </p>
      ) : null}
    </section>
  );
}

function stepKind(kind: "page" | "track"): string {
  return kind === "page" ? "Page" : "Tracked name";
}

/** What happened between a step and the one before it, in words and figures. */
function dropText(s: FunnelSummary["steps"][number], minimum: number): string {
  if (s.dropped === null) return "First step";
  if (s.dropped === 0) return "No one dropped off";
  const people = plural(s.dropped, "visitor", "visitors");
  return s.dropPercent === null
    ? `${people} dropped off (percentage needs ${minimum} visitors at the step before)`
    : `${people} dropped off (${s.dropPercent}% of the step before)`;
}

/**
 * The funnel as a row of steps with a count at each, and the drop-off between
 * them. Each step reads as a full sentence for a screen reader.
 */
export function FunnelCard({ summary }: { summary: FunnelSummary }) {
  const first = summary.steps[0]?.visitors ?? 0;
  return (
    <section aria-labelledby="funnel-title" className="overflow-hidden rounded-lg bg-card shadow-border-small">
      <h2 id="funnel-title" className="border-b px-4 py-3 text-title-3">
        Funnel
      </h2>
      <p className="px-4 pt-3 text-label text-muted-foreground">
        Visitors who reached each step, in order, in the last {summary.days} days. A visitor counts once per day, and
        only after the steps before it.
      </p>
      {summary.started === 0 ? (
        <p className="px-4 py-5 text-muted-foreground">
          No visitors have reached the first step yet. Steps and page views are matched as they arrive.
        </p>
      ) : null}
      <ol className="grid gap-3 p-4 md:grid-flow-col md:auto-cols-fr">
        {summary.steps.map((s, i) => (
          <li key={`${i}-${s.kind}-${s.value}`} className="min-w-0 rounded-md bg-background-subtle p-3">
            <p className="text-label text-muted-foreground">
              Step {i + 1} of {summary.steps.length} · {stepKind(s.kind)}
            </p>
            <p className="mt-0.5 truncate font-mono text-[13px]" title={s.value}>
              {s.value}
            </p>
            <p className="tabular mt-2 text-stat">
              {number.format(s.visitors)}
              <span className="ml-1 text-label font-normal text-muted-foreground">
                {s.visitors === 1 ? "visitor" : "visitors"}
              </span>
            </p>
            <div aria-hidden="true" className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--ds-gray-100)]">
              <div
                className="h-full rounded-full bg-foreground"
                style={{ width: `${first > 0 ? Math.max(s.visitors > 0 ? 2 : 0, (s.visitors / first) * 100) : 0}%` }}
              />
            </div>
            <p className="mt-2 text-caption text-muted-foreground">{dropText(s, summary.minimum)}</p>
          </li>
        ))}
      </ol>
      {summary.started > 0 ? (
        <p className="border-t px-4 py-3 text-caption text-muted-foreground">
          {summary.enough
            ? `Of ${plural(summary.started, "visitor", "visitors")} who started, ${number.format(summary.completed)} reached the last step (${summary.conversionPercent}%).`
            : `Not enough data for percentages yet. They appear once ${summary.minimum} visitors have reached the step before.`}
        </p>
      ) : null}
    </section>
  );
}
