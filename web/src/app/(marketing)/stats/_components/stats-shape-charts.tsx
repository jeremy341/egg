"use client";

import { BklitBars, Legend, type BarRow } from "@/components/charts/bklit-kit";
import { bklitThemeStyle } from "@/components/charts/bklit-theme";
import { countValue, describeCount, formatCount, type Count } from "@/lib/stats-format";
import { TableDisclosure } from "./figures";
import { STUB_SHARE, countLegend, countSeries } from "./layout";

type Weekday = { weekday: string; count: Count };

const SERIES = countSeries("Deployments");
const LEGEND = countLegend("10 or more, rounded, from zero");

/**
 * Deployments per weekday (UTC) over the last 30 days, as a Bklit bar chart: seven bars from
 * zero, every one to the same scale and labelled with its rounded value. A weekday with fewer
 * than 10 is a hatched stub with no number and no height to scale. The table under the chart
 * carries the same facts.
 */
export function WeekdayChart({ buckets, windowDays }: { buckets: Weekday[]; windowDays: number }) {
  const max = Math.max(0, ...buckets.map((b) => countValue(b.count)));
  const scaleMax = max >= 10 ? max : 10;
  const few = buckets.filter((b) => "lessThan" in b.count).length;
  const busiest = max >= 10 ? buckets.find((b) => countValue(b.count) === max) : undefined;

  const summary =
    `Bar chart of deployments for each weekday over the last ${windowDays} days, in UTC, Monday first. ` +
    (busiest ? `${busiest.weekday} was the busiest with ${describeCount(busiest.count)}. ` : "No weekday reached 10. ") +
    `${few} ${few === 1 ? "weekday" : "weekdays"} had fewer than 10.`;

  const rows: BarRow[] = buckets.map((b) =>
    "lessThan" in b.count
      ? { label: b.weekday.slice(0, 3), values: { value: null, few: scaleMax * STUB_SHARE }, tip: { few: describeCount(b.count) } }
      : { label: b.weekday.slice(0, 3), values: { value: b.count.approx, few: null }, tip: { value: describeCount(b.count) } }
  );

  return (
    <figure style={bklitThemeStyle}>
      <figcaption className="flex flex-col gap-0.5">
        <span className="text-body font-medium">Deployments by weekday</span>
        <span className="tabular text-caption text-muted-foreground">
          {busiest ? `Busiest: ${busiest.weekday}` : "No weekday reached 10"}
        </span>
      </figcaption>

      <div role="img" aria-label={summary} className="mt-4">
        <BklitBars
          rows={rows}
          series={SERIES}
          stacked
          valueMax={max >= 10 ? undefined : scaleMax}
          height={200}
          maxLabels={7}
          formatValue={(n) => formatCount({ approx: n })}
        />
      </div>

      <Legend className="mt-3 gap-x-5 gap-y-1.5" series={LEGEND} />

      <TableDisclosure
        caption={`Deployments per weekday in UTC over the last ${windowDays} days, rounded`}
        head={["Weekday (UTC)", "Deployments"]}
        rows={buckets.map((b) => [b.weekday, formatCount(b.count)])}
      />
    </figure>
  );
}
