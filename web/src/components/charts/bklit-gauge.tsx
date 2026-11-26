"use client";

import { MotionConfig } from "motion/react";
import { useMemo } from "react";
import type { ChartStatFlowFormat } from "@/components/charts/bklit/chart-stat-flow";
import { Gauge } from "@/components/charts/bklit/gauge";
import { useReducedChartMotion } from "@/components/charts/bklit-kit";
import { bklitThemeStyle } from "@/components/charts/bklit-theme";
import { gaugePercent, gaugeProblem, gaugeZones, type GaugeRange } from "@/components/charts/bklit-chart-data";

export type BklitGaugeProps = {
  /** The reading, in its own units (not a percentage). Outside min to max the fill stops at the end; the middle still shows the real number. */
  value: number;
  /** The start of the scale. Default: 0. */
  min?: number;
  /** The end of the scale, above `min`. Default: 100. */
  max?: number;
  /** What the number is, written under it: "CPU", "Memory used". */
  label: string;
  /** Written before and after the number in the middle: "%" or " ms". */
  prefix?: string;
  suffix?: string;
  /** How the number in the middle is rounded. Default: at most one decimal. Leave out `style: "percent"`: the number is already in its own units. */
  format?: ChartStatFlowFormat;
  /**
   * Stretches of the scale with a meaning, in the same units as `value`, drawn as a thin coloured band
   * around the arc: `[{ from: 0, to: 70, tone: "good" }, { from: 70, to: 90, tone: "warning" }, { from: 90, to: 100, tone: "bad" }]`.
   * Colours come from the app's success, warning and destructive tokens. Arc only.
   */
  ranges?: readonly GaugeRange[];
  /** A half circle ("arc", default) or a flat bar ("linear", no ranges). */
  orientation?: "arc" | "linear";
  /** How many notches the track has. Default: 40. */
  notches?: number;
  /** The narrowest it may get, in pixels. Default: 0, so it fits a narrow card. */
  minWidth?: number;
  className?: string;
};

const DEFAULT_FORMAT: ChartStatFlowFormat = { notation: "standard", maximumFractionDigits: 1 };

/**
 * Bklit's Gauge with Egg's colours. It shows one number: the track is filled up to where `value` sits
 * between `min` and `max`, and the real number is printed in the middle. There is no tooltip.
 * Returns nothing when the scale is not a range or the value is not a number.
 */
export function BklitGauge({
  value,
  min = 0,
  max = 100,
  label,
  prefix,
  suffix,
  format = DEFAULT_FORMAT,
  ranges,
  orientation = "arc",
  notches = 40,
  minWidth = 0,
  className,
}: BklitGaugeProps) {
  const reduced = useReducedChartMotion();
  const zones = useMemo(() => (ranges && ranges.length > 0 ? gaugeZones(ranges, min, max) : undefined), [ranges, min, max]);
  if (gaugeProblem(value, min, max) !== null) return null;
  return (
    <MotionConfig reducedMotion={reduced ? "always" : "never"}>
      <div style={bklitThemeStyle} className={className}>
        <Gauge
          orientation={orientation}
          value={gaugePercent(value, min, max)}
          centerValue={value}
          defaultLabel={label}
          prefix={prefix}
          suffix={suffix}
          formatOptions={format}
          totalNotches={notches}
          minWidth={minWidth}
          zones={orientation === "arc" ? zones : undefined}
          // The chart's own "static" switch: no sweep and no fade-in, so the fill is at its value from the first frame.
          geometryScrubbing={reduced}
        />
      </div>
    </MotionConfig>
  );
}
