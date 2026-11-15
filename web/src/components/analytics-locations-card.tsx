"use client";

import Link from "next/link";
import { BklitMap } from "@/components/charts/bklit-map";
import { ChartFrame, type SeriesSpec, type Table } from "@/components/charts/bklit-kit";
import { plural } from "@/components/charts/bklit-visits";
import { classFill, locationScale } from "@/lib/location-scale";
import { describeCount, formatCount } from "@/lib/stats-format";
import type { LocationsSummary } from "@/server/analytics-locations";
import type { CountryCollection } from "@/server/world-map";

const TITLE = "Where visitors are";

/** The database's terms ask for this line. */
const ATTRIBUTION = "This product includes GeoLite2 data created by MaxMind, available from https://www.maxmind.com.";

/** What is stored, said wherever the map is shown. */
const KEPT =
  "Only the visitor's country is kept, as two letters. The IP address is looked up in the same request using a database that ships with Egg, and is never stored, logged or sent anywhere. Countries with fewer than 10 page views are shown as fewer than 10.";

/**
 * A world map of page views by country, drawn with the Bklit choropleth chart in the same card as
 * the other analytics charts: header, one-sentence summary, key, footnote and a table of the same
 * numbers. Shades come from the Bklit sequential scale variables, so they follow every theme in
 * light and dark. `summary` is null when the project does not record countries. A country with no
 * recorded views is no data (a faded neutral), never a zero.
 */
export function LocationsBklit({ summary, shapes }: { summary: LocationsSummary | null; shapes: CountryCollection }) {

  if (!summary) {
    return (
      <ChartFrame
        title={TITLE}
        summary=""
        chartLabel={`World map: ${TITLE}`}
        empty="Recording is off. Egg is not keeping any visitor countries for this project."
        table={{ caption: "", headers: [], rows: [] }}
        note={
          <>
            Turn on &ldquo;Record visitor countries&rdquo; in{" "}
            <Link href="?tab=setup#analytics-features" className="text-foreground underline underline-offset-2">
              Setup
            </Link>{" "}
            to see this map. {KEPT}
          </>
        }
      >
        {null}
      </ChartFrame>
    );
  }

  const byCode = new Map(summary.rows.map((r) => [r.code, r]));
  const scale = locationScale(summary.rows.map((r) => r.count));
  const drawn = new Set(shapes.features.flatMap((f) => (f.properties.code ? [f.properties.code] : [])));
  const undrawn = summary.rows.filter((r) => !drawn.has(r.code));
  const top = summary.rows.slice(0, 3);
  const sentence =
    summary.rows.length === 0
      ? ""
      : `Most page views came from ${top[0].name} (${describeCount(top[0].count)})${
          top.length > 1 ? `, then ${top.slice(1).map((r) => r.name).join(" and ")}` : ""
        }. ${plural(summary.rows.length, "country", "countries")} in the last ${summary.days} days${
          undrawn.length ? `; ${undrawn.length === 1 ? "1 is" : `${undrawn.length} are`} too small to draw and appear only in the table` : ""
        }.`;
  const table: Table = {
    caption: `${TITLE}: page views for each country in the last ${summary.days} days. Counts under 10 are shown as fewer than 10.`,
    headers: ["Country", "Page views"],
    rows: summary.rows.map((r) => [r.name, formatCount(r.count)]),
  };
  const legend: SeriesSpec[] = scale.legend.map((l) => ({ key: String(l.cls), label: l.label, color: classFill(l.cls) }));
  const rowOf = (f: { properties?: Record<string, unknown> | null }) => {
    const code = f.properties?.code;
    return typeof code === "string" ? byCode.get(code) : undefined;
  };

  return (
    <ChartFrame
      title={TITLE}
      summary={sentence}
      chartLabel={`World map shaded by page views for each country, last ${summary.days} days. ${plural(summary.rows.length, "country", "countries")} with recorded views. The same numbers are in the table.`}
      empty={
        summary.rows.length === 0
          ? "No countries recorded yet. Recording is on, so views from now on are counted by country. Local and private addresses have no country."
          : null
      }
      table={table}
      legend={legend}
      note={`${KEPT} ${ATTRIBUTION}`}
    >
      <BklitMap
        data={shapes}
        fill={(p) => classFill(scale.classOf(rowOf({ properties: p })?.count))}
        tooltip={(p) => {
          const row = rowOf({ properties: p });
          return {
            title: row?.name ?? String(p.name ?? ""),
            rows: [
              {
                color: classFill(scale.classOf(row?.count)),
                label: "Page views",
                value: row ? formatCount(row.count) : "No data",
              },
            ],
          };
        }}
      />
    </ChartFrame>
  );
}
