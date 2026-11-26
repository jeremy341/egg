/**
 * Shared by the page and its skeleton so the two cannot drift apart.
 * The site column (`board-col`): the same edges as the top bar and footer, on
 * the 30px ruling, so the header, the surface and its rules share one width.
 */
export const WRAP = "board-col";
/**
 * The one white surface every figure sits on, over the pixel grid. Sections
 * and rows inside it are separated by single hairlines, never by gaps, so the
 * page reads as one ruled sheet: section, then group, then figure.
 */
export const SURFACE = "divide-y border bg-background";
/** Padding of a block on the surface: one 30px cell on tablets and up, two thirds of it on phones. */
export const PAD = "p-5 sm:p-[30px]";
/** One cell of a figure grid. The right and bottom hairlines are clipped at the grid's edge by CELLS. */
export const CELL = "border-r border-b p-5 sm:p-[30px]";
/** The grid of cells. Negative margins push the outer hairlines out of the clipping wrapper. */
export const CELLS = "-mr-px -mb-px grid";
/** Two blocks side by side from 1024px, one above the other below, with one hairline between them. */
export const SPLIT = "divide-y lg:divide-x lg:divide-y-0";
/** Height of the bar area. */
export const PLOT_H = "h-40";

/** The public pages keep the Egg look, so chart marks are the page's own ink and not an app theme colour. */
export const INK = "var(--foreground)";
/** Share of the scale a hatched stub takes. It stands for "fewer than 10" and is not to scale on purpose. */
export const STUB_SHARE = 0.14;

type Mark = { key: string; label: string; color: string; hatched?: boolean };

/**
 * The two marks of a count chart: a solid bar for a figure of 10 or more, a hatched stub for a
 * bound. Both carry the same name, so the tooltip reads "Deployments: fewer than 10".
 */
export function countSeries(label: string): Mark[] {
  return [
    { key: "value", label, color: INK },
    { key: "few", label, color: INK, hatched: true },
  ];
}

/** The key under a count chart. `solid` says what a solid bar is. */
export function countLegend(solid: string): Mark[] {
  return [
    { key: "value", label: solid, color: INK },
    { key: "few", label: "Fewer than 10 (height not to scale)", color: INK, hatched: true },
  ];
}
