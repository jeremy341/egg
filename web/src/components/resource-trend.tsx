"use client";

import { BklitTimeSeries } from "@/components/charts/bklit-kit";
import { bklitThemeStyle } from "@/components/charts/bklit-theme";
import { readings, type TimePoint } from "@/components/charts/bklit-time";
import { cn } from "@/lib/utils";

/**
 * The small trend line of one measurement in a table row or a list item: a Bklit area chart with
 * no axes. It is a picture of the shape only, so the row beside it carries the numbers and
 * `label` says the same in words. With fewer than two readings it draws nothing.
 */
export function ResourceTrend({
  points,
  label,
  className,
}: {
  points: TimePoint[];
  /** What the line shows, with its peak, for a screen reader. */
  label: string;
  className?: string;
}) {
  if (readings(points).length < 2) return null;
  return (
    <div role="img" aria-label={label} className={cn("w-full", className)} style={bklitThemeStyle}>
      <BklitTimeSeries points={points} label={label} height={32} compact color="var(--chart-foreground-muted)" />
    </div>
  );
}
