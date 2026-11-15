import type { LiveSummary } from "@/server/analytics-retention";

const number = new Intl.NumberFormat("en");

/**
 * Page views and visitors in the last few minutes. Two numbers, so it is a card of figures and
 * not a chart: there is no series to draw.
 */
export function LiveCard({ summary }: { summary: LiveSummary }) {
  return (
    <section aria-labelledby="live-title" className="overflow-hidden rounded-lg bg-card shadow-border-small">
      <div className="border-b px-4 py-3">
        <h2 id="live-title" className="text-title-3">
          On the site now
        </h2>
      </div>
      <dl className="grid gap-3 p-4 sm:grid-cols-2">
        <div className="rounded-md bg-background-subtle p-3">
          <dt className="text-label text-muted-foreground">Page views, last {summary.windowMinutes} minutes</dt>
          <dd className="tabular mt-1 text-stat">{number.format(summary.views)}</dd>
        </div>
        <div className="rounded-md bg-background-subtle p-3">
          <dt className="text-label text-muted-foreground">Visitors, last {summary.windowMinutes} minutes</dt>
          {summary.visitors === null ? (
            <dd className="mt-1 text-muted-foreground">Unique visitors need retention on.</dd>
          ) : (
            <dd className="tabular mt-1 text-stat">{number.format(summary.visitors)}</dd>
          )}
        </div>
      </dl>
      <p className="border-t px-4 py-3 text-caption text-muted-foreground">
        As of when this page loaded. Reload to update.
        {summary.visitors === null
          ? " Visitors are told apart by the retention id."
          : " Visitors with a page view or a signal from an open page in the window, told apart by the retention id."}
      </p>
    </section>
  );
}
