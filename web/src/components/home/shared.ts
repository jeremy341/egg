/*
 * The homepage type scale and section rhythm. Four text sizes do all the work:
 * display (the hero only), section, item, and body. Spacing is in steps of the
 * 30px background cell.
 */

/** Hero headline only. 88px at 1440 wide, 36px on a phone (each sentence holds one line at 375). */
export const DISPLAY = "font-pixel text-[clamp(2.25rem,6.2vw,5.5rem)] leading-[1] font-medium text-balance";

/** Section headings. 48px at 1440 wide, 32px on a phone. */
export const H2 = "font-pixel text-[clamp(2rem,3.4vw,3rem)] leading-[1.08] font-medium text-balance";

/** Item headings inside a section, in the body face. */
export const H3 = "text-[1.1875rem] leading-[1.875rem] font-semibold tracking-[-0.01em] text-foreground";

/** Body copy: 17px on 28px, near-black, never wider than a comfortable line. */
export const BODY = "text-[1.0625rem] leading-[1.75rem] text-reading";

/** Captions, legends and footnotes. */
export const SMALL = "text-[0.875rem] leading-6 text-muted-foreground";

/** Every section: the page column, one gap above it, and room under the sticky bar for anchor jumps. */
export const SECTION = "board-col scroll-mt-[60px] pt-[90px] lg:pt-[150px]";

/** Logs, tables and panels sit on the plain surface so the grid never runs through text. */
export const FRAME = "border border-border bg-background";

/** Square buttons, 48px tall, full width on a phone. One filled (Sign in), one outlined. */
export const BUTTON =
  "pressable inline-flex h-12 items-center justify-center px-6 text-[0.9375rem] font-medium whitespace-nowrap outline-offset-2 focus-visible:outline-2 focus-visible:outline-[var(--ds-focus-color)] max-sm:w-full";
export const BUTTON_PRIMARY =
  "bg-foreground text-background transition-[background-color] duration-(--dur-fast) hover:bg-[color-mix(in_oklab,var(--foreground)_84%,var(--background))]";
export const BUTTON_SECONDARY =
  "border border-border bg-background text-foreground transition-[background-color] duration-(--dur-fast) hover:bg-[var(--ds-gray-100)]";
