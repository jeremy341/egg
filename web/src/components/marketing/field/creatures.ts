/**
 * The chicken of the site, as data. Nothing here touches the DOM.
 *
 * A sprite frame is a list of rows on the cell grid. In a row:
 *   "."        an empty cell
 *   "1" to "5" a coloured cell, from the dim edge (1) to the bright core (5)
 *   "0"        a hole: empty, and kept clear of the glow (an eye, the highlight of the egg)
 *   any other  a keyboard character drawn in the cell (legs, beaks, tails, eyes)
 * Frames face right. The field turns them (through a narrow in-between) when a creature turns.
 *
 * The chicken has many poses and the field cross-fades from one to the next, so an action reads
 * as one movement. The rocking and cracking egg are drawn by small functions here; the result is
 * still plain frames. It is drawn `scale` cells to a sprite cell, so it can be big and still crisp.
 *
 * It has one hue with two ramps of five colours: `dark` for the near-black page
 * (the core is the lightest colour, so it glows) and `light` for the white page (the core is the
 * deepest colour, so it does not wash out).
 */

export type Frame = readonly string[];

export interface Species {
  id: string;
  name: string;
  ramp: { dark: readonly string[]; light: readonly string[] };
  frames: readonly Frame[];
  /**
   * Named pose sequences (indexes into `frames`): `move` and `rest`, `hop`, `flap`, `peep` (the
   * peck and the cheep) and `intro` (the hatch).
   */
  seq: Readonly<Record<string, readonly number[]>>;
  /** Poses per second through `move`. */
  fps: number;
  /** How many are on the page at phone, tablet and desktop widths. */
  count: readonly [number, number, number];
  /** Cruising speed in cells per second, and how fast the speed follows the wish (1/s). */
  speed: number;
  accel: number;
  /** The most it can turn, in radians per second. 0: it does not bank, it slows and reverses. */
  turn: number;
  /** Seconds it stays put after arriving, [min, max]. [0, 0] never stops. */
  rest: readonly [number, number];
  /** Above zero it comes to the pointer, below zero it keeps away. `reach` is in cells. */
  pointer: number;
  reach: number;
  /** Characters it leaves behind while moving. */
  wake: string;
  /** Radius of the cell halo around the body, in cells. */
  glow: number;
  /** Every sprite cell is drawn as `scale` by `scale` grid cells, so the chicken is that much bigger. */
  scale: number;
}

type Grid = string[][];
const grid = (rows: Frame): Grid => rows.map((r) => [...r]);
const frame = (g: Grid): Frame => g.map((r) => r.join(""));
/** A row moved sideways by whole cells. */
const shift = (row: string, by: number) =>
  by > 0 ? ".".repeat(by) + row.slice(0, row.length - by) : row.slice(-by) + ".".repeat(-by);

/* ---- chick --------------------------------------------------------------------------------- */

const CHICK_STAND: Frame = [
  "....3443...",
  "...455554..",
  "...455054>.",
  "..3555554..",
  "2345533554.",
  "1345345554.",
  ".234555543.",
  "...34443...",
  "....L.L....",
];
/** Before the jump and on landing: a row shorter, wider at the base, feet apart. */
const CHICK_SQUASH: Frame = [
  "...........",
  "....3443...",
  "...455554..",
  "...455054>.",
  "2345533554.",
  "1345345554.",
  "2345555554.",
  "..3444443..",
  "...L...L...",
];
/** Leaving the ground: a row taller, feet trailing. */
const CHICK_STRETCH: Frame = [
  "....3443...",
  "...455554..",
  "...455054>.",
  "..3555554..",
  "..3555554..",
  "2345533554.",
  "1345345554.",
  ".234555543.",
  "...34443...",
  "....'.'....",
];
/** The top of the hop: wing lifted, feet tucked. */
const CHICK_APEX: Frame = [
  "....3443...",
  "...455554..",
  "...455054>.",
  "..3553554..",
  "2345335554.",
  "1345555554.",
  ".234555543.",
  "...34443...",
  "..././.....",
];
const CHICK_PEEP: Frame = [
  "....3443...",
  "...455554..",
  "...455054<.",
  "..3555554..",
  "2345533554.",
  "1345345554.",
  ".234555543.",
  "...34443...",
  "....L.L....",
];
/** The loud part of the peep: head up, beak open and raised. */
const CHICK_PEEP_UP: Frame = [
  "....3443...",
  "...455554<.",
  "...455054..",
  "...455554..",
  "..3555554..",
  "2345533554.",
  "1345345554.",
  ".234555543.",
  "...34443...",
  "....L.L....",
];
const CHICK_FLAP_UP: Frame = [
  ".1..3443...",
  ".23455554..",
  "..3455054>.",
  "..3455554..",
  ".234555554.",
  ".134555554.",
  ".234555543.",
  "...34443...",
  "....'.'....",
];
const CHICK_FLAP_MID: Frame = [
  "....3443...",
  "...455554..",
  "...455054>.",
  ".23555554..",
  "1234555554.",
  ".134555554.",
  ".234555543.",
  "...34443...",
  "....'.'....",
];
const CHICK_FLAP_DOWN: Frame = [
  "....3443...",
  "...455554..",
  "...455054>.",
  "..3555554..",
  ".234555554.",
  "1233555554.",
  "12.4555543.",
  "...34443...",
  "....'.'....",
];

/**
 * The Egg mark (5 by 6, see egg-mark.tsx) at twice the size, with its highlight left empty. It is
 * padded to the chick's width so both sit on the same cells.
 */
const EGG: Frame = [
  "..344443...",
  "..455554...",
  "..455554...",
  "..455554...",
  "3400555543.",
  "4500555554.",
  "4555555554.",
  "4555555554.",
  "3455555543.",
  "2345555432.",
  "..344443...",
  "..234432...",
];
/** The egg rocking: its top leans a cell to one side. */
const eggLean = (by: number): Frame => EGG.map((row, y) => (y < 4 ? shift(row, by) : row));
/** A crack across the middle, `width` characters long (0 to 8), growing from the centre. */
function eggCrack(width: number): Frame {
  const g = grid(EGG);
  for (const x of [4, 5, 3, 6, 2, 7, 1, 8].slice(0, width)) g[5][x] = x % 2 ? "/" : "\\";
  return frame(g);
}
/** The shell halves part: the top lifts and tips back, and the chick's head shows in the gap. */
const EGG_OPEN: Frame = [
  ...EGG.slice(0, 5).map((row) => shift(row, -1)),
  "...3443....",
  "..455554...",
  ...eggCrack(8).slice(5),
];

export const SPECIES: readonly Species[] = [
  {
    id: "chick",
    name: "chick",
    ramp: {
      dark: ["#b45309", "#d97706", "#f59e0b", "#fbbf24", "#fde68a"],
      light: ["#f7b733", "#f09a0c", "#dd7d02", "#c26204", "#9a4a06"],
    },
    frames: [
      CHICK_STAND,
      CHICK_SQUASH,
      CHICK_STRETCH,
      CHICK_APEX,
      CHICK_PEEP,
      CHICK_PEEP_UP,
      CHICK_FLAP_UP,
      CHICK_FLAP_MID,
      CHICK_FLAP_DOWN,
      EGG,
      eggLean(-1),
      eggLean(1),
      eggCrack(2),
      eggCrack(5),
      eggCrack(8),
      EGG_OPEN,
    ],
    seq: {
      move: [1, 2, 3, 2, 1, 0],
      rest: [0],
      hop: [1, 2, 3, 2, 1, 0],
      flap: [6, 7, 8, 7],
      peep: [0, 4, 5, 4, 0],
      intro: [9, 10, 9, 11, 9, 10, 9, 12, 13, 14, 15, 15],
    },
    fps: 13,
    count: [2, 3, 4],
    speed: 8,
    accel: 5,
    turn: 0,
    rest: [1.2, 4],
    pointer: 1,
    reach: 50,
    wake: ",'",
    glow: 2,
    scale: 2,
  },
];

/** Characters that are not part of a sprite: bits of shell when a chick hatches. */
export const SHELL = "()',";

/** How opaque each shade is, dim edge to bright core. */
export const SHADE_ALPHA = {
  dark: [0.42, 0.62, 0.84, 1, 1],
  light: [0.4, 0.62, 0.84, 1, 1],
} as const;

/** The keyboard characters: a light grey on the dark page, a dark grey on the white one. */
export const INK = { dark: "#e4e4e4", light: "#2e2e2e" } as const;

/**
 * Over text every cell and character is drawn at this fraction of its strength, so the text keeps
 * its contrast whatever passes under it (checked in creatures.test.ts).
 */
export const TEXT_DIM = 0.13;
