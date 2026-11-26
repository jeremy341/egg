"use client";

import { BklitBars, type BarRow } from "@/components/charts/bklit-kit";
import { bklitThemeStyle } from "@/components/charts/bklit-theme";
import { describeCount, formatCount, type Count } from "@/lib/stats-format";
import { TableDisclosure } from "./figures";
import { INK } from "./layout";

type Runtime = { runtime: string; count: Count };

const LABEL: Record<string, string> = {
  node: "Node",
  python: "Python",
  static: "Static site",
  command: "Custom command",
};

const labelFor = (runtime: string) => LABEL[runtime] ?? runtime;

/**
 * Projects per runtime as horizontal Bklit bars, one bar for each runtime with 10 or more
 * projects, all from zero on one scale. Every bar is named on its axis and carries its rounded
 * value, so the runtimes are told apart by their names and not by a colour. A runtime with fewer
 * than 10 is listed under the chart as a bound and left out of it, so no bar implies a size for
 * a count that is hidden.
 */
export function RuntimeBar({ runtimes }: { runtimes: Runtime[] }) {
  const drawn = runtimes.filter((r): r is { runtime: string; count: { approx: number } } => "approx" in r.count && r.count.approx > 0);
  const hidden = runtimes.length - drawn.length;

  const summary = `Horizontal bar chart of projects by runtime. ${drawn
    .map((r) => `${labelFor(r.runtime)}: ${describeCount(r.count)}`)
    .join(". ")}.${hidden > 0 ? ` ${hidden} more with fewer than 10 are not drawn.` : ""}`;

  const rows: BarRow[] = drawn.map((r) => ({
    label: labelFor(r.runtime),
    values: { value: r.count.approx },
    tip: { value: describeCount(r.count) },
  }));

  return (
    <figure style={bklitThemeStyle}>
      <figcaption className="text-body font-medium">Projects by runtime</figcaption>

      {drawn.length === 0 ? (
        <p className="mt-3 border border-dashed px-3 py-4 text-label text-muted-foreground">
          No runtime has 10 or more projects yet, so there is no bar to draw.
        </p>
      ) : (
        <div role="img" aria-label={summary} className="mt-3">
          <BklitBars
            rows={rows}
            series={[{ key: "value", label: "Projects", color: INK }]}
            orientation="horizontal"
            labelWidth={116}
            formatValue={(n) => formatCount({ approx: n })}
          />
        </div>
      )}

      <ul className="mt-4 hairline-y border-y">
        {runtimes.map((r) => (
          <li key={r.runtime} className="grid grid-cols-[0.625rem_minmax(0,8rem)_minmax(0,1fr)] items-center gap-3 py-2 text-label">
            <span
              aria-hidden="true"
              className={
                "lessThan" in r.count
                  ? "size-2.5 shrink-0 border border-dashed border-foreground/50"
                  : "size-2.5 shrink-0 bg-foreground"
              }
            />
            <span className="min-w-0">{labelFor(r.runtime)}</span>
            <span className="tabular">{formatCount(r.count)}</span>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-caption text-muted-foreground">
        {drawn.length > 0
          ? `The bars compare the ${drawn.length === 1 ? "runtime" : "runtimes"} with 10 or more projects. Dashed squares are runtimes with fewer than 10, left out of the chart.`
          : "Dashed squares are runtimes with fewer than 10 projects."}
      </p>

      <TableDisclosure
        caption="Projects per runtime, rounded"
        head={["Runtime", "Projects"]}
        rows={runtimes.map((r) => [labelFor(r.runtime), formatCount(r.count)])}
      />
    </figure>
  );
}
