"use client";

import { useMemo } from "react";
import { MotionConfig } from "motion/react";
import {
  HeatmapCells,
  HeatmapChart,
  HeatmapInteractionBoundary,
  HeatmapInteractionProvider,
  HeatmapLegend,
  HeatmapTooltip,
  HeatmapXAxis,
  HeatmapYAxis,
  levelStylesFromColors,
  type HeatmapLevelColors,
} from "@/components/charts/bklit/heatmap";
import { bklitThemeStyle } from "@/components/charts/bklit-theme";
import { useReducedChartMotion } from "@/components/charts/bklit-kit";
import {
  buildCalendarColumns,
  buildWeekdayHourColumns,
  countLabel,
  hourCellTitle,
  highestCount,
  levelFunction,
  type HeatmapDay,
  type HeatmapHourCell,
  type HeatmapWeekStart,
} from "@/components/charts/bklit-heatmap-data";

/** Less to more: a neutral tint for zero, then four steps of the chart colour. All from `bklitTokens`. */
const LEVEL_COLORS: HeatmapLevelColors = [
  "var(--chart-heat-0)",
  "var(--chart-scale-02)",
  "var(--chart-scale-03)",
  "var(--chart-scale-04)",
  "var(--chart-scale-05)",
];

/** What the tooltip counts, in singular and plural: `{ one: "deployment", other: "deployments" }`. */
export type HeatmapUnit = { one: string; other: string };

type Shared = {
  /** What a cell counts, for the tooltip. Default: "event" and "events". */
  unit?: HeatmapUnit;
  /** The first row of the grid: 1 = Monday (default), 0 = Sunday. */
  weekStart?: HeatmapWeekStart;
  /**
   * The smallest count of colour levels 1, 2, 3 and 4, rising, such as `[1, 2, 4, 8]`. Left out, the range
   * from above zero up to the highest count is cut into four equal steps. Zero is always the neutral level.
   */
  thresholds?: readonly [number, number, number, number];
  /** Show the "Less ... More" key under the chart. Default: true. */
  legend?: boolean;
  /** Gap between cells in pixels. Default: 2. */
  gap?: number;
  /**
   * The narrowest a cell may get, in pixels. Under that the chart keeps its width and scrolls sideways
   * instead of shrinking the cells further. Default: 9 for a calendar, 14 for the weekday-by-hour grid.
   */
  minCellSize?: number;
  className?: string;
};

export type BklitHeatmapProps = Shared &
  (
    | {
        /** One cell per day, in weeks, like a contribution graph. Up to a year (53 weeks) reads well. */
        variant: "calendar";
        /** The days, in any order. Days left out, or with `count: null`, are drawn as nothing (no reading), not as 0. */
        days: readonly HeatmapDay[];
      }
    | {
        /** Seven weekday rows by 24 hour columns. */
        variant: "weekday-hour";
        /** Up to 168 cells, in any order. Cells left out, or with `count: null`, are drawn as nothing, not as 0. */
        cells: readonly HeatmapHourCell[];
      }
  );

const DEFAULT_UNIT: HeatmapUnit = { one: "event", other: "events" };
const MARGIN = { top: 24, right: 8, bottom: 0, left: 40 };

/**
 * Bklit's Heatmap Chart with Egg's colours, in two layouts. It only draws the numbers it is given:
 * it adds nothing up, and a day or an hour with no reading is an empty space, never a zero.
 *
 * - `calendar`: weeks as columns and weekdays as rows, months named along the top. Dates are calendar days
 *   ("2026-11-12") read in the reader's own calendar, so a day never moves with the time zone.
 * - `weekday-hour`: 24 hour columns by 7 weekday rows. Bklit's chart is built for weeks of days; this layout
 *   drives the same component with the hours as its columns, labels the hours with the `labels` prop and names
 *   the cell in the tooltip with `formatTitle`, both small Egg additions to the copied files.
 *
 * The tooltip names the cell and says how many (`unit`). The key under the chart highlights the cells of a level
 * when hovered. Colours come from the `--chart-*` variables; the entrance and the tooltip's motion stop when
 * motion is reduced. Hover is the only way to read one cell, so put the numbers in a table as well.
 */
export function BklitHeatmap(props: BklitHeatmapProps) {
  const { unit = DEFAULT_UNIT, weekStart = 1, thresholds, legend = true, gap = 2, className } = props;
  const reduced = useReducedChartMotion();
  const calendar = props.variant === "calendar";
  const days = props.variant === "calendar" ? props.days : null;
  const cells = props.variant === "weekday-hour" ? props.cells : null;
  const columns = useMemo(() => {
    if (days) return buildCalendarColumns(days, weekStart)?.columns ?? null;
    if (cells) return buildWeekdayHourColumns(cells)?.columns ?? null;
    return null;
  }, [days, cells, weekStart]);
  const levelOf = useMemo(
    () => levelFunction(columns ? highestCount(columns) : 0, thresholds),
    [columns, thresholds]
  );
  const levelStyles = useMemo(() => levelStylesFromColors(LEVEL_COLORS), []);
  const hourLabels = useMemo(
    // Every third hour is named, so the labels never run into each other on a narrow card.
    () => Array.from({ length: 24 }, (_, h) => (h % 3 === 0 ? String(h).padStart(2, "0") : null)),
    []
  );
  if (!columns) return null;

  const cellMin = props.minCellSize ?? (calendar ? 9 : 14);
  const minWidth = MARGIN.left + MARGIN.right + columns.length * cellMin;
  const chart = (
    <div className="overflow-x-auto">
      <div style={{ minWidth }}>
        <HeatmapChart
          data={columns}
          layout="fluid"
          levelOf={levelOf}
          levelStyles={levelStyles}
          weekStartDay={weekStart}
          margin={MARGIN}
          gap={gap}
          animate={!reduced}
          animationDuration={reduced ? 0 : undefined}
        >
          <HeatmapCells hideGhostCells={false} />
          {calendar ? <HeatmapXAxis /> : <HeatmapXAxis labels={hourLabels} />}
          <HeatmapYAxis tickFilter={calendar ? (weekStart === 1 ? "even" : "odd") : "all"} />
          <HeatmapTooltip
            instant={reduced}
            formatLabel={(count) => countLabel(count, unit)}
            formatTitle={
              calendar
                ? undefined
                : ({ date }) => hourCellTitle(date.getDay(), date.getHours())
            }
          />
        </HeatmapChart>
      </div>
    </div>
  );

  return (
    <MotionConfig reducedMotion={reduced ? "always" : "never"}>
      <div style={bklitThemeStyle} className={className}>
        <HeatmapInteractionProvider>
          <HeatmapInteractionBoundary>
            <div className="flex w-full flex-col items-stretch gap-3">
              {chart}
              {legend ? <HeatmapLegend levelStyles={levelStyles} levelOf={levelOf} /> : null}
            </div>
          </HeatmapInteractionBoundary>
        </HeatmapInteractionProvider>
      </div>
    </MotionConfig>
  );
}
