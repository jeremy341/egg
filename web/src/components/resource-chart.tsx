"use client";

import { useId, useSyncExternalStore } from "react";
import { BklitTimeSeries, DataTable, formatMoment } from "@/components/charts/bklit-kit";
import { bklitThemeStyle } from "@/components/charts/bklit-theme";
import { hourly, readingStats, readings, withGaps, type TimePoint } from "@/components/charts/bklit-time";
import { cn } from "@/lib/utils";

const percent = (share: number) => `${Math.round(share * 100)}%`;

const subscribeToNothing = () => () => {};

/** False on the server and for the first browser render, then true. Local times are only written once it is. */
function useInBrowser(): boolean {
  return useSyncExternalStore(subscribeToNothing, () => true, () => false);
}

/**
 * One measurement over time as a Bklit area chart on a fixed 0 to 100% scale, so a line near the
 * bottom means plenty of room. A stretch with no readings is a break in the line and is never
 * smoothed over. With fewer than two readings it says so instead of drawing.
 *
 * Values are shares of the limit between 0 and 1. The lowest, average and peak are written under
 * the chart, the picture carries the same three in its label, and a table of every hour can be
 * reached with the keyboard.
 */
export function ResourceChart({
  title,
  now,
  detail,
  points,
  rangeLabel,
  className,
}: {
  title: string;
  /** The current reading, for example "0.42 / 2" or "1.2 / 2.0 GB". */
  now: string | null;
  /** A line under the title, for example "2 vCPU". */
  detail?: string;
  points: TimePoint[];
  /** "24 hours" or "7 days", used for the summary and the accessible name. */
  rangeLabel: string;
  className?: string;
}) {
  const headingId = useId();
  const inBrowser = useInBrowser();
  const series = readings(points);
  const stats = series.length >= 2 ? readingStats(series) : null;
  const hasGap = withGaps(points).some((r) => r.band !== null);

  return (
    <section
      aria-labelledby={headingId}
      // No overflow-hidden: the tooltip and the time pill may reach past the plot at its edges.
      className={cn("flex flex-col rounded-lg bg-card shadow-border-small", className)}
      style={bklitThemeStyle}
    >
      <div className="flex items-baseline justify-between gap-3 border-b px-4 py-3">
        <div className="min-w-0">
          <h2 id={headingId} className="text-title-3">
            {title}
          </h2>
          {detail ? <p className="mt-0.5 text-label text-muted-foreground">{detail}</p> : null}
        </div>
        <p className="tabular shrink-0 font-mono text-label">{now ?? "No reading"}</p>
      </div>

      {stats ? (
        <>
          {/* The plot sits on the footer, so three cards in a row line up even when one header wraps. */}
          <div className="flex flex-1 flex-col justify-end px-2 pt-3 pb-1">
            <div
              role="img"
              aria-label={`Area chart of ${title} over the last ${rangeLabel}: lowest ${percent(stats.low)}, average ${percent(stats.average)}, peak ${percent(stats.peak)} of the limit.`}
            >
              <BklitTimeSeries
                points={points}
                label={title}
                height={168}
                domain={[0, 1]}
                ticks={2}
                formatValue={percent}
              />
            </div>
            {hasGap ? (
              <p className="px-2 pt-1 text-caption text-muted-foreground">Shaded stretches had no readings, so nothing is drawn there.</p>
            ) : null}
            {inBrowser ? (
              <div className="px-2">
                <DataTable
                  label={title}
                  table={{
                    caption: `${title} for each hour of the last ${rangeLabel}, as a share of the limit. Times are in your time zone.`,
                    headers: ["Hour", "Lowest", "Average", "Peak", "Readings"],
                    rows: hourly(series).map((h) => [
                      formatMoment(h.at),
                      percent(h.low),
                      percent(h.average),
                      percent(h.peak),
                      h.readings,
                    ]),
                  }}
                />
              </div>
            ) : null}
          </div>
          <dl className="grid grid-cols-3 divide-x border-t text-center">
            {[
              ["Lowest", percent(stats.low)],
              ["Average", percent(stats.average)],
              ["Peak", percent(stats.peak)],
            ].map(([k, v]) => (
              <div key={k} className="px-2 py-2.5">
                <dt className="text-caption text-muted-foreground">{k}</dt>
                <dd className="tabular mt-0.5 font-mono text-label">{v}</dd>
              </div>
            ))}
          </dl>
        </>
      ) : (
        <p className="px-4 py-5 text-muted-foreground">
          No line yet. The worker takes a reading every five minutes and a line needs two.
        </p>
      )}
    </section>
  );
}
