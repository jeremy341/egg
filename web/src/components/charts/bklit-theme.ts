import type { CSSProperties } from "react";

/**
 * Bklit UI colours its charts through `--chart-*` variables. This maps each one to an Egg
 * token, so the chart follows the active colour theme in light and dark. The variables are
 * set on the chart's own wrapper, so nothing outside it changes. No colour is written here
 * as a value: every entry is `var(--token)`.
 */
export const bklitTokens = {
  "--chart-background": "var(--card)",
  "--chart-foreground": "var(--foreground)",
  "--chart-foreground-muted": "var(--muted-foreground)",
  "--chart-label": "var(--muted-foreground)",
  "--chart-line-primary": "var(--primary)",
  "--chart-line-secondary": "var(--muted-foreground)",
  // The second series of a chart that has two: a mid grey that stays apart from the first in light and dark.
  "--chart-series-2": "var(--ds-gray-700)",
  "--chart-crosshair": "var(--muted-foreground)",
  "--chart-grid": "var(--border)",
  "--chart-indicator-color": "var(--primary)",
  "--chart-indicator-secondary-color": "var(--muted-foreground)",
  "--chart-marker-background": "var(--card)",
  "--chart-marker-border": "var(--primary)",
  "--chart-marker-foreground": "var(--foreground)",
  "--chart-marker-badge-background": "var(--primary)",
  "--chart-marker-badge-foreground": "var(--primary-foreground)",
  "--chart-segment-background": "var(--primary)",
  "--chart-segment-line": "var(--primary)",
  "--chart-brush-border": "var(--border)",
  "--chart-tooltip-background": "var(--card)",
  "--chart-tooltip-foreground": "var(--foreground)",
  "--chart-tooltip-muted": "var(--muted-foreground)",
  // The sequential scale for maps and binned data: 01 is the faintest, 05 the strongest. Each is the
  // chart colour mixed into the card, so it follows every theme in light and dark.
  "--chart-scale-01": "color-mix(in oklab, var(--primary) 14%, var(--card))",
  "--chart-scale-02": "color-mix(in oklab, var(--primary) 32%, var(--card))",
  "--chart-scale-03": "color-mix(in oklab, var(--primary) 52%, var(--card))",
  "--chart-scale-04": "color-mix(in oklab, var(--primary) 74%, var(--card))",
  "--chart-scale-05": "color-mix(in oklab, var(--primary) 96%, var(--card))",
  "--chart-scale-pattern-color": "var(--muted-foreground)",
  // A cell with a count of zero in a heatmap: a neutral tint, so "none" is not the faintest "some".
  "--chart-heat-0": "color-mix(in oklab, var(--muted-foreground) 14%, var(--card))",
  // Status colours for a gauge's zones. They come from the app's own status tokens in every theme.
  "--chart-good": "var(--success)",
  "--chart-warning": "var(--warning)",
  "--chart-bad": "var(--destructive)",
  "--chart-1": "var(--primary)",
  "--chart-2": "var(--muted-foreground)",
  "--chart-3": "var(--foreground)",
  "--chart-4": "var(--border)",
  "--chart-5": "var(--muted-foreground)",
} as const;

export const bklitThemeStyle = bklitTokens as unknown as CSSProperties;
