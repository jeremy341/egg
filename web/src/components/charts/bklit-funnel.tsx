"use client";

import { MotionConfig } from "motion/react";
import { useMemo } from "react";
import { FunnelChart } from "@/components/charts/bklit/funnel-chart";
import { useReducedChartMotion } from "@/components/charts/bklit-kit";
import { bklitThemeStyle } from "@/components/charts/bklit-theme";
import { funnelProblem, type FunnelStep } from "@/components/charts/bklit-chart-data";

const number = new Intl.NumberFormat("en");

export type BklitFunnelProps = {
  /**
   * The steps, first to last, each with its own number. Every step is drawn against the first one, so
   * the first must be above zero. A step bigger than the one before it is drawn bigger; nothing is
   * evened out. Three to eight steps with short labels read well.
   */
  steps: readonly FunnelStep[];
  /** Left to right ("horizontal", default) or top to bottom. */
  orientation?: "horizontal" | "vertical";
  /** How a step's number is written. Default: "1,234". A step's own `displayValue` wins. */
  formatValue?: (n: number) => string;
  /** The pill with each step's share of the first step. Default: true. */
  showPercentage?: boolean;
  /** "spread" puts the number, the share and the label apart; "grouped" stacks them. Default: "spread". */
  labelLayout?: "spread" | "grouped";
  /** CSS aspect ratio, "width / height". Default: "2.2 / 1" across, "1 / 1.8" down. */
  aspectRatio?: string;
  className?: string;
};

/**
 * Bklit's Funnel Chart with Egg's colours. It has no tooltip: each step prints its number, its share
 * of the first step and its label on the shape, and hovering a step dims the others. Returns nothing
 * when the steps cannot be drawn (see `funnelProblem`), so the card can say why instead.
 */
export function BklitFunnel({
  steps,
  orientation = "horizontal",
  formatValue = (n) => number.format(n),
  showPercentage = true,
  labelLayout = "spread",
  aspectRatio,
  className,
}: BklitFunnelProps) {
  const reduced = useReducedChartMotion();
  const data = useMemo(() => steps.map((s) => ({ label: s.label, value: s.value, displayValue: s.displayValue })), [steps]);
  if (funnelProblem(steps) !== null) return null;
  return (
    <MotionConfig reducedMotion={reduced ? "always" : "never"}>
      <div style={bklitThemeStyle} className={className}>
        <FunnelChart
          data={data}
          orientation={orientation}
          color="var(--chart-line-primary)"
          formatValue={formatValue}
          showPercentage={showPercentage}
          labelLayout={labelLayout}
          style={aspectRatio ? { aspectRatio } : undefined}
          staggerDelay={reduced ? 0 : undefined}
          enterTransition={reduced ? { type: "tween", duration: 0 } : undefined}
          animateLabels={!reduced}
        />
      </div>
    </MotionConfig>
  );
}
