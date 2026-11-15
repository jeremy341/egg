import { cn } from "@/lib/utils";

/**
 * The page's display grammar. A cell is one square of the 30px background
 * grid. Ghost is the unlit square, ink is lit, accent marks what is live
 * right now, and fail is an outline with an empty middle. Colour is never the
 * only signal: every readout that uses these carries text for each state.
 * The styles are in globals.css under "board column and readout".
 */
export type CellState = "ghost" | "ink" | "accent" | "fail";

export function Cell({ state, className, style }: { state: CellState; className?: string; style?: React.CSSProperties }) {
  return <span aria-hidden="true" data-state={state} className={cn("rd-cell", className)} style={style} />;
}
