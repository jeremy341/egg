"use client";

import { useState } from "react";
import { countValue, describeCount, formatCount, type Count } from "@/lib/stats-format";
import { cn } from "@/lib/utils";
import { TableDisclosure } from "./figures";
import { PLOT_H } from "./layout";

/** Height of the outlined stub that stands for "fewer than 10". Not to scale on purpose. */
const STUB = 12;

type Weekday = { weekday: string; count: Count };

/** Mark kinds are drawn differently so nothing is implied that is not known. */
function Legend({ children }: { children: React.ReactNode }) {
  return (
    <ul aria-label="How to read the chart" className="mt-4 flex flex-wrap gap-x-5 gap-y-1.5 text-caption text-muted-foreground">
      {children}
    </ul>
  );
}

/**
 * Deployments per weekday (UTC) over the last 30 days: seven bars from zero,
 * every one to the same scale and labelled with its rounded value. A weekday
 * with fewer than 10 is an outlined stub with no number and no height to
 * scale. The table under the chart carries the same facts.
 */
export function WeekdayChart({ buckets, windowDays }: { buckets: Weekday[]; windowDays: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const values = buckets.map((b) => countValue(b.count));
  const max = Math.max(0, ...values);
  const few = buckets.filter((b) => "lessThan" in b.count).length;
  const active = hover !== null ? buckets[hover] : null;
  const busiest = max >= 10 ? buckets.find((b) => countValue(b.count) === max) : undefined;

  const summary =
    `Deployments for each weekday over the last ${windowDays} days, in UTC, Monday first. ` +
    (busiest ? `${busiest.weekday} was the busiest with ${describeCount(busiest.count)}. ` : "No weekday reached 10. ") +
    `${few} ${few === 1 ? "weekday" : "weekdays"} had fewer than 10.`;

  return (
    <figure>
      <figcaption className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
        <span className="text-label font-medium">Deployments by weekday</span>
        <span aria-hidden="true" className="tabular text-right text-caption text-muted-foreground">
          {active
            ? `${active.weekday}: ${describeCount(active.count)}`
            : busiest
              ? `Busiest: ${busiest.weekday}`
              : "No weekday reached 10"}
        </span>
      </figcaption>

      <div className="mt-3">
        <div
          role="img"
          aria-label={summary}
          className={cn("grid grid-cols-7 gap-2 border-b sm:gap-3", PLOT_H)}
          onPointerLeave={() => setHover(null)}
        >
          {buckets.map((b, i) => {
            const few = "lessThan" in b.count;
            const v = countValue(b.count);
            const isActive = hover === i;
            const dim = hover !== null && !isActive;
            // Bars use 80% of the plot at most, so the label above the tallest one is never clipped.
            const height = few ? `${STUB}%` : `${Math.max((v / max) * 80, 4)}%`;
            return (
              <div
                key={b.weekday}
                className="flex h-full min-w-0 flex-col items-stretch justify-end"
                onPointerEnter={() => setHover(i)}
              >
                <span className="tabular mb-1 block h-4 truncate text-center text-caption text-muted-foreground">
                  {few ? "" : formatCount(b.count)}
                </span>
                <div
                  className={cn(
                    "motion-grow-y w-full transition-[opacity,background-color,border-color] duration-(--dur-fast)",
                    few ? (isActive ? "border border-brand" : "border border-foreground") : isActive ? "bg-brand" : "bg-foreground"
                  )}
                  style={{
                    height,
                    opacity: dim ? 0.45 : 1,
                    ["--grow-delay" as string]: `${i * 30}ms`,
                  }}
                />
              </div>
            );
          })}
        </div>
        <div aria-hidden="true" className="mt-2 grid grid-cols-7 gap-2 text-center text-caption text-muted-foreground sm:gap-3">
          {buckets.map((b) => (
            <span key={b.weekday}>{b.weekday.slice(0, 3)}</span>
          ))}
        </div>
      </div>

      <Legend>
        <li className="flex items-center gap-2">
          <span aria-hidden="true" className="size-2.5 shrink-0 bg-foreground" />
          10 or more, rounded, from zero
        </li>
        <li className="flex items-center gap-2">
          <span aria-hidden="true" className="size-2.5 shrink-0 border border-foreground" />
          Fewer than 10 (height not to scale)
        </li>
      </Legend>

      <TableDisclosure
        caption={`Deployments per weekday in UTC over the last ${windowDays} days, rounded`}
        head={["Weekday (UTC)", "Deployments"]}
        rows={buckets.map((b) => [b.weekday, formatCount(b.count)])}
      />
    </figure>
  );
}
