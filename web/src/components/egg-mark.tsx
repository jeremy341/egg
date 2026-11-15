import { cn } from "@/lib/utils";

/**
 * The mark: an egg drawn in pixels on a 5 by 6 grid. Narrow shoulders, a full
 * belly, and one cell left empty for the highlight. One colour, so it works in
 * black, white or anything else that sets `color`.
 */
const ROWS = [
  ".XXX.",
  ".XXX.",
  "XXXXX",
  "XXXXX",
  "XXXXX",
  ".XXX.",
];

/** The highlight is a hole in the egg, so it reads on any background. */
const HIGHLIGHT = "1-2";

const CELLS: [number, number][] = ROWS.flatMap((row, y) =>
  [...row].flatMap((cell, x): [number, number][] =>
    cell === "X" && `${x}-${y}` !== HIGHLIGHT ? [[x, y]] : [],
  ),
);

export function EggMark({ className }: { className?: string }) {
  return (
    <svg
      role="img"
      viewBox="0 0 5 6"
      shapeRendering="crispEdges"
      fill="currentColor"
      className={cn("size-6", className)}
    >
      <title>Egg</title>
      {CELLS.map(([x, y]) => (
        <rect key={`${x}-${y}`} x={x} y={y} width="1" height="1" fill="currentColor" />
      ))}
    </svg>
  );
}
