/**
 * The creatures of the homepage field, as data. Nothing here touches the DOM.
 *
 * A sprite frame is a list of rows on the cell grid. In a row:
 *   "."        an empty cell
 *   "1" to "5" a coloured cell, from the dim edge (1) to the bright core (5)
 *   "0"        a hole: empty, and kept clear of the glow (an eye, the highlight of the egg)
 *   any other  a keyboard character drawn in the cell (legs, beaks, tails, eyes)
 * Frames face right. The field turns them (through a narrow in-between) when a creature turns.
 *
 * A creature has many poses and the field cross-fades from one to the next, so an action reads
 * as one movement. Poses that are easy to get wrong by hand are drawn by small functions here
 * (the wing beats, the rocking and cracking egg); the result is still plain frames.
 *
 * Every creature has one hue with two ramps of five colours: `dark` for the near-black page
 * (the core is the lightest colour, so it glows) and `light` for the white page (the core is the
 * deepest colour, so it does not wash out).
 */

export type Mode = "hop" | "fly" | "perch" | "swim" | "dart" | "pulse";

export type Frame = readonly string[];

export interface Species {
  id: string;
  /** The label on the switcher. */
  name: string;
  mode: Mode;
  ramp: { dark: readonly string[]; light: readonly string[] };
  frames: readonly Frame[];
  /**
   * Named pose sequences (indexes into `frames`). Every creature has `move` and `rest`; the
   * others belong to its way of moving: `hop`, `flap`, `peep` and `intro` (the hatch) for the
   * chick, `blink`, `look` (away, towards) and `crouch` for the owl.
   */
  seq: Readonly<Record<string, readonly number[]>>;
  /** Poses per second through `move`. */
  fps: number;
  /** How many are on the field at phone, tablet and desktop widths. */
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
  /** Stands on a grid line (drawn from its feet up) instead of floating around its centre. */
  ground?: boolean;
}

type Grid = string[][];
const grid = (rows: Frame): Grid => rows.map((r) => [...r]);
const frame = (g: Grid): Frame => g.map((r) => r.join(""));
/** Colour a cell unless something brighter, or a character, is already there. */
function dot(g: Grid, x: number, y: number, shade: number) {
  const cx = Math.round(x);
  const cy = Math.round(y);
  const old = g[cy]?.[cx];
  if (old === undefined || shade < 1) return;
  if (old === "." || (old >= "1" && old <= "5" && Number(old) < shade)) g[cy][cx] = String(Math.min(5, shade));
}
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

/* ---- swallow ------------------------------------------------------------------------------- */

const SWALLOW_BODY: Frame = [
  "...............",
  "...............",
  "...............",
  "...............",
  "\\-.............",
  "..23344444445>.",
  "/-...555555....",
  "...............",
  "...............",
  "...............",
  "...............",
];
/**
 * One pose of the wing beat. The wing is a tapered blade from the shoulder: `lift` (1 up, -1
 * down) raises it, a flat wing sweeps back along the body, and the tip lags behind the stroke.
 */
export function swallowPose(k: number, of: number): Frame {
  const g = grid(SWALLOW_BODY);
  const phase = (k / of) * Math.PI * 2;
  const lift = Math.sin(phase);
  const lag = Math.cos(phase) * 1.4;
  const up = lift >= 0 ? 1 : -1;
  for (let s = 0.08; s <= 1.001; s += 0.04) {
    const x = 8.5 - s * 5.5 * (0.3 + (1 - Math.abs(lift)) * 0.6) - lag * s * s * up;
    const y = (up > 0 ? 5 : 6) - up * Math.min(1, s * 5) - lift * 4.2 * s;
    const shade = Math.round(4.4 - s * 3.4);
    dot(g, x, y, shade);
    if (s < 0.7) dot(g, x + 1, y, shade);
  }
  return frame(g);
}
const SWALLOW = Array.from({ length: 8 }, (_, k) => swallowPose(k, 8));

/* ---- owl ----------------------------------------------------------------------------------- */

const owl = (eye: string, look = 0): Frame => [
  "23.....32",
  "345555543",
  shift(`45${eye}545${eye}54`, look).replace(/^\./, "4").replace(/\.$/, "4"),
  shift("4555v5554", look).replace(/^\./, "4").replace(/\.$/, "4"),
  "345555543",
  "234545432",
  "234454432",
  ".2345432.",
  "..23432..",
  "..m...m..",
];
/** About to take off, or just landed: lower by a row. */
const OWL_CROUCH: Frame = [".........", ...owl("O").slice(0, 6), ...owl("O").slice(7)];
const OWL_UP: Frame = [
  "12...23.....32...21",
  "234..345555543..432",
  ".234445O545O544432.",
  "..2344555v5554432..",
  ".....345555543.....",
  ".....234545432.....",
  "......2345432......",
  ".......23432.......",
];
const OWL_LEVEL: Frame = [
  ".....23.....32.....",
  ".....345555543.....",
  "1234445O545O5444321",
  ".23444555v55544432.",
  ".....345555543.....",
  ".....234545432.....",
  "......2345432......",
  ".......23432.......",
];
const OWL_DOWN: Frame = [
  ".....23.....32.....",
  ".....345555543.....",
  "..23445O545O54432..",
  ".23444555v55544432.",
  "234..345555543..432",
  "12...234545432...21",
  "......2345432......",
  ".......23432.......",
];

/* ---- dragonfly ----------------------------------------------------------------------------- */

const DRAGONFLY_BODY: Frame = [
  "...............",
  "...............",
  "...............",
  "...............",
  "-------34554:..",
  "...............",
  "...............",
  "...............",
  "...............",
];
/** One pose of the wing flicker: two pairs of thin wings that sweep fore and aft, out of step. */
export function dragonflyPose(k: number, of: number): Frame {
  const g = grid(DRAGONFLY_BODY);
  const phase = (k / of) * Math.PI * 2;
  const wings: [number, number, number][] = [
    [9.4, Math.sin(phase) * 2.2 - 0.4, 3],
    [8, Math.sin(phase + 1.4) * 2.2 + 1.2, 2],
  ];
  for (const [root, sweep, shade] of wings) {
    for (const side of [-1, 1]) {
      for (let s = 0.2; s <= 1.001; s += 0.05) {
        const x = root - sweep * s * s;
        dot(g, x, 4 + side * s * 4, s > 0.75 ? shade - 1 : shade);
        if (s > 0.3 && s < 0.8) dot(g, x - 1, 4 + side * s * 4, shade - 1);
      }
    }
  }
  return frame(g);
}
const DRAGONFLY = Array.from({ length: 6 }, (_, k) => dragonflyPose(k, 6));

/* ---- firefly and koi ----------------------------------------------------------------------- */

const FIREFLY_UP: Frame = [".'.'.", ".232.", ".454.", "..4.."];
const FIREFLY_HALF: Frame = ["'...'", ".232.", ".454.", "..4.."];
const FIREFLY_OUT: Frame = [".....", "-232-", ".454.", "..4.."];

/**
 * The koi is seen from above and bends as it swims, so it is not a fixed picture: each row here
 * is one slice across its body, from nose to tail, and the field lays the slices along its spine.
 */
const KOI: Frame = [
  "..4..",
  ".454.",
  ".555.",
  "25452",
  "15451",
  ".455.",
  ".544.",
  ".454.",
  "..5..",
  "..4..",
  ".3.3.",
  "2...2",
];

export const SPECIES: readonly Species[] = [
  {
    id: "chick",
    name: "chick",
    mode: "hop",
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
    count: [3, 5, 7],
    speed: 5,
    accel: 5,
    turn: 0,
    rest: [1.2, 4],
    pointer: 1,
    reach: 30,
    wake: ",'",
    glow: 2,
    ground: true,
  },
  {
    id: "swallow",
    name: "swallow",
    mode: "fly",
    ramp: {
      dark: ["#1e40af", "#2563eb", "#3b82f6", "#60a5fa", "#bfdbfe"],
      light: ["#7fb0fb", "#4a8af4", "#2563eb", "#1d4ed8", "#1e3a8a"],
    },
    frames: SWALLOW,
    seq: { move: [0, 1, 2, 3, 4, 5, 6, 7], rest: [0] },
    fps: 22,
    count: [3, 4, 6],
    speed: 17,
    accel: 2.5,
    turn: 2.6,
    rest: [0, 0],
    pointer: -1,
    reach: 16,
    wake: "-~-",
    glow: 1,
  },
  {
    id: "owl",
    name: "owl",
    mode: "perch",
    ramp: {
      dark: ["#57534e", "#857b6e", "#b3a792", "#d9cdb8", "#f5eede"],
      light: ["#b7a995", "#93826c", "#74634f", "#57483a", "#3b3026"],
    },
    frames: [owl("o"), owl("O"), owl("u"), owl("-"), owl("O", -1), owl("O", 1), OWL_CROUCH, OWL_UP, OWL_LEVEL, OWL_DOWN],
    seq: { move: [7, 8, 9, 8], rest: [0], blink: [2, 3, 2], look: [4, 5], alert: [1], crouch: [6] },
    fps: 9,
    count: [2, 4, 5],
    speed: 11,
    accel: 2.2,
    turn: 0,
    rest: [4, 9],
    pointer: -1,
    reach: 11,
    wake: "'",
    glow: 2,
    ground: true,
  },
  {
    id: "koi",
    name: "koi",
    mode: "swim",
    ramp: {
      dark: ["#9a2a12", "#d9421c", "#f4623a", "#ff8a65", "#ffe9df"],
      light: ["#f9a58c", "#f4623a", "#e03e16", "#b92d0c", "#7a1c05"],
    },
    frames: [KOI],
    seq: { move: [0], rest: [0] },
    fps: 1,
    count: [3, 4, 6],
    speed: 5.5,
    accel: 1.6,
    turn: 1.5,
    rest: [0, 0],
    pointer: 1,
    reach: 30,
    wake: "~o~",
    glow: 2,
  },
  {
    id: "dragonfly",
    name: "dragonfly",
    mode: "dart",
    ramp: {
      dark: ["#115e59", "#0f766e", "#14b8a6", "#2dd4bf", "#99f6e4"],
      light: ["#5fd9c8", "#17b3a2", "#0d9488", "#0f766e", "#134e4a"],
    },
    frames: DRAGONFLY,
    seq: { move: [0, 1, 2, 3, 4, 5], rest: [0, 1, 2, 3, 4, 5] },
    fps: 30,
    count: [3, 5, 7],
    speed: 26,
    accel: 5,
    turn: 9,
    rest: [0.5, 1.8],
    pointer: -1,
    reach: 13,
    wake: "-:",
    glow: 1,
  },
  {
    id: "firefly",
    name: "firefly",
    mode: "pulse",
    ramp: {
      dark: ["#3f6212", "#65a30d", "#a3e635", "#d9f99d", "#f7fee7"],
      light: ["#a3d94a", "#84cc16", "#65a30d", "#4d7c0f", "#365314"],
    },
    frames: [FIREFLY_UP, FIREFLY_HALF, FIREFLY_OUT],
    seq: { move: [0, 1, 2, 1], rest: [0, 1, 2, 1] },
    fps: 14,
    count: [7, 11, 16],
    speed: 2.4,
    accel: 1.4,
    turn: 2.5,
    rest: [0, 0],
    pointer: 1,
    reach: 24,
    wake: "*'",
    glow: 4,
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
 * Behind the hero text every cell and character is drawn at this fraction of its strength, so the
 * text keeps its contrast whatever passes under it (checked in creatures.test.ts).
 */
export const TEXT_DIM = 0.13;
