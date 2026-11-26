"use client";

import { MotionConfig } from "motion/react";
import type { FeatureCollection, Geometry } from "geojson";
import {
  ChoroplethChart,
  ChoroplethFeatureComponent,
  ChoroplethTooltip,
  type ChoroplethFeatureProperties,
} from "@/components/charts/bklit/choropleth";
import { TooltipContent, type TooltipRow } from "@/components/charts/bklit/tooltip/tooltip-content";
import { useReducedChartMotion } from "@/components/charts/bklit-kit";

/**
 * A Bklit choropleth (filled map) for the analytics cards. Like the other kit charts it reads its
 * colours from the `--chart-*` variables set by `bklitThemeStyle` on the card, and it stands still
 * when motion is reduced. It draws what it is given: `fill` picks the colour of a region and
 * `tooltip` its hover text. Zoom is off.
 */
export type MapProps = {
  data: FeatureCollection<Geometry, ChoroplethFeatureProperties>;
  /** A CSS colour (a variable) for a region, from its properties. */
  fill: (properties: ChoroplethFeatureProperties) => string;
  tooltip: (properties: ChoroplethFeatureProperties) => { title: string; rows: TooltipRow[] };
  aspectRatio?: string;
};

export function BklitMap({ data, fill, tooltip, aspectRatio = "2 / 1" }: MapProps) {
  const reduced = useReducedChartMotion();
  return (
    <MotionConfig reducedMotion={reduced ? "always" : "never"}>
      <ChoroplethChart aspectRatio={aspectRatio} animationDuration={reduced ? 0 : 800} data={data}>
        <ChoroplethFeatureComponent
          getFeatureColor={(f) => fill(f.properties ?? {})}
          stroke="var(--chart-background)"
          strokeWidth={0.5}
        />
        <ChoroplethTooltip
          content={({ feature }) => {
            const t = tooltip(feature.properties ?? {});
            return <TooltipContent title={t.title} rows={t.rows} />;
          }}
        />
      </ChoroplethChart>
    </MotionConfig>
  );
}
