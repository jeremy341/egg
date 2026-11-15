"use client";

import { MotionConfig } from "motion/react";
import { useMemo } from "react";
import { chartCenterLabelClassName, chartCenterValueClassName } from "@/components/charts/bklit/chart-center-typography";
import { RadialAxis } from "@/components/charts/bklit/radial-axis";
import { RadialBar } from "@/components/charts/bklit/radial-bar";
import { RadialCenter } from "@/components/charts/bklit/radial-center";
import { RadialChart } from "@/components/charts/bklit/radial-chart";
import { useReducedChartMotion } from "@/components/charts/bklit-kit";
import { bklitThemeStyle } from "@/components/charts/bklit-theme";
import { clockData, hourSpan, type HourValue } from "@/components/charts/bklit-chart-data";
import { cn } from "@/lib/utils";

const number = new Intl.NumberFormat("en");

export type BklitRadialProps = {
  /**
   * The 24 hours of a day, in any order: `{ hour: 0..23, value }`. An hour that is left out, or has
   * `value` null, is drawn as nothing and says "No reading" when hovered. Values must be 0 or more.
   */
  hours: readonly HourValue[];
  /** What a bar counts, shown under the number in the middle at rest: "Page views". Default: "Total". */
  label?: string;
  /** How a number is written in the middle. Default: "1,234". */
  formatValue?: (n: number) => string;
  /**
   * What the middle shows at rest. "total" (default) is the sum of the hours that have a reading; a
   * `{ value, label }` shows your own text, such as the busiest hour; false leaves it empty. While an
   * hour is hovered the middle names that hour and shows its number.
   */
  center?: "total" | { value: string; label: string } | false;
  /** The widest it may be, in pixels. Default: 480. */
  maxWidth?: number;
  className?: string;
};

/**
 * Bklit's Radial Chart in its 24-hour clock layout: one bar per hour round a dial, 00 at the top and
 * clockwise, labelled 00, 06, 12 and 18. There is no tooltip box; the middle of the dial is the tooltip:
 * hover a bar to read that hour. Colours come from the `--chart-*` variables and the bars grow in only
 * when motion is not reduced.
 *
 * Read the length with care: Bklit draws the bars on a radial scale, where the AREA of a bar follows the
 * value, so a bar twice as long is more than twice the number. Use it for the shape of a day (quiet nights,
 * a busy afternoon), and keep the exact numbers in the middle and in a table.
 * Returns nothing when no hour has a reading.
 */
export function BklitRadial({ hours, label = "Total", formatValue = (n) => number.format(n), center = "total", maxWidth = 480, className }: BklitRadialProps) {
  const reduced = useReducedChartMotion();
  const clock = useMemo(() => clockData(hours), [hours]);
  const series = useMemo(() => [{ dataKey: "value", label, color: "var(--chart-line-primary)" }], [label]);
  const total = useMemo(() => clock.rows.reduce((sum, r) => sum + (r.value ?? 0), 0), [clock]);
  if (!clock.ok) return null;
  return (
    <MotionConfig reducedMotion={reduced ? "always" : "never"}>
      <div style={bklitThemeStyle} className={className}>
        <RadialChart
          data={clock.rows}
          xDataKey="hour"
          series={series}
          angleType="clock"
          // Every row is a past hour, so none is a "future" bin: an hour with no reading is simply empty.
          trackNow={false}
          maxWidth={maxWidth}
          animate={!reduced}
          className="mx-auto"
        >
          <RadialBar />
          <RadialAxis />
          <RadialCenter>
            {(state) => {
              let value: string;
              let caption: string;
              if (state.index !== null) {
                const v = clock.rows[state.index]?.value ?? null;
                value = v === null ? "No reading" : formatValue(v);
                caption = hourSpan(state.index);
              } else if (center === false) {
                return null;
              } else if (center === "total") {
                value = formatValue(total);
                caption = label;
              } else {
                value = center.value;
                caption = center.label;
              }
              return (
                <>
                  <span className={cn("text-foreground", chartCenterValueClassName)}>{value}</span>
                  <span className={cn("mt-0.5 text-(--chart-label)", chartCenterLabelClassName)}>{caption}</span>
                </>
              );
            }}
          </RadialCenter>
        </RadialChart>
      </div>
    </MotionConfig>
  );
}
