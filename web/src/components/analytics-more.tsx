import type { ReactNode } from "react";
import { RETENTION_NOTICE } from "@/lib/analytics-defaults";
import type { CampaignsSummary } from "@/server/analytics";
import type { EventsSummary } from "@/server/analytics-events";
import { VITAL_THRESHOLDS, formatVital } from "@/server/analytics-fields";
import type { LiveSummary, RetentionSummary, ReturnRate } from "@/server/analytics-retention";
import type { ErrorsSummary, SpeedSummary } from "@/server/analytics-speed";

const number = new Intl.NumberFormat("en");

function plural(n: number, one: string, many: string): string {
  return `${number.format(n)} ${n === 1 ? one : many}`;
}

const day = new Intl.DateTimeFormat("en", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "UTC" });

/** A titled card in the same frame as the other Analytics sections. */
function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="overflow-hidden rounded-lg bg-card shadow-border-small">
      <h2 id={id} className="border-b px-4 py-3 text-title-3">
        {title}
      </h2>
      {children}
    </section>
  );
}

const TH = "px-4 py-2 font-normal";
const TD = "px-4 py-2.5";

/** The top campaigns (utm_campaign) with their source and medium. Counts are page views in the range. */
export function CampaignsCard({ summary: campaigns }: { summary: CampaignsSummary }) {
  const days = campaigns.days;
  return (
    <div>
      <Section id="campaigns-title" title="Campaigns">
        {campaigns.rows.length === 0 ? (
          <p className="px-4 py-5 text-muted-foreground">
            No campaigns yet. Add <span className="font-mono text-[13px]">?utm_campaign=name</span> to a link that
            points at your site.
          </p>
        ) : (
          <table className="w-full text-left text-[13px]">
            <caption className="sr-only">Page views by campaign, last {days} days</caption>
            <thead>
              <tr className="border-b text-label text-muted-foreground">
                <th scope="col" className={TH}>
                  Campaign
                </th>
                <th scope="col" className={`${TH} max-sm:hidden`}>
                  Source / medium
                </th>
                <th scope="col" className={`${TH} text-right`}>
                  Page views
                </th>
              </tr>
            </thead>
            <tbody className="hairline-y">
              {campaigns.rows.map((r) => (
                <tr key={`${r.campaign}|${r.source}|${r.medium}`}>
                  <th scope="row" className={`${TD} min-w-0 break-words font-mono font-normal`}>
                    {r.campaign}
                    <span className="block text-muted-foreground sm:hidden">
                      {[r.source, r.medium].filter(Boolean).join(" / ") || "No source"}
                    </span>
                  </th>
                  <td className={`${TD} font-mono text-muted-foreground max-sm:hidden`}>
                    {[r.source, r.medium].filter(Boolean).join(" / ") || "None"}
                  </td>
                  <td className={`${TD} tabular text-right`}>{number.format(r.views)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="border-t px-4 py-3 text-caption text-muted-foreground">
          From the utm_source, utm_medium and utm_campaign values in the address, up to 80 characters each. The last{" "}
          {days} days.
        </p>
      </Section>
    </div>
  );
}

/** Page views and visitors in the last 5 minutes. */
export function LiveCard({ summary }: { summary: LiveSummary }) {
  return (
    <Section id="live-title" title="On the site now">
      <div className="grid gap-3 p-4 sm:grid-cols-2">
        <div className="rounded-md bg-background-subtle p-3">
          <p className="text-label text-muted-foreground">Page views, last {summary.windowMinutes} minutes</p>
          <p className="tabular mt-1 text-stat">{number.format(summary.views)}</p>
        </div>
        <div className="rounded-md bg-background-subtle p-3">
          <p className="text-label text-muted-foreground">Visitors, last {summary.windowMinutes} minutes</p>
          {summary.visitors === null ? (
            <p className="mt-1 text-muted-foreground">Unique visitors need retention on.</p>
          ) : (
            <p className="tabular mt-1 text-stat">{number.format(summary.visitors)}</p>
          )}
        </div>
      </div>
      <p className="border-t px-4 py-3 text-caption text-muted-foreground">
        As of when this page loaded. Reload to update.
        {summary.visitors === null
          ? " Visitors are told apart by the retention id."
          : " Visitors with a page view or a signal from an open page in the window, told apart by the retention id."}
      </p>
    </Section>
  );
}

const RATING_CLASS = { good: "text-success", "needs-work": "text-warning", poor: "text-destructive" } as const;

/** Median and 75th percentile for each speed measurement, with the unit on every figure. */
export function SpeedCard({ summary }: { summary: SpeedSummary }) {
  return (
    <Section id="speed-title" title="Speed">
      {summary.reports === 0 ? (
        <p className="px-4 py-5 text-muted-foreground">
          No speed measurements yet. A summary is sent once per page view, when the visitor leaves or switches tab.
        </p>
      ) : (
        <>
          <p className="px-4 pt-3 text-label text-muted-foreground">
            {plural(summary.reports, "page view", "page views")} reported in the last {summary.days} days. The label
            judges the 75th percentile, as Google does.
          </p>
          <table className="mt-2 w-full text-left text-[13px]">
            <caption className="sr-only">Speed measurements, last {summary.days} days</caption>
            <thead>
              <tr className="border-y text-label text-muted-foreground">
                <th scope="col" className={TH}>
                  Measurement
                </th>
                <th scope="col" className={`${TH} text-right`}>
                  Median
                </th>
                <th scope="col" className={`${TH} text-right`}>
                  75th percentile
                </th>
                <th scope="col" className={`${TH} text-right max-sm:hidden`}>
                  Page views
                </th>
              </tr>
            </thead>
            <tbody className="hairline-y">
              {summary.metrics.map((m) => {
                const [good, poor] = VITAL_THRESHOLDS[m.metric];
                return (
                  <tr key={m.metric}>
                    <th scope="row" className={`${TD} font-normal`}>
                      {m.name} <span className="text-muted-foreground">({m.metric.toUpperCase()})</span>
                      <span className="block text-caption font-normal text-muted-foreground">
                        Good up to {formatVital(m.metric, good)}, poor over {formatVital(m.metric, poor)}
                        {m.unit === "score" ? " (a score, no unit)" : ""}
                      </span>
                    </th>
                    <td className={`${TD} tabular whitespace-nowrap text-right`}>
                      {m.median === null ? <span className="text-muted-foreground">Not enough data</span> : formatVital(m.metric, m.median)}
                    </td>
                    <td className={`${TD} tabular whitespace-nowrap text-right`}>
                      {m.p75 === null || m.rating === null ? (
                        <span className="text-muted-foreground">Not enough data</span>
                      ) : (
                        <>
                          {formatVital(m.metric, m.p75)}
                          <span className={`block text-caption ${RATING_CLASS[m.rating]}`}>{m.ratingLabel}</span>
                        </>
                      )}
                    </td>
                    <td className={`${TD} tabular text-right text-muted-foreground max-sm:hidden`}>{number.format(m.samples)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="border-t px-4 py-3 text-caption text-muted-foreground">
            Times are in milliseconds (ms) or seconds (s). Figures need at least {summary.minimum} page views for a
            measurement. Interaction to Next Paint is the longest interaction on a page.
          </p>
        </>
      )}
    </Section>
  );
}

/** The most frequent JavaScript errors: message, count and when it last happened. */
export function ErrorsCard({ summary }: { summary: ErrorsSummary }) {
  return (
    <Section id="errors-title" title="Errors">
      {summary.rows.length === 0 ? (
        <p className="px-4 py-5 text-muted-foreground">
          No JavaScript errors reported in the last {summary.days} days.
        </p>
      ) : (
        <>
          <p className="px-4 pt-3 text-label text-muted-foreground">
            {plural(summary.total, "error", "errors")} in the last {summary.days} days, grouped by message, file and
            line.
          </p>
          <table className="mt-2 w-full text-left text-[13px]">
            <caption className="sr-only">JavaScript errors, last {summary.days} days</caption>
            <thead>
              <tr className="border-y text-label text-muted-foreground">
                <th scope="col" className={TH}>
                  Message
                </th>
                <th scope="col" className={`${TH} text-right`}>
                  Times
                </th>
                <th scope="col" className={`${TH} text-right max-sm:hidden`}>
                  Last seen (UTC)
                </th>
              </tr>
            </thead>
            <tbody className="hairline-y">
              {summary.rows.map((r) => (
                <tr key={`${r.message}|${r.file}|${r.line}`}>
                  <th scope="row" className={`${TD} min-w-0 font-normal`}>
                    <span className="block font-mono [overflow-wrap:anywhere]">{r.message}</span>
                    {r.file ? (
                      <span className="block text-caption text-muted-foreground">
                        {r.file}
                        {r.line ? `, line ${r.line}` : ""}
                      </span>
                    ) : null}
                    <span className="block text-caption text-muted-foreground sm:hidden">
                      Last seen {day.format(r.lastSeen)} UTC
                    </span>
                  </th>
                  <td className={`${TD} tabular text-right align-top`}>{number.format(r.count)}</td>
                  <td className={`${TD} tabular whitespace-nowrap text-right align-top text-muted-foreground max-sm:hidden`}>
                    <time dateTime={r.lastSeen.toISOString()}>{day.format(r.lastSeen)}</time>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </Section>
  );
}

/** Custom events by name and value. */
export function EventsCard({ summary }: { summary: EventsSummary }) {
  return (
    <Section id="events-title" title="Events">
      {summary.rows.length === 0 ? (
        <p className="px-4 py-5 text-muted-foreground">
          No events yet. They appear when a visitor clicks an element marked with{" "}
          <span className="font-mono text-[13px]">data-egg-track</span>.
        </p>
      ) : (
        <>
          <p className="px-4 pt-3 text-label text-muted-foreground">
            {plural(summary.total, "event", "events")} in the last {summary.days} days.
          </p>
          <table className="mt-2 w-full text-left text-[13px]">
            <caption className="sr-only">Custom events by name and value, last {summary.days} days</caption>
            <thead>
              <tr className="border-y text-label text-muted-foreground">
                <th scope="col" className={TH}>
                  Name
                </th>
                <th scope="col" className={TH}>
                  Value
                </th>
                <th scope="col" className={`${TH} text-right`}>
                  Count
                </th>
              </tr>
            </thead>
            <tbody className="hairline-y">
              {summary.rows.map((r) => (
                <tr key={`${r.name}|${r.value}`}>
                  <th scope="row" className={`${TD} min-w-0 break-words font-mono font-normal`}>
                    {r.name}
                  </th>
                  <td className={`${TD} min-w-0 break-words font-mono text-muted-foreground`}>{r.value ?? "None"}</td>
                  <td className={`${TD} tabular text-right`}>{number.format(r.count)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
      <p className="border-t px-4 py-3 text-caption text-muted-foreground">
        Set the value with <span className="font-mono">data-egg-value</span> on the same element (up to 40 plain
        characters). A funnel step can use the same name.
      </p>
    </Section>
  );
}

function ReturnLine({ label, who, rate, minimum }: { label: string; who: string; rate: ReturnRate; minimum: number }) {
  return (
    <div className="rounded-md bg-background-subtle p-3">
      <p className="text-label text-muted-foreground">{label}</p>
      {rate.percent === null ? (
        <p className="mt-1">Not enough data yet</p>
      ) : (
        <p className="tabular mt-1 text-stat">
          {rate.percent}
          <span className="ml-0.5 text-label font-normal text-muted-foreground">%</span>
        </p>
      )}
      <p className="mt-1 text-caption text-muted-foreground">
        {rate.percent === null
          ? `${plural(rate.cohort, "visitor", "visitors")} so far. It needs at least ${minimum}.`
          : `${number.format(rate.returned)} of ${plural(rate.cohort, "visitor", "visitors")}`}{" "}
        {who}
      </p>
    </div>
  );
}

/** Returning visitors over 7 and 30 days, from the retention id. */
export function RetentionCard({ summary }: { summary: RetentionSummary }) {
  return (
    <Section id="retention-title" title="Returning visitors">
      <p className="px-4 pt-3 text-label text-muted-foreground">
        <span className="text-foreground">{plural(summary.visitorsThisWeek, "visitor", "visitors")}</span> in the last
        7 days.
      </p>
      <div className="grid gap-3 p-4 sm:grid-cols-2">
        <ReturnLine
          label="Came back within 7 days"
          who="who first visited 7 to 14 days ago."
          rate={summary.week}
          minimum={summary.minimum}
        />
        <ReturnLine
          label="Came back within 30 days"
          who="who first visited 30 to 37 days ago."
          rate={summary.month}
          minimum={summary.minimum}
        />
      </div>
      <p className="border-t px-4 py-3 text-caption text-muted-foreground">
        {RETENTION_NOTICE} A visit on a later day counts as coming back. The code stored for a visitor changes every 90
        days, so someone who returns after that counts as new.
      </p>
    </Section>
  );
}
