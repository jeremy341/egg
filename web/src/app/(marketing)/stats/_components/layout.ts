/**
 * Shared by the page and its skeleton so the two cannot drift apart.
 * The site column (`board-col`): the same edges as the top bar and footer, on
 * the 30px ruling, so the header, the section hairlines and the cards share
 * one width.
 */
export const WRAP = "board-col";
/**
 * Chart column and totals column, one cell apart. The first column is a whole
 * number of 30px cells (about 7/12 of the column), so the split lands on a
 * ruling line. Browsers without `round()` keep the plain 7:5 split. Stacks
 * below 1024px.
 */
export const GRID =
  "grid gap-[30px] lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] lg:items-start supports-[width:round(up,1px,1px)]:lg:grid-cols-[round(down,calc((100%_-_30px)*7/12),30px)_minmax(0,1fr)]";
/** Square frame on the pixel grid, as the docs tiles are. */
export const FRAME = "border bg-background";
/** Height of the bar area. */
export const PLOT_H = "h-32";
/** A totals row: label and hint on the left, figure on the right. */
export const ROW = "grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 px-5 py-4";
/** A section after the first: a hairline across the column, 2 cells either side on desktop, 1 on phones. */
export const SECTION = "mt-[30px] border-t pt-[30px] lg:mt-[60px] lg:pt-[60px]";
/** Blocks inside a section, one cell apart. */
export const STACK = "mt-8 flex flex-col gap-[30px]";
