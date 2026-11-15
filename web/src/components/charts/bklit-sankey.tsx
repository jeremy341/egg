"use client";

import { MotionConfig } from "motion/react";
import { useMemo } from "react";
import { SankeyChart, SankeyLink, SankeyNode, SankeyTooltip } from "@/components/charts/bklit/sankey";
import { TooltipContent } from "@/components/charts/bklit/tooltip/tooltip-content";
import { useReducedChartMotion } from "@/components/charts/bklit-kit";
import { bklitThemeStyle } from "@/components/charts/bklit-theme";
import { nodeTotals, sankeyProblem, type Flow, type FlowNode } from "@/components/charts/bklit-chart-data";

const number = new Intl.NumberFormat("en");

export type BklitSankeyProps = {
  /** The boxes. `id` is what the flows name; `label` is drawn and must be unique. Two to about 14 nodes read well. */
  nodes: readonly FlowNode[];
  /**
   * What moves between them, from one node's `id` to another's. Each value must be above zero, a pair
   * may appear once per direction, and the flows must not run in a circle. Two to about 24 flows read well.
   */
  flows: readonly Flow[];
  /** How a number is written in labels and the tooltip. Default: "1,234". */
  formatValue?: (n: number) => string;
  /** What the numbers count, written after a number: "sessions". Default: nothing. */
  unit?: string;
  /** CSS aspect ratio, "width / height". Default: "16 / 9". */
  aspectRatio?: string;
  /**
   * Room left and right of the boxes for their labels, in pixels. Default: 96 for labels beside the
   * boxes, 28 for `verticalLabels`. Under about 480 pixels wide, use `verticalLabels`.
   */
  labelSpace?: number;
  /** Turn the labels a quarter turn so they read along the box. Default: false. */
  verticalLabels?: boolean;
  className?: string;
};

/**
 * Bklit's Sankey Chart with Egg's colours: boxes joined by bands as wide as what flows. Hovering a box or a
 * band fades the rest and opens a tooltip: a box says what comes in and what goes out, a band says "A to B"
 * and its number. A box's printed number is what flows into it, or what flows out of it when nothing flows in.
 * Draws a short sentence instead of the chart when the flows cannot be laid out (see `sankeyProblem`).
 */
export function BklitSankey({
  nodes,
  flows,
  formatValue = (n) => number.format(n),
  unit,
  aspectRatio = "16 / 9",
  labelSpace,
  verticalLabels = false,
  className,
}: BklitSankeyProps) {
  const reduced = useReducedChartMotion();
  const problem = sankeyProblem(nodes, flows);
  const data = useMemo(() => {
    if (problem !== null) return null;
    const index = new Map(nodes.map((n, i) => [n.id, i]));
    return {
      nodes: nodes.map((n) => ({ name: n.label })),
      links: flows.map((f) => ({ source: index.get(f.from) as number, target: index.get(f.to) as number, value: f.value })),
    };
  }, [nodes, flows, problem]);
  const totals = useMemo(() => nodeTotals(nodes, flows), [nodes, flows]);
  const withUnit = (n: number) => (unit ? `${formatValue(n)} ${unit}` : formatValue(n));
  const space = labelSpace ?? (verticalLabels ? 28 : 96);
  const margin = useMemo(() => ({ top: 16, bottom: 16, left: space, right: space }), [space]);

  if (problem !== null || data === null) {
    return (
      <p style={bklitThemeStyle} className={className ?? "text-label text-muted-foreground"}>
        These flows cannot be drawn: {problem}
      </p>
    );
  }

  return (
    <MotionConfig reducedMotion={reduced ? "always" : "never"}>
      <div style={bklitThemeStyle} className={className}>
        <SankeyChart
          data={data}
          aspectRatio={aspectRatio}
          margin={margin}
          nodeWidth={12}
          nodePadding={verticalLabels ? 16 : 20}
          animationDuration={reduced ? 0 : undefined}
          enterTransition={reduced ? { type: "tween", duration: 0 } : undefined}
        >
          <SankeyLink stroke="var(--chart-line-secondary)" strokeOpacity={0.3} />
          <SankeyNode
            fill="var(--chart-line-primary)"
            formatValue={withUnit}
            labelOrientation={verticalLabels ? "vertical" : "horizontal"}
          />
          <SankeyTooltip
            exit={!reduced}
            nodeContent={({ node }) => {
              const id = nodes[node.index ?? 0]?.id ?? "";
              const t = totals.get(id);
              const rows = [
                ...(t?.hasIn ? [{ color: "var(--chart-line-primary)", label: "In", value: withUnit(t.into) }] : []),
                ...(t?.hasOut ? [{ color: "var(--chart-line-secondary)", label: "Out", value: withUnit(t.out) }] : []),
              ];
              return <TooltipContent title={node.name} rows={rows} />;
            }}
            linkContent={({ link }) => {
              const nameOf = (n: unknown) => (typeof n === "number" ? nodes[n]?.label : (n as { name?: string }).name);
              const from = nameOf(link.source);
              const to = nameOf(link.target);
              return (
                <TooltipContent
                  title={`${from} to ${to}`}
                  rows={[{ color: "var(--chart-line-secondary)", label: "Flow", value: withUnit(link.value) }]}
                />
              );
            }}
          />
        </SankeyChart>
      </div>
    </MotionConfig>
  );
}
