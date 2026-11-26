"use client";

import { memo, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import { useHeatmap } from "./heatmap-context";
import { getHeatmapColumnMonthAnchor } from "./heatmap-utils";

export interface HeatmapXAxisProps {
  /** Additional class name for labels */
  className?: string;
  /**
   * Egg addition: one label per column, in column order; an empty or missing entry draws nothing.
   * Left out, the axis names the months, which suits a calendar of weeks. A grid of hours uses this.
   */
  labels?: readonly (string | null | undefined)[];
}

const monthFmt = new Intl.DateTimeFormat("en-US", { month: "short" });

export const HeatmapXAxis = memo(function HeatmapXAxis({
  className,
  labels: columnLabels,
}: HeatmapXAxisProps) {
  const { containerRef, data, margin, xScale } = useHeatmap();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const labels = useMemo(() => {
    const ticks: { label: string; x: number; key: string }[] = [];
    let lastMonthKey = "";

    if (columnLabels) {
      for (let columnIndex = 0; columnIndex < data.length; columnIndex++) {
        const label = columnLabels[columnIndex];
        if (label) {
          ticks.push({
            label,
            x: margin.left + xScale(columnIndex),
            key: `column-${columnIndex}`,
          });
        }
      }
      return ticks;
    }

    for (let columnIndex = 0; columnIndex < data.length; columnIndex++) {
      const column = data[columnIndex];
      if (!column) {
        continue;
      }

      const monthAnchor = getHeatmapColumnMonthAnchor(column);
      if (!monthAnchor) {
        continue;
      }

      const monthKey = `${monthAnchor.getFullYear()}-${monthAnchor.getMonth()}`;
      if (monthKey === lastMonthKey) {
        continue;
      }

      ticks.push({
        label: monthFmt.format(monthAnchor),
        x: margin.left + xScale(columnIndex),
        key: monthKey,
      });
      lastMonthKey = monthKey;
    }

    return ticks;
  }, [columnLabels, data, margin.left, xScale]);

  const container = containerRef.current;
  if (!(mounted && container)) {
    return null;
  }

  return createPortal(
    labels.map((tick) => (
      <div
        className="pointer-events-none absolute"
        key={tick.key}
        style={{
          top: 0,
          left: tick.x,
          width: 0,
          display: "flex",
          justifyContent: "flex-start",
        }}
      >
        <span
          className={cn(
            "whitespace-nowrap text-(--chart-label) text-xs",
            className
          )}
        >
          {tick.label}
        </span>
      </div>
    )),
    container
  );
});

HeatmapXAxis.displayName = "HeatmapXAxis";

export default HeatmapXAxis;
