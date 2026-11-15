"use client";

import { BklitBars, Legend, type BarRow } from "@/components/charts/bklit-kit";
import { bklitThemeStyle } from "@/components/charts/bklit-theme";
import { describeCount, formatCount, formatDay, type Count } from "@/lib/stats-format";
import { TableDisclosure } from "./figures";
import { STUB_SHARE, countLegend, countSeries } from "./layout";

type Day = { date: string; count: Count };

const SERIES = countSeries("Deployments");
const LEGEND = countLegend("10 or more, rounded");

/**
 * Total deployments per UTC day, as a Bklit bar chart. Three kinds of day are drawn differently
 * so nothing is implied that is not known:
 *  - a solid bar for a day with 10 or more, to scale and rounded;
 *  - a hatched stub for a day with 1 to 9 ("fewer than 10", not to scale);
 *  - no bar for a day with none (a real zero, not a missing day).
 * Pointing at a day names it and its figure. The role="img" summary and the table under the
 * chart carry the same facts for screen readers and keyboards.
 */
export function StatsChart({ daily }: { daily: Day[] }) {
  const max = Math.max(0, ...daily.map((d) => ("approx" in d.count ? d.count.approx : 0)));
  const scaleMax = max >= 10 ? max : 10;
  const quiet = daily.filter((d) => "approx" in d.count && d.count.approx === 0).length;
  const few = daily.filter((d) => "lessThan" in d.count).length;

  const summary =
    `Bar chart of total deployments for each of the last ${daily.length} days, in UTC. ` +
    (max >= 10 ? `The busiest day had ${describeCount({ approx: max })}. ` : "No day reached 10. ") +
    `${few} ${few === 1 ? "day" : "days"} had fewer than 10 and ${quiet} had none.`;

  const rows: BarRow[] = daily.map((d) =>
    "lessThan" in d.count
      ? { label: formatDay(d.date), values: { value: null, few: scaleMax * STUB_SHARE }, tip: { few: describeCount(d.count) } }
      : {
          label: formatDay(d.date),
          values: { value: d.count.approx, few: null },
          tip: { value: d.count.approx === 0 ? "none" : describeCount(d.count) },
        }
  );

  return (
    <figure style={bklitThemeStyle}>
      <figcaption className="flex flex-col gap-0.5">
        <span className="text-body font-medium">Deployments per day</span>
        <span className="tabular text-caption text-muted-foreground">
          {max >= 10 ? `Busiest day: ${describeCount({ approx: max })}` : "No day reached 10"}
        </span>
      </figcaption>

      <div role="img" aria-label={summary} className="mt-4">
        <BklitBars
          rows={rows}
          series={SERIES}
          stacked
          valueMax={max >= 10 ? undefined : scaleMax}
          height={200}
          maxLabels={6}
          showValues={false}
          formatValue={(n) => formatCount({ approx: n })}
        />
      </div>

      <Legend className="mt-3 gap-x-5 gap-y-1.5" series={LEGEND} />
      <p className="mt-1.5 text-caption text-muted-foreground">A day with no bar had no deployments.</p>

      <TableDisclosure
        caption="Total deployments per UTC day, rounded"
        head={["Day (UTC)", "Deployments"]}
        rows={[...daily].reverse().map((d) => [
          <time key={d.date} dateTime={d.date}>
            {formatDay(d.date)}
          </time>,
          formatCount(d.count),
        ])}
      />
    </figure>
  );
}
