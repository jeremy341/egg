"use client";

import { curveLinear, curveStepAfter } from "d3-shape";
import { MotionConfig } from "motion/react";
import { useMemo } from "react";
import { LiveLine } from "@/components/charts/bklit/live-line";
import { LiveLineChart } from "@/components/charts/bklit/live-line-chart";
import { LiveXAxis } from "@/components/charts/bklit/live-x-axis";
import { LiveYAxis } from "@/components/charts/bklit/live-y-axis";
import { ChartTooltip } from "@/components/charts/bklit/tooltip";
import { TooltipContent } from "@/components/charts/bklit/tooltip/tooltip-content";
import { useReducedChartMotion } from "@/components/charts/bklit-kit";
import { bklitThemeStyle } from "@/components/charts/bklit-theme";
import { formatClock, liveReadings, nearestReading, type LiveReading } from "@/components/charts/bklit-chart-data";

const number = new Intl.NumberFormat("en", { maximumFractionDigits: 2 });

export type BklitLiveLineProps = {
  /**
   * Readings, each with the time it was taken (`at`, milliseconds since the epoch) and its value. They are
   * sorted by time (a copy); readings that are not numbers are dropped. Keep to what the window shows plus a
   * little, a few hundred at most. Nothing is fetched here: pass a new array each time a reading arrives.
   */
  readings: readonly LiveReading[];
  /** What the line measures, for the tooltip: "Requests per second". */
  label: string;
  /** How long a stretch the chart shows, in seconds, ending now. Default: 60. */
  windowSeconds?: number;
  /** How a number is written on the axis, the badge and the tooltip. Default: up to two decimals. */
  formatValue?: (n: number) => string;
  /**
   * Between two readings: "linear" joins them with a straight line (default), "step" holds each value until
   * the next reading arrives, which draws nothing that was not read.
   */
  curve?: "linear" | "step";
  /** The pill with the latest value at the end of the line. Default: true. */
  badge?: boolean;
  /** Stop the chart scrolling. It then shows the moment it was paused at. Default: false. */
  paused?: boolean;
  /** Height in pixels. Default: 200. */
  height?: number;
  /** Room for the axis numbers on the left, in pixels. Default: 56. */
  axisWidth?: number;
  className?: string;
};

/**
 * Bklit's Live Line Chart with Egg's colours: a line that scrolls with the clock, ending now. The
 * time axis is the browser's clock and is shown in the reader's own time zone, so readings from a
 * machine with a different clock sit a little off. The y axis fits the readings in view (it does not start
 * at zero) and eases between ranges. The line ends flat at the latest reading until the next one arrives, so
 * a stalled feed looks flat; show the time of the latest reading next to it.
 *
 * The tooltip names the reading nearest to the pointer and when it was taken, never a value worked out
 * between two readings, and says "No reading" before the first one. When motion is reduced the chart does
 * not scroll: it redraws, standing still, each time a new reading arrives.
 * Returns nothing until there is a reading.
 */
export function BklitLiveLine({
  readings,
  label,
  windowSeconds = 60,
  formatValue = (n) => number.format(n),
  curve = "linear",
  badge = true,
  paused = false,
  height = 200,
  axisWidth = 56,
  className,
}: BklitLiveLineProps) {
  const reduced = useReducedChartMotion();
  const sorted = useMemo(() => liveReadings(readings), [readings]);
  const data = useMemo(() => sorted.map((r) => ({ time: r.at / 1000, value: r.value })), [sorted]);
  const margin = useMemo(() => ({ top: 16, right: badge ? 88 : 16, bottom: 32, left: axisWidth }), [badge, axisWidth]);
  const latest = sorted.at(-1);
  if (!latest) return null;
  return (
    <MotionConfig reducedMotion={reduced ? "always" : "never"}>
      <div style={bklitThemeStyle} className={className}>
        <LiveLineChart
          // Reduced motion: no scrolling, so a new reading starts a fresh chart at that moment instead.
          key={reduced ? latest.at : undefined}
          data={data}
          value={latest.value}
          window={windowSeconds}
          // 1 = the dot is at the latest value at once, never eased toward it.
          lerpSpeed={1}
          paused={paused || reduced}
          margin={margin}
          style={{ height }}
        >
          <LiveLine
            dataKey="value"
            stroke="var(--chart-line-primary)"
            curve={curve === "step" ? curveStepAfter : curveLinear}
            pulse={!reduced}
            badge={badge}
            formatValue={formatValue}
          />
          <LiveXAxis formatTime={formatClock} />
          <LiveYAxis formatValue={formatValue} />
          <ChartTooltip
            showDatePill={false}
            showDots={false}
            content={({ point }) => {
              const at = point.date instanceof Date ? point.date.getTime() : Number.NaN;
              const reading = nearestReading(sorted, at);
              return reading ? (
                <TooltipContent
                  title={formatClock(reading.at)}
                  rows={[{ color: "var(--chart-line-primary)", label, value: formatValue(reading.value) }]}
                />
              ) : (
                <TooltipContent title={formatClock(at)} rows={[{ color: "var(--chart-line-primary)", label, value: "No reading" }]} />
              );
            }}
          />
        </LiveLineChart>
      </div>
    </MotionConfig>
  );
}
