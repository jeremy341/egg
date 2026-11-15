"use client";

import { BklitTimeSeries } from "@/components/charts/bklit-kit";
import { bklitThemeStyle } from "@/components/charts/bklit-theme";
import { readings, readingStats, type TimePoint } from "@/components/charts/bklit-time";
import type { ProjectSamplePoint } from "@/server/queries";

/** One measurement of the service: its name, the newest reading and the peak in words, then the chart. */
function Measure({
  name,
  points,
  format,
  axisWidth,
  chartLabel,
}: {
  name: string;
  points: TimePoint[];
  format: (value: number) => string;
  axisWidth: number;
  /** What the picture is, for a screen reader. */
  chartLabel: (peak: string) => string;
}) {
  const stats = readingStats(readings(points));
  const drawn = readings(points).length >= 2;
  return (
    <div className="min-w-0">
      <div className="flex items-baseline justify-between gap-3 px-2">
        <h3 className="text-label font-medium">{name}</h3>
        <p className="tabular font-mono text-caption font-normal text-muted-foreground">
          {stats ? `${format(stats.latest)} now, peak ${format(stats.peak)}` : "No reading"}
        </p>
      </div>
      {drawn && stats ? (
        <div role="img" aria-label={chartLabel(format(stats.peak))} className="mt-1">
          <BklitTimeSeries points={points} label={name} height={132} ticks={3} axisWidth={axisWidth} formatValue={format} />
        </div>
      ) : (
        <p className="mt-2 px-2 text-label text-muted-foreground">Not enough readings yet to draw a line.</p>
      )}
    </div>
  );
}

/**
 * What this one project's service used over the last day, as two Bklit area charts. The numbers
 * come from systemd's accounting for the service, so they are this project alone and not the
 * whole container. CPU is a share of a single core, so it can pass 100.
 */
export function ProjectResources({ points }: { points: ProjectSamplePoint[] }) {
  const memory = points.map((p) => ({ at: p.at, value: p.memMb }));
  const cpu = points.map((p) => ({ at: p.at, value: p.cpuPercent }));
  const enough = readings(memory).length >= 2 || readings(cpu).length >= 2;

  return (
    <section
      aria-labelledby="resources-heading"
      className="rounded-lg bg-card shadow-border-small"
      style={bklitThemeStyle}
    >
      <div className="border-b px-4 py-3">
        <h2 id="resources-heading" className="text-title-3">
          Resource use
        </h2>
        <p className="mt-0.5 text-label text-muted-foreground">
          This service only, last 24 hours. Checked every few minutes.
        </p>
      </div>
      {enough ? (
        <div className="grid gap-x-4 gap-y-5 px-2 py-4 md:grid-cols-2">
          <Measure
            name="Memory"
            points={memory}
            format={(v) => `${v.toFixed(0)} MB`}
            axisWidth={62}
            chartLabel={(peak) => `Area chart of memory over the last 24 hours, peak ${peak}.`}
          />
          <Measure
            name="CPU"
            points={cpu}
            format={(v) => `${v.toFixed(1)}%`}
            axisWidth={52}
            chartLabel={(peak) => `Area chart of CPU over the last 24 hours, peak ${peak} of one core.`}
          />
        </div>
      ) : (
        <p className="px-4 py-5 text-muted-foreground">
          Collecting data. Readings appear here after a few checks while the app is running.
        </p>
      )}
    </section>
  );
}
