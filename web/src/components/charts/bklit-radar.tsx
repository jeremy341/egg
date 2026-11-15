"use client";

import { MotionConfig } from "motion/react";
import { useMemo } from "react";
import { RadarArea } from "@/components/charts/bklit/radar-area";
import { RadarAxis } from "@/components/charts/bklit/radar-axis";
import { RadarChart } from "@/components/charts/bklit/radar-chart";
import { RadarGrid } from "@/components/charts/bklit/radar-grid";
import { RadarLabels } from "@/components/charts/bklit/radar-labels";
import { Legend, useReducedChartMotion, type SeriesSpec } from "@/components/charts/bklit-kit";
import { bklitThemeStyle } from "@/components/charts/bklit-theme";
import { radarProblem, radarScaled, type RadarAxis as Axis, type RadarSeries } from "@/components/charts/bklit-chart-data";

/** The colour of each series, first to third: all from `bklitTokens`. */
const SERIES_COLORS = ["var(--chart-line-primary)", "var(--chart-series-2)", "var(--chart-foreground)"] as const;

export type BklitRadarProps = {
  /** The spokes, clockwise from the top. Three to about eight read well; keep labels short. */
  axes: readonly Axis[];
  /** One to three polygons. Each needs a number for every axis, in the axis's own units. */
  series: readonly RadarSeries[];
  /**
   * The value that reaches the rim: one number for every axis, or one for each axis by key. A value above
   * it is held at the rim. It is required because the chart cannot guess what "full" means.
   */
  max: number | Readonly<Record<string, number>>;
  /** Rings in the grid. Default: 4. */
  levels?: number;
  /** Label the rings with their share of the top of the scale ("25%", "50%"). Default: true. */
  showLevels?: boolean;
  /** Width and height in pixels. Default: fills the width of its box, square. */
  size?: number;
  className?: string;
};

/**
 * Bklit's Radar Chart with Egg's colours. The chart works on a 0 to 100 scale, so each value is turned into
 * its share of its axis's `max`; the numbers on the page are the real ones, never the scaled ones. Hovering
 * a polygon lifts it and dims the others. Bklit's radar has no tooltip, so give the numbers in a table
 * (see `radarTable`). A key is drawn under the chart when there is more than one series.
 * Returns nothing when the input cannot be drawn (see `radarProblem`).
 */
export function BklitRadar({ axes, series, max, levels = 4, showLevels = true, size, className }: BklitRadarProps) {
  const reduced = useReducedChartMotion();
  const problem = radarProblem(axes, series, max);
  const data = useMemo(
    () => (problem === null ? radarScaled(axes, series, max).map((s, i) => ({ ...s, color: SERIES_COLORS[i] })) : []),
    [axes, series, max, problem]
  );
  const metrics = useMemo(() => axes.map((a) => ({ key: a.key, label: a.label })), [axes]);
  if (problem !== null) return null;
  const key: SeriesSpec[] = series.map((s, i) => ({ key: s.label, label: s.label, color: SERIES_COLORS[i] }));
  return (
    <MotionConfig reducedMotion={reduced ? "always" : "never"}>
      <div style={bklitThemeStyle} className={className}>
        <RadarChart
          data={data}
          metrics={metrics}
          size={size}
          levels={levels}
          animate={!reduced}
          enterDurationMs={reduced ? 0 : undefined}
          enterTransition={reduced ? { type: "tween", duration: 0 } : undefined}
          className="mx-auto max-w-md"
        >
          <RadarGrid showLabels={showLevels} formatLevel={(p) => `${p}%`} />
          <RadarAxis />
          <RadarLabels />
          {data.map((s, i) => (
            <RadarArea key={s.label} index={i} />
          ))}
        </RadarChart>
        {series.length > 1 ? <Legend series={key} className="justify-center" /> : null}
      </div>
    </MotionConfig>
  );
}
