/**
 * The chicken of the site: one mascot, fixed to the bottom of the window of every public page.
 *
 * It is built the way Orry, the mole of the LOADOUT homepage (jeremy341/loadout), is built, with
 * the chicken's own art:
 *
 *   pointer, page and time events -> gesture classifier -> mood meters -> state machine -> beats
 *
 * gestures.ts turns raw pointer positions into what the person did (tap, tickle, pet, scribble,
 * pinch, pick up, shake, throw, charge, stare), mood.ts keeps two meters (affection and
 * irritation) whose stages cannot change faster than a minimum time, tuning.ts holds every
 * number, and this file is the state machine, the animation and the drawing. The chicken turns up
 * soon after the page loads, stays a good while, dashes along the bottom, pecks, looks at the
 * pointer, falls asleep when it is quiet, and leaves for a short break before the next visit. A
 * reaction that has started plays to its end; only being picked up interrupts it. The chicken is
 * play, not content: it never carries information, never blocks anything, and the footer button
 * sends it away for good.
 *
 * It is drawn as characters on a grid that divides the page's 30px grid (10px cells, 6px on a
 * phone). A body cell is the character for how dense that bit of the chicken is (`.:-=+*#%@`).
 * What keeps the picture clean, as in ascii-animals, is that nothing about it is left to chance
 * or to the sub-cell position: the body sits on whole cells, one pose is drawn at a time, and the
 * character in each cell is fixed to its part of the body.
 *
 * The chicken stands on the bottom of the window, not on the page, so it stays there while the
 * page scrolls. The canvas is decoration: hidden from assistive technology, never focusable, and
 * it takes no pointer events (the window listens). Every rate is integrated for the real time
 * that passed, in steps of at most 1/60 s, and the loop only runs while the tab is visible.
 */

import { INK, SHELL, SPECIES } from "./creatures";
import { GestureTracker, type GestureEvent, type GestureFrame, type Rect } from "./gestures";
import { Mood, type IrritationStage } from "./mood";
import { coverage, glyphSet, hash, mirror, mixHex, parse, rng, smooth } from "./sim";
import { TUNING } from "./tuning";

export const STORAGE_KEY = "egg-chicken";
export const COMMAND_EVENT = "egg:chicken-command";
export const STATE_EVENT = "egg:chicken-state";
export type ChickenCommand = "hide" | "show" | "call" | "status";
export interface ChickenStatus {
  /** Whether the person has it switched on (kept in this browser). */
  enabled: boolean;
  /** Whether it is on the screen now. */
  visible: boolean;
  reduced: boolean;
  state: string;
  /** Where it stands, in window pixels: the middle of its feet, and its size. */
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Field {
  destroy(): void;
}

type State =
  | "away" | "hatch" | "idle" | "run" | "takeoff" | "fly" | "sniff" | "sleepy" | "sleep" | "wake" | "eat" | "follow"
  | "poke" | "tickle" | "pet" | "pinch" | "rub" | "swat" | "wary" | "annoyed" | "mad" | "sulk" | "stomp" | "turn" | "storm"
  | "flee" | "joy" | "held" | "fall" | "land" | "dizzy" | "stare";

/** It can start a reaction when it is doing one of these. Everything else is a sequence that plays to its end. */
const FREE: readonly State[] = ["idle", "run", "sniff", "sleepy", "sleep", "pet", "follow", "eat"];
const STAGES: readonly IrritationStage[] = ["calm", "wary", "annoyed", "angry", "furious"];

type Anim = "stand" | "run" | "dash" | "peck" | "squash" | "stretch" | "flap" | "wiggle" | "stomp" | "hatch";
type Eye = "" | "-" | "^" | "x";

interface Seed {
  x: number;
  y: number;
  vy: number;
  /** Where it comes to rest: the floor. */
  land: number;
  age: number;
}

interface Mote {
  x: number;
  y: number;
  vx: number;
  vy: number;
  ch: string;
  color: string;
  life: number;
  max: number;
  /** Size in grid cells. */
  size: number;
  /** Drawn as a small pixel heart instead of a character. */
  heart: boolean;
}

const S = SPECIES[0];
const SC = S.scale;
/** The size of a pixel for distances and speeds, so how it moves does not depend on the size of a cell. */
const U = 10;
/** Pixels a second: walking, the wing-assisted dash, and flying. */
const WALK = 150;
const DASH = 420;
const FLY = 300;
/** Pixels of walking in one cycle of the four leg poses. */
const STRIDE = 64;
const INTRO = 2.1;
const FORM = 0.5;
const MAX_MOTES = 80;
const MAX_SEEDS = 10;
const SEED_LIFE = 16;
/** The fixed header covers this much of the top of the window. */
const HEADER = 64;
/** Shades are mapped to colour in quarter steps: 1, 1.25, ... 5. */
const LEVELS = 17;
/** Body characters, from the faintest to the densest. */
const RAMP = ".:-=+*#%@";
const DOT = 0;
const SEED = RAMP.indexOf("*");
const GLYPHS = glyphSet(S.frames, S.wake + SHELL + "-^x");
/** The character to draw in place of each one when the chicken faces left. */
const FLIPPED = [...GLYPHS].map((ch) => GLYPHS.indexOf(mirror([ch])[0]));
const SPRITES = S.frames.map((f) => parse(f, SC));
const SW = SPRITES[0].w;
const SH = SPRITES[0].h;
/** The body, in grid cells. */
const BW = SW * SC;
const BH = SH * SC;
const Q = S.seq;
/** Where the eye is in each frame, in cells of the frame (null: no eye). */
const EYES = S.frames.map((f) => {
  for (let y = 0; y < f.length; y++) {
    const x = f[y].indexOf("0");
    if (x >= 0) return { x, y };
  }
  return null;
});
/** A pixel heart, row by row. */
const HEART = ["01010", "11111", "01110", "00100"];
const COLORS = { heart: "#ec4899", anger: "#ef4444", star: "#f59e0b", sweat: "#38bdf8", z: "#8b95a7" } as const;

/** A click on one of these belongs to the page, not to the chicken. */
const BUSY = "a, button, input, textarea, select, summary, label, [role='button'], [role='link'], [contenteditable], iframe, video";
/** A click on text is a click on text: it drops no seed. */
const WORDS = "h1, h2, h3, h4, p, li, pre, code, table, blockquote, figure, img, svg";

/** -1, 0 or 1, fixed for a cell of the sprite: it breaks up bands of one character. */
const jitterOf = (x: number, y: number) => Math.floor(hash(x, y, 11) * 3) - 1;
const at = (seq: readonly number[], p: number) => seq[Math.max(0, Math.min(seq.length - 1, Math.floor(p)))];

export function createField(canvas: HTMLCanvasElement, reduced: boolean, params: URLSearchParams): Field {
  const ctx = canvas.getContext("2d")!;
  const root = document.documentElement;
  const random = rng(Math.floor(performance.now() * 1000) % 2147483647);
  const atlas = document.createElement("canvas");
  /** The body characters, once per colour level: drawing a cell of the body is then a blit. */
  const ramp = document.createElement("canvas");

  // ?chicken=1 shows it after a second, ?chicken=0 keeps it away, &speed=8 runs the moods and the long holds 8 times faster.
  const forced = params.get("chicken") === "1";
  const ts = Math.min(20, Math.max(1, Number(params.get("speed")) || 1));
  let enabled = params.get("chicken") !== "0";
  try {
    if (window.localStorage.getItem(STORAGE_KEY) === "off") enabled = false;
  } catch {
    /* storage can be blocked */
  }

  let w = 0;
  let h = 0;
  let dpr = 1;
  let u = 10; // cell size
  let cols = 0;
  let rows = 0;
  /** The grid starts this far below the top of the window, so that its last row ends exactly at the bottom edge. */
  let off = 0;
  let family = "monospace";
  let trail = new Float32Array(0);
  // What the body covers this frame, per grid cell: how much of the cell, how bright, which
  // shade, which character offset, and how much is kept clear (eyes, characters).
  let liveMark = new Uint32Array(0);
  let cover = new Float32Array(0);
  let light = new Float32Array(0);
  let shadeSum = new Float32Array(0);
  let clear = new Float32Array(0);
  let jitter = new Int8Array(0);
  let glow = new Float32Array(0);
  let glowMark = new Uint32Array(0);
  let mark = 0;
  const touched: number[] = [];
  const glowing: number[] = [];
  const liveGlyphs: number[] = []; // x, y (in whole cells), slot, alpha, size
  const share: number[] = [];
  let dark = root.classList.contains("dark");
  let fills: string[] = [];
  let slotPx = 0;
  let rampPx = 0;
  let time = 0;
  let last = 0;
  let raf = 0;
  let dead = false;
  let motes: Mote[] = [];
  let seeds: Seed[] = [];

  // ---- the chicken ---------------------------------------------------------------------------
  const c = {
    /** Window coordinates; y is where the feet stand. */
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    face: 1 as 1 | -1,
    t: 0,
    anim: "stand" as Anim,
    eye: "" as Eye,
    /** Where it is in a hop, 0 to 1. 0: on the ground. */
    hop: 0,
    /** Where it is in a wing beat, in poses. */
    beat: 0,
    /** How much of it has formed (the hatch): 0 to 1. */
    form: 1,
    /** Progress of the cheep: 1 when it starts, 0 when it is over (and 0 when not cheeping). */
    cheep: 0,
    seed: random(),
    /** Held by the pointer: where on its body. */
    hx: 0,
    hy: 0,
  };
  let state: State = "away";
  let st = 0;
  /** Seconds until it turns up, and until it leaves. */
  let away = 0;
  let life = 0;
  let dwell = 0;
  let blink = 3;
  let nextCheep = 6;
  let quiet = 0;
  let target = 0;
  let runSpeed = 0;
  let runThen: State = "idle";
  let eatSeed: Seed | null = null;
  // Flying: where it is going, for how much longer, and whether it is to land at the end or leave the screen.
  let fx = 0;
  let fy = 0;
  let flightLeft = 0;
  let landing = false;
  let leavingFlight = false;
  let boostUntil = 0;
  let recover = false;
  let walkPhase = 0;
  let pecked = false;
  let heldFor = 0;
  let strongFor = 0;
  let violentFor = 0;
  let dizzyHeld = false;
  let gentleHold = true;
  let afterDrop: "normal" | "joy" | "mad" = "normal";
  let thrown = false;
  let bounces = 0;
  let bigFall = false;
  let fxClock = 0;
  let petClock = 0;
  let petLast = 0;
  let playFor = 0;
  let followCooldown = 0;
  let stareCooldown = 0;
  let wakeTaps = 0;
  let lastWakeTap = -99;
  let handledStage: IrritationStage = "calm";
  let handledAffection = "none";
  let gazeCandidate: 0 | 1 | -1 = 0;
  let gazeAt = 0;
  let gazeUntil = 0;
  let cursor = "";
  let flipClock = 0;
  const mood = new Mood();
  const ptr = { x: -1e9, y: -1e9, on: false, fine: false, moved: -1e9 };
  let fs: GestureFrame = { over: false, overHead: false, petting: "none", pressing: false, pinching: false, held: false, shake: 0, speed: 0, stareMs: 0, moveAgeMs: 1e9 };
  let pressActive = false;

  const between = (a: number, b: number) => a + random() * (b - a);
  const ease = (rate: number, dt: number) => 1 - Math.exp(-rate * dt);
  const theme = () => (dark ? "dark" : "light");
  const now = () => performance.now();
  const flip = () => {
    c.face = (c.face * -1) as 1 | -1;
  };

  const bodyW = () => BW * u;
  const bodyH = () => BH * u;
  /** The line the feet stand on: one cell above the bottom edge of the window, where the shadow row sits, so it stands on the very bottom. */
  const floorY = () => h - u;
  /** The nearest place where the sprite sits exactly on the grid. */
  const onGridX = (x: number) => (Math.round(x / u - BW / 2) + BW / 2) * u;
  /** The highest the feet can be, so that the head stays under the header. */
  const minFeet = () => HEADER + bodyH() * 0.95 + 6;
  const margin = () => bodyW() * 0.5;
  const clampX = (x: number) => Math.max(margin(), Math.min(w - margin(), x));
  const visible = () => state !== "away";

  const NOWHERE: Rect = { x: -1e9, y: -1e9, w: 0, h: 0 };
  const hitRect = (): Rect =>
    visible()
      ? { x: c.x - bodyW() * 0.35, y: c.y - bodyH() + bodyH() * TUNING.hit.topShare, w: bodyW() * 0.7, h: bodyH() * (1 - TUNING.hit.topShare) }
      : NOWHERE;
  const headRect = (): Rect =>
    visible()
      ? { x: c.x - bodyW() * 0.275, y: c.y - bodyH() + bodyH() * TUNING.head.topShare, w: bodyW() * 0.55, h: bodyH() * TUNING.head.heightShare }
      : NOWHERE;
  const gestures = new GestureTracker(hitRect, headRect);

  // ---- colour and size -----------------------------------------------------------------------
  function readTheme() {
    dark = root.classList.contains("dark");
    const t = theme();
    fills = Array.from({ length: LEVELS }, (_, l) => {
      const k = Math.min(3, Math.floor(l / 4));
      return mixHex(S.ramp[t][k], S.ramp[t][k + 1], l / 4 - k);
    });
    buildAtlas();
  }

  /** Every character once, in the ink colour, at device resolution: drawing one is then a blit. */
  function buildAtlas() {
    family = getComputedStyle(canvas).fontFamily;
    slotPx = Math.round(u * SC * dpr);
    atlas.width = slotPx * GLYPHS.length;
    atlas.height = slotPx;
    const a = atlas.getContext("2d")!;
    a.clearRect(0, 0, atlas.width, atlas.height);
    a.fillStyle = INK[theme()];
    a.font = `700 ${Math.round(u * SC * 1.5 * dpr)}px ${family}`;
    a.textAlign = "center";
    a.textBaseline = "middle";
    for (let i = 0; i < GLYPHS.length; i++) a.fillText(GLYPHS[i], (i + 0.5) * slotPx, slotPx * 0.54);

    rampPx = Math.round(u * dpr);
    ramp.width = rampPx * LEVELS * RAMP.length;
    ramp.height = rampPx;
    const r = ramp.getContext("2d")!;
    r.clearRect(0, 0, ramp.width, ramp.height);
    r.font = `700 ${Math.round(u * 1.5 * dpr)}px ${family}`;
    r.textAlign = "center";
    r.textBaseline = "middle";
    for (let l = 0; l < LEVELS; l++) {
      r.fillStyle = fills[l] ?? INK[theme()];
      for (let g = 0; g < RAMP.length; g++) r.fillText(RAMP[g], (l * RAMP.length + g + 0.5) * rampPx, rampPx * 0.54);
    }
  }

  function measure() {
    const nw = Math.max(1, Math.round(window.innerWidth));
    const nh = Math.max(1, Math.round(window.innerHeight));
    const ndpr = Math.min(window.devicePixelRatio || 1, 2);
    const resized = nw !== w || nh !== h || ndpr !== dpr;
    w = nw;
    h = nh;
    dpr = ndpr;
    // As big as Orry: the body is 18 rows, so 7 pixel cells make it about 126 pixels tall on a desktop and 4 pixel cells about 72 on a phone.
    u = w < 640 ? 4 : 7;
    off = h - Math.floor(h / u) * u;
    if (resized) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      cols = Math.ceil(w / u);
      rows = Math.floor(h / u);
      const n = cols * rows;
      trail = new Float32Array(n);
      liveMark = new Uint32Array(n);
      cover = new Float32Array(n);
      light = new Float32Array(n);
      shadeSum = new Float32Array(n);
      clear = new Float32Array(n);
      jitter = new Int8Array(n);
      glow = new Float32Array(n);
      glowMark = new Uint32Array(n);
      buildAtlas();
    }
    if (visible()) {
      c.x = onGridX(clampX(c.x));
      if (state !== "held" && state !== "fall") c.y = floorY();
    }
    if (reduced) still();
  }

  // ---- effects -------------------------------------------------------------------------------
  function mote(x: number, y: number, ch: string, color: string, vx: number, vy: number, life: number, size = SC, heart = false) {
    if (motes.length >= MAX_MOTES) motes.shift();
    motes.push({ x, y, ch: heart ? "" : ch[Math.floor(random() * ch.length)], color, vx, vy, life, max: life, size, heart });
  }
  const headY = () => c.y - bodyH() * 1.02;
  const ink = () => INK[theme()];
  /** `n` pixel hearts rising from the head; `big` for the bliss ones. */
  function hearts(n: number, big = false) {
    for (let k = 0; k < n; k++) mote(c.x + between(-5, 5) * U, headY() + U * 3, "", COLORS.heart, between(-2, 2) * U, -between(5, 8) * U, 1.4, big ? 2.6 : 1.6, true);
  }
  const anger = () => mote(c.x - c.face * 4 * U, headY() + U * 2, "#", COLORS.anger, 0, -U * 2, 1.0, SC);
  const bang = (n = 1) => {
    for (let k = 0; k < n; k++) mote(c.x + (k - (n - 1) / 2) * U * 3, headY(), "!", ink(), between(-1, 1) * U, -U * 5, 1.0, SC);
  };
  const ask = () => mote(c.x + c.face * 3 * U, headY(), "?", ink(), 0, -U * 4, 1.2, SC);
  const zee = () => mote(c.x + c.face * 6 * U, headY() + U * 4, "z", COLORS.z, c.face * U * 2, -U * 4, 2.0, SC * 0.8);
  const star = () => mote(c.x + between(-8, 8) * U, headY() + U * 3, "*", COLORS.star, between(-3, 3) * U, -U * 2, 1.0, SC * 0.8);
  const sweat = () => mote(c.x - c.face * 7 * U, headY() + U * 6, "'", COLORS.sweat, -c.face * U * 3, U * 3, 0.8, SC * 0.8);
  const dust = (n: number, from = c.x) => {
    for (let k = 0; k < n; k++) mote(from + between(-6, 6) * U, c.y - U, ",'.", ink(), between(-8, 8) * U, -between(2, 8) * U, 0.5, 1.4);
  };

  // ---- the state machine ---------------------------------------------------------------------
  function emit() {
    const detail: ChickenStatus = { enabled, visible: visible(), reduced, state, x: c.x, y: c.y, w: bodyW(), h: bodyH() };
    window.dispatchEvent(new CustomEvent(STATE_EVENT, { detail }));
  }

  function enter(next: State) {
    state = next;
    st = 0;
    c.eye = "";
    c.cheep = 0;
    pecked = false;
    if (next === "idle") {
      c.anim = "stand";
      dwell = between(1.5, 4.5);
    }
    emit();
  }

  const free = () => FREE.includes(state);
  const stageIndex = (s: IrritationStage) => STAGES.indexOf(s);

  /** Run along the floor to `x` and then do `then`. */
  function run(x: number, speed: number, then: State) {
    target = x;
    runSpeed = speed;
    runThen = then;
    enter("run");
  }

  /** The way off the screen that is nearest. */
  const edgeFor = (x: number) => (x < w / 2 ? -bodyW() * 0.7 : w + bodyW() * 0.7);

  function arrive() {
    life = between(40, 90);
    c.y = floorY();
    c.vx = c.vy = 0;
    const roll = random();
    if (forced || roll < 0.3) {
      // It hatches from an egg on the floor.
      c.x = onGridX(clampX(between(w * 0.2, w * 0.8)));
      c.face = random() < 0.5 ? 1 : -1;
      c.form = 0;
      enter("hatch");
    } else if (roll < 0.6) {
      // Or it walks in from the left or right edge.
      const left = random() < 0.5;
      c.x = left ? -bodyW() * 0.7 : w + bodyW() * 0.7;
      c.face = left ? 1 : -1;
      c.form = 1;
      run(onGridX(clampX(between(w * 0.25, w * 0.75))), WALK * 1.3, "idle");
    } else {
      // Or it flies in.
      const left = random() < 0.5;
      c.x = left ? -bodyW() * 0.7 : w + bodyW() * 0.7;
      c.y = between(minFeet(), floorY() * 0.6);
      c.face = left ? 1 : -1;
      c.form = 1;
      c.vx = (left ? 1 : -1) * FLY;
      flightLeft = between(3, 7);
      landing = false;
      leavingFlight = false;
      pickFlight();
      enter("fly");
    }
  }

  /** Somewhere in the air to fly to, not too near where it is. */
  function pickFlight() {
    const lo = minFeet();
    const hi = Math.max(lo + 10, floorY() - bodyH() * 0.15);
    fx = clampX(between(0, w));
    fy = between(lo, hi);
    if (Math.hypot(fx - c.x, fy - c.y) < bodyW() * 0.8) fx = clampX(c.x + (c.x < w / 2 ? 1 : -1) * between(0.8, 1.6) * bodyW());
  }

  /** It goes the way it likes: off the side of the screen on foot, or up and away. */
  function leave() {
    if (state === "fly" || random() < 0.5) {
      leavingFlight = true;
      landing = false;
      const dir = c.x < w / 2 ? -1 : 1;
      fx = dir < 0 ? -bodyW() : w + bodyW();
      fy = Math.max(minFeet(), c.y - bodyH() * 0.6);
      if (state !== "fly") c.vy = -U * 45;
      enter("fly");
    } else run(edgeFor(c.x), DASH * 0.8, "away");
  }

  function goAway(seconds: number) {
    away = seconds;
    c.x = -1e5;
    c.vx = 0;
    enter("away");
  }

  /** The way it looks at the pointer, with no flicking about: a new side must hold for a moment, and it is kept for a while. */
  function updateGaze() {
    if (!ptr.on || !ptr.fine) return;
    const dx = ptr.x - c.x;
    const dy = ptr.y - (c.y - bodyH() / 2);
    if (Math.abs(dx) > TUNING.gaze.rangeX || Math.abs(dy) > TUNING.gaze.rangeY || Math.abs(dx) < U * 4) return;
    const side = dx > 0 ? 1 : -1;
    if (ptr.moved > time - 0.1) gazeUntil = time + TUNING.gaze.holdAfterMoveMs / 1000;
    if (side === c.face) {
      gazeCandidate = 0;
      return;
    }
    if (gazeCandidate !== side) {
      gazeCandidate = side;
      gazeAt = time;
    } else if (time - gazeAt >= TUNING.gaze.switchMs / 1000 && time < gazeUntil) {
      c.face = side;
      gazeCandidate = 0;
    }
  }

  function handle(ev: GestureEvent) {
    const sleeping = state === "sleep" || state === "sleepy";
    switch (ev.type) {
      case "tap":
        if (state === "fly") {
          // Poked in the air: it cheeps, and a burst of wings.
          mood.poke();
          c.cheep = 1;
          boostUntil = time + 0.8;
          bang();
          return;
        }
        if (sleeping) return wakeUp();
        if (free() && !fs.pinching) {
          mood.poke();
          c.face = ptr.x > c.x ? 1 : -1;
          enter("poke");
        }
        return;
      case "tickle":
        if (state === "fly") {
          mood.tickle();
          hearts(2);
          boostUntil = time + 1;
          return;
        }
        if (free() || state === "poke") {
          mood.tickle();
          enter("tickle");
        }
        return;
      case "spam":
        mood.spam();
        return;
      case "pickup":
        if (state !== "away" && state !== "hatch") pickUp(ev.x, ev.y);
        return;
      case "drop":
        if (state === "held") drop(ev.vx, ev.vy);
        return;
      case "pinch-end":
        if (state === "pinch") {
          const stage = mood.irritationStage;
          enter(stage === "furious" ? "stomp" : stage === "angry" ? "swat" : "rub");
        }
        return;
      case "charge":
        if (state === "fly" && !leavingFlight && followCooldown <= 0) {
          // Charged in the air: it bolts to the far side.
          followCooldown = TUNING.charge.cooldownMs / 1000;
          fx = clampX(ptr.x < c.x ? w - margin() : margin());
          fy = between(minFeet(), floorY() * 0.7);
          landing = false;
          boostUntil = time + 1.4;
          bang();
          return;
        }
        if (free() && followCooldown <= 0) {
          followCooldown = TUNING.charge.cooldownMs / 1000;
          enter("flee");
        }
    }
  }

  function wakeUp() {
    wakeTaps = time - lastWakeTap < TUNING.sleep.wakeWindowMs / 1000 ? wakeTaps + 1 : 1;
    lastWakeTap = time;
    mood.woken();
    enter("wake");
  }

  function pickUp(x: number, y: number) {
    c.hx = x - c.x;
    c.hy = y - c.y;
    heldFor = 0;
    strongFor = 0;
    violentFor = 0;
    dizzyHeld = false;
    gentleHold = true;
    eatSeed = null;
    c.vx = c.vy = 0;
    enter("held");
    bang();
  }

  function drop(vx: number, vy: number) {
    const speed = Math.hypot(vx, vy);
    thrown = speed > TUNING.throwSpeed;
    const cap = 2200;
    const k = speed > cap ? cap / speed : 1;
    c.vx = thrown ? vx * k : vx * 0.2;
    c.vy = thrown ? vy * k : Math.max(0, vy * 0.2);
    bounces = 0;
    bigFall = dizzyHeld || floorY() - c.y > bodyH() * 2.2;
    const stage = mood.irritationStage;
    if (dizzyHeld) mood.droppedAfterShake();
    afterDrop = dizzyHeld || stage === "angry" || stage === "furious" ? "mad" : heldFor >= TUNING.held.amused && gentleHold && !mood.grudge && !thrown ? "joy" : "normal";
    recover = !thrown && !bigFall && afterDrop === "normal" && random() < 0.5;
    enter("fall");
  }

  function react(stage: IrritationStage) {
    if (stage === "wary") enter("wary");
    else if (stage === "annoyed") enter("annoyed");
    else if (stage === "angry") enter("mad");
    else if (stage === "furious") enter("stomp");
  }

  /** On the ground and not in a sequence: pick the next thing to do. */
  function think() {
    const landed = seeds.filter((s) => s.y >= s.land - 1);
    if (landed.length && random() < 0.7) {
      eatSeed = landed.sort((a, b) => Math.abs(a.x - c.x) - Math.abs(b.x - c.x))[0];
      return enter("eat");
    }
    if (life <= 0) return leave();
    const roll = random();
    if (quiet > TUNING.sleep.quietMs / 1000 / ts && roll < TUNING.sleep.chance) return enter("sleepy");
    if (roll < 0.4) {
      // A walk, short or long, and now and then a dash with the wings out.
      const far = random() < 0.35;
      const reach = far ? between(0.35, 0.7) * w : between(0.8, 2) * bodyW();
      return run(onGridX(clampX(c.x + (random() < 0.5 ? -1 : 1) * reach)), far && random() < 0.5 ? DASH * 0.7 : WALK, "idle");
    }
    if (roll < 0.58) return enter("sniff");
    if (roll < 0.82 && !reduced) return enter("takeoff");
    flip();
    dwell = between(1.5, 3);
  }

  /** What each state does with the time that passed. */
  function update(dt: number) {
    const G = U * 160;
    st += dt;
    c.t += dt;
    if (c.form < 1 && state !== "hatch") c.form = Math.min(1, c.form + dt / FORM);
    if (c.cheep > 0) c.cheep = Math.max(0, c.cheep - dt / 0.5);
    flipClock += dt;
    const floor = floorY();
    const edge = (x: number) => Math.max(bodyW() * 0.2, Math.min(w - bodyW() * 0.2, x));

    switch (state) {
      case "away": {
        if (reduced || !enabled) break;
        away -= dt * ts;
        if (away <= 0) arrive();
        break;
      }
      case "hatch": {
        c.anim = "hatch";
        c.form = Math.min(1, st / FORM);
        if (st >= INTRO) {
          for (let k = 0; k < 8; k++) mote(c.x + between(-6, 6) * U, c.y - between(3, 16) * U, SHELL, ink(), between(-6, 6) * U, between(-6, 1) * U, 0.9, 1.4);
          enter("idle");
        }
        break;
      }
      case "idle": {
        c.anim = "stand";
        life -= dt * ts;
        dwell -= dt;
        blink -= dt;
        nextCheep -= dt;
        if (blink <= 0) {
          c.eye = c.eye === "-" ? "" : "-";
          blink = c.eye === "-" ? 0.14 : between(2.5, 5);
        }
        if (nextCheep <= 0 && c.eye === "") {
          c.cheep = 1;
          nextCheep = between(6, 11);
        }
        if (dwell <= 0 && !fs.over) think();
        break;
      }
      case "run": {
        const dx = target - c.x;
        const dir = Math.sign(dx);
        const leaving = runThen === "away" || runThen === "storm";
        if (dir) c.face = dir as 1 | -1;
        // Up to a brisk walk it is a walk; faster than that it runs with its wings out.
        c.anim = runSpeed > 300 ? "dash" : "run";
        c.vx += (dir * runSpeed - c.vx) * ease(6, dt);
        c.x += c.vx * dt;
        if (!leaving) c.x = edge(c.x);
        life -= dt * ts;
        if (Math.abs(dx) < U * 1 || (leaving && (c.x < -bodyW() * 0.6 || c.x > w + bodyW() * 0.6))) {
          c.vx = 0;
          if (runThen === "away") goAway(between(8, 20));
          else if (runThen === "storm") {
            mood.stormedOff();
            goAway(60);
          } else enter(runThen);
        } else if (runThen === "idle" && fs.over && fs.speed > 0) {
          // It stays put while a pointer is moving on it.
          c.vx = 0;
          enter("idle");
        }
        break;
      }
      case "takeoff": {
        // A crouch, then up.
        c.anim = "squash";
        c.vx = 0;
        if (st > 0.28) {
          flightLeft = between(5, 12);
          landing = false;
          leavingFlight = false;
          pickFlight();
          dust(3);
          enter("fly");
          c.vy = -U * 55;
        }
        break;
      }
      case "fly": {
        c.anim = "flap";
        c.beat += dt * S.fps * 0.7;
        life -= dt * ts;
        flightLeft -= dt;
        // It cruises to a place, glides on to another, and in the end comes down.
        if (!leavingFlight && !landing && flightLeft <= 0) {
          landing = true;
          fx = clampX(c.x + between(-0.25, 0.25) * w);
          fy = floor;
        }
        const dx = fx - c.x;
        const dy = fy - c.y;
        const d = Math.hypot(dx, dy) || 1;
        const boost = time < boostUntil ? 1.7 : 1;
        const speed = FLY * boost * Math.min(1, d / 170 + 0.15);
        const bob = landing ? 0 : Math.sin(c.t * 4.5) * 55;
        const k = ease(3, dt);
        c.vx += ((dx / d) * speed - c.vx) * k;
        c.vy += ((dy / d) * speed + bob - c.vy) * k;
        c.x += c.vx * dt;
        c.y = Math.max(minFeet(), Math.min(floor, c.y + c.vy * dt));
        if (!leavingFlight) c.x = Math.max(bodyW() * 0.2, Math.min(w - bodyW() * 0.2, c.x));
        if (c.vx > 60) c.face = 1;
        else if (c.vx < -60) c.face = -1;
        if (leavingFlight) {
          if (c.x < -bodyW() * 0.6 || c.x > w + bodyW() * 0.6) goAway(between(8, 20));
        } else if (landing) {
          if (c.y >= floor - 3 && d < 60) {
            c.y = floor;
            c.vx *= 0.3;
            c.vy = 0;
            thrown = false;
            bigFall = false;
            afterDrop = "normal";
            dust(4);
            enter("land");
          }
        } else if (d < 50) pickFlight();
        break;
      }
      case "sniff": {
        c.anim = "peck";
        if (st > 2 || fs.over) enter("idle");
        break;
      }
      case "sleepy": {
        c.anim = "stand";
        c.eye = "-";
        if (st > 2) {
          enter("sleep");
          c.eye = "-";
        }
        break;
      }
      case "sleep": {
        c.anim = "stand";
        c.eye = "-";
        fxClock += dt;
        if (fxClock > 1.3) {
          fxClock = 0;
          zee();
        }
        // Only a tap reaches it asleep, or the pointer coming close, or in the end it wakes by itself.
        const near = ptr.on && ptr.fine && Math.hypot(ptr.x - c.x, ptr.y - c.y) < 220 && fs.moveAgeMs < 300;
        if (st > TUNING.sleep.naturalWake / ts || near) wakeUp();
        break;
      }
      case "wake": {
        c.anim = "stand";
        if (st < dt * 1.5) {
          bang();
          c.vy = -U * 36;
          c.cheep = 1;
        }
        if (st > TUNING.beat.wake) enter("idle");
        break;
      }
      case "eat": {
        if (!eatSeed || !seeds.includes(eatSeed)) return enter("idle");
        const dx = eatSeed.x - c.x;
        if (Math.abs(dx) > U * 3) {
          c.face = Math.sign(dx) as 1 | -1;
          c.anim = "run";
          c.vx += (Math.sign(dx) * WALK * 1.8 - c.vx) * ease(6, dt);
          c.x = edge(c.x + c.vx * dt);
        } else {
          c.vx = 0;
          c.anim = "peck";
          if (!pecked) {
            pecked = true;
            st = 0;
          } else if (st > 0.7) {
            mote(eatSeed.x, eatSeed.y - U, ",", ink(), between(-2, 2) * U, -U * 3, 0.6, 1.2);
            seeds = seeds.filter((s) => s !== eatSeed);
            eatSeed = null;
            if (random() < 0.4) hearts(1);
            enter("idle");
          }
        }
        break;
      }
      case "follow": {
        // Play: it comes after the pointer, along the bottom or through the air, and when the pointer stops it stops and looks, excited.
        mood.play(dt * ts);
        const gx = clampX(ptr.x);
        const want = Math.min(floor, Math.max(minFeet(), ptr.y + bodyH() * 0.45));
        const dx = gx - c.x;
        const dy = want - c.y;
        const aloft = c.y < floor - 4 || want < floor - 20;
        const stopped = fs.speed < 60 || !ptr.on || (Math.abs(dx) < U * 4 && Math.abs(dy) < U * 6);
        const k = ease(4, dt);
        if (stopped) {
          // It hovers, or stands, and looks pleased.
          c.eye = "^";
          c.vx += (0 - c.vx) * ease(6, dt);
          if (aloft) {
            c.anim = "flap";
            c.beat += dt * S.fps * 0.5;
            c.vy += (dy * 2 + Math.sin(c.t * 4) * 40 - c.vy) * k;
          } else {
            c.anim = "stand";
            c.vy = 0;
          }
          if (st < dt * 1.5) c.cheep = 1;
          if (st > 1.4) {
            if (c.y < floor - 4) {
              flightLeft = 0;
              landing = true;
              leavingFlight = false;
              fx = c.x;
              fy = floor;
              enter("fly");
            } else enter("idle");
          }
        } else {
          st = 0;
          c.face = (Math.sign(dx) || c.face) as 1 | -1;
          const dist = Math.hypot(dx, dy) || 1;
          const speed = Math.min(aloft ? FLY * 1.1 : DASH * 0.7, dist * 3);
          if (aloft) {
            c.anim = "flap";
            c.beat += dt * S.fps * 0.7;
            c.vx += ((dx / dist) * speed - c.vx) * k;
            c.vy += ((dy / dist) * speed - c.vy) * k;
          } else {
            c.anim = "dash";
            c.vx += ((dx / dist) * speed - c.vx) * ease(6, dt);
            c.vy = 0;
          }
        }
        c.x = Math.max(bodyW() * 0.2, Math.min(w - bodyW() * 0.2, c.x + c.vx * dt));
        c.y = Math.max(minFeet(), Math.min(floor, c.y + c.vy * dt));
        break;
      }
      case "poke": {
        // Surprised for a moment, then smug for the same.
        if (st < TUNING.beat.poke) {
          c.anim = "stand";
          if (st < dt * 1.5) {
            c.cheep = 1;
            c.vy = -U * 40;
            bang();
          }
        } else {
          c.anim = "stand";
          c.eye = "-";
          if (st - dt < TUNING.beat.poke) hearts(1);
        }
        if (st > TUNING.beat.poke * 2) enter("idle");
        break;
      }
      case "tickle": {
        c.anim = "wiggle";
        c.eye = "^";
        if (flipClock > 0.15 && st < 1.5) {
          flipClock = 0;
          flip();
          if (random() < 0.4) bang();
        }
        if (st > 1.5) {
          c.anim = "stand";
          if (st - dt < 1.5) {
            c.cheep = 1;
            hearts(2);
          }
        }
        if (st > 2.1) enter("idle");
        break;
      }
      case "pet": {
        c.anim = "wiggle";
        c.eye = "^";
        const stage = mood.affectionStage;
        const bliss = stage === "bliss" || stage === "overjoyed";
        petClock += dt;
        if (petClock > (stage === "none" ? 1.1 : stage === "happy" ? 0.8 : 0.5)) {
          petClock = 0;
          hearts(bliss ? 2 : 1, bliss);
        }
        if (fs.petting === "none" && time - petLast > 0.6) enter("idle");
        break;
      }
      case "pinch": {
        c.anim = st < TUNING.beat.pinch[0] ? "squash" : Math.floor(st * 2.5) % 2 ? "squash" : "stretch";
        c.eye = "-";
        if (st < dt * 1.5) mote(c.x - c.face * 5 * U, headY() + U * 4, "o", ink(), 0, -U * 2, 0.8, SC);
        if (!fs.pinching && !pressActive) enter("rub");
        break;
      }
      case "rub": {
        c.anim = "stand";
        c.eye = "-";
        if (st < dt * 1.5) c.cheep = 1;
        if (st > 1) enter("idle");
        break;
      }
      case "swat": {
        c.anim = "flap";
        c.eye = "-";
        if (st < dt * 1.5) {
          bang();
          anger();
        }
        if (st > 0.8) enter("sulk");
        break;
      }
      case "wary": {
        // A glance at the pointer, then a shake of the head.
        c.anim = "stand";
        if (st < 0.4) c.face = ptr.x > c.x ? 1 : -1;
        else if (flipClock > 0.18) {
          flipClock = 0;
          flip();
        }
        if (st < dt * 1.5) sweat();
        if (st > 1.1) enter("idle");
        break;
      }
      case "annoyed": {
        c.anim = "stand";
        c.eye = "-";
        if (st < dt * 1.5) anger();
        if (st > 1) {
          const off = ptr.x < c.x ? 1 : -1;
          run(onGridX(clampX(c.x + off * between(1.2, 2.4) * bodyW())), WALK * 1.2, "idle");
        }
        break;
      }
      case "mad": {
        // It puffs, then the facepalm, then furious: 0.7 s each.
        c.anim = "flap";
        c.eye = st > TUNING.beat.madBeat ? "-" : "";
        if (Math.floor(st / 0.35) !== Math.floor((st - dt) / 0.35)) {
          anger();
          if (st < 1) bang();
        }
        if (st > TUNING.beat.mad) enter("sulk");
        break;
      }
      case "sulk": {
        c.anim = "stand";
        c.eye = "-";
        if (st < dt * 1.5) c.face = ptr.x > c.x ? -1 : 1;
        if (st > 4) enter("idle");
        break;
      }
      case "stomp": {
        c.anim = "stomp";
        c.eye = "-";
        if (Math.floor(st / 0.4) !== Math.floor((st - dt) / 0.4)) {
          dust(2);
          anger();
        }
        if (st > TUNING.beat.stomp) {
          mood.stomped();
          enter("turn");
        }
        break;
      }
      case "turn": {
        c.anim = "stand";
        c.eye = "-";
        if (st < dt * 1.5) c.face = ptr.x > c.x ? -1 : 1;
        if (st > TUNING.beat.turn) run(edgeFor(c.x), DASH * 0.75, "storm");
        break;
      }
      case "flee": {
        // A flinch that lasts, then a scurry away.
        if (st < TUNING.flee.flinch) {
          c.anim = "squash";
          if (st < dt * 1.5) bang();
        } else {
          const off = ptr.x < c.x ? 1 : -1;
          c.face = off;
          c.anim = "dash";
          c.vx += (off * TUNING.run.flee * 0.6 - c.vx) * ease(10, dt);
          c.x = edge(c.x + c.vx * dt);
        }
        if (st > TUNING.flee.total) {
          c.vx = 0;
          enter("idle");
        }
        break;
      }
      case "joy": {
        // Crouch, launch, a kick each way, a soft landing, a cheer.
        const [crouch, launch, , , , landed, cheer] = TUNING.beat.joy;
        c.eye = "^";
        if (st < crouch) c.anim = "squash";
        else if (st < launch) {
          c.anim = "stretch";
          if (st - dt < crouch) c.vy = -U * 56;
        } else if (c.y < floor - U) c.anim = "flap";
        else c.anim = st < landed ? "squash" : "stand";
        if (st > landed && st - dt < landed) {
          c.cheep = 1;
          hearts(3, true);
        }
        if (c.y < floor || c.vy < 0) {
          c.vy += G * dt;
          c.y = Math.min(floor, c.y + c.vy * dt);
          if (c.y >= floor) c.vy = 0;
        }
        if (st > cheer) enter("idle");
        break;
      }
      case "held": {
        heldFor += dt;
        const k = ease(28, dt);
        const nx = c.x + (ptr.x - c.hx - c.x) * k;
        const ny = Math.min(floor, c.y + (ptr.y - c.hy - c.y) * k);
        const j = ease(14, dt);
        c.vx += ((nx - c.x) / Math.max(dt, 1e-3) - c.vx) * j;
        c.vy += ((ny - c.y) / Math.max(dt, 1e-3) - c.vy) * j;
        c.x = nx;
        c.y = ny;
        const H = TUNING.held;
        const fedUp = mood.grudge || mood.irritationStage !== "calm";
        const amused = mood.grudge ? 0 : fedUp ? H.amusedWary : H.amused;
        const tAmused = H.yelpFor + amused;
        const tConfused = tAmused + (fedUp ? H.confusedShort : H.confused);
        const tStruggle = tConfused + H.struggle;
        const tAngry = tStruggle + H.angry;
        const tTired = tAngry + H.tired;
        const hf = heldFor * Math.min(ts, 3);
        c.anim = "flap";
        c.eye = "";
        fxClock += dt;
        const every = (gap: number, fx: () => void) => {
          if (fxClock > gap) {
            fxClock = 0;
            fx();
          }
        };
        if (hf < H.yelpFor) c.anim = "flap";
        else if (hf < tAmused) {
          c.eye = "^";
          every(0.6, star);
        } else if (hf < tConfused) every(0.8, ask);
        else if (hf < tStruggle) {
          mood.struggling(dt * ts);
          c.beat += dt * S.fps * 0.8;
          every(0.5, sweat);
        } else if (hf < tAngry) {
          mood.angryHeld(dt * ts);
          c.beat += dt * S.fps * 0.5;
          c.eye = "-";
          every(0.6, anger);
        } else if (hf < tTired) {
          c.eye = "-";
          every(0.8, sweat);
        } else {
          c.anim = "stretch";
          c.eye = "-";
        }
        // Shaken from side to side.
        if (fs.shake >= 2) mood.shaken(fs.shake === 3 ? 3 : 2, dt * ts);
        strongFor = fs.shake >= 2 ? strongFor + dt : Math.max(0, strongFor - dt);
        violentFor = fs.shake === 3 ? violentFor + dt : Math.max(0, violentFor - dt);
        if (violentFor >= 3 / Math.min(ts, 2)) dizzyHeld = true;
        if (fs.shake > 1) gentleHold = false;
        if (strongFor >= H.queasyAfter) {
          c.eye = "x";
          every(0.4, sweat);
        }
        if (c.vx > U * 2) c.face = 1;
        else if (c.vx < -U * 2) c.face = -1;
        break;
      }
      case "fall": {
        c.anim = "flap";
        if (recover && c.vy > 240) {
          // Not hurt: it catches itself with its wings and flies off.
          recover = false;
          flightLeft = between(3, 7);
          landing = false;
          leavingFlight = false;
          pickFlight();
          c.vy *= 0.15;
          enter("fly");
          break;
        }
        c.vy += G * dt;
        c.x += c.vx * dt;
        c.y += c.vy * dt;
        const m = bodyW() * 0.3;
        if (c.x < m) {
          c.x = m;
          c.vx = Math.abs(c.vx) * 0.5;
        } else if (c.x > w - m) {
          c.x = w - m;
          c.vx = -Math.abs(c.vx) * 0.5;
        }
        if (c.y >= floor) {
          c.y = floor;
          const hitSpeed = Math.abs(c.vy);
          if (thrown && hitSpeed > TUNING.bounce.minSpeed && bounces < TUNING.bounce.max) {
            bounces++;
            c.vy = -hitSpeed * TUNING.bounce.keep;
            c.vx *= 0.8;
            dust(2);
          } else {
            c.vy = 0;
            c.vx *= 0.3;
            dust(5);
            enter("land");
          }
        }
        break;
      }
      case "land": {
        c.anim = "squash";
        c.vx *= Math.exp(-6 * dt);
        c.x = edge(c.x + c.vx * dt);
        if (st > (bigFall ? TUNING.beat.landBig[2] : TUNING.beat.landShort)) {
          c.vx = 0;
          if (bigFall) enter("dizzy");
          else if (afterDrop === "mad") enter("mad");
          else if (afterDrop === "joy") {
            mood.joy();
            enter("joy");
          } else enter("idle");
        }
        break;
      }
      case "dizzy": {
        // It sways with stars, shakes its head, rubs the bump, looks confused, wobbles and gets up.
        const [, shakes, rubs, up] = TUNING.beat.dazed;
        c.eye = st < rubs ? "x" : "-";
        c.anim = "stand";
        if (st < shakes && flipClock > 0.45) {
          flipClock = 0;
          flip();
        }
        if (st < up) {
          fxClock += dt;
          if (fxClock > 0.35) {
            fxClock = 0;
            star();
          }
        }
        if (st > rubs && st < rubs + dt * 1.5) c.cheep = 1;
        if (st > up + 1) enter("idle");
        break;
      }
      case "stare": {
        // Suspicious, then bored, then it looks away.
        c.anim = "stand";
        c.eye = st < 1.5 ? "" : "-";
        if (st < dt * 1.5) ask();
        if (st > 1.5 && st < 1.5 + dt * 1.5) flip();
        if (st > 2.8) enter("idle");
        break;
      }
      default:
        break;
    }

    // Gravity for everything in the air that is not in a sequence that handles it.
    if (state !== "held" && state !== "fall" && state !== "joy" && state !== "away" && state !== "fly" && state !== "takeoff" && state !== "follow") {
      if (c.y < floor - 0.5 || c.vy < 0) {
        c.vy += G * dt;
        c.y = Math.min(floor, c.y + c.vy * dt);
        if (c.y >= floor) c.vy = 0;
      } else {
        c.y = floor;
        c.vy = 0;
      }
    }

    // The beat: a hopping chicken takes a whole hop at a time and always lands before it stands.
    c.beat += dt * S.fps;
    // The legs go round once for every STRIDE pixels it covers, so the feet never slide.
    if (c.anim === "run") walkPhase += (Math.abs(c.vx) * dt) / STRIDE;
    if (c.hop > 0) {
      c.hop += (dt * S.fps) / Q.hop.length;
      if (c.hop >= 1) c.hop = 0;
    }
    if (c.anim === "dash" && Math.abs(c.vx) > DASH * 0.4 && random() < dt * 8) dust(1, c.x - Math.sign(c.vx) * bodyW() * 0.25);
  }

  /** Reads the pointer, feeds the mood meters, and starts the reactions the gestures and the stages call for. */
  function sense(dt: number) {
    fs = gestures.frame(now());
    const dtm = dt * ts;
    mood.update(dtm);
    followCooldown = Math.max(0, followCooldown - dt);
    stareCooldown = Math.max(0, stareCooldown - dt);
    if (state === "away") return;
    quiet = fs.moveAgeMs > 2500 ? quiet + dt : 0;

    // Petting makes it happy, until it is too much; fast or jittery movement only annoys it.
    if (fs.petting === "gentle" && fs.overHead && (free() || state === "pet")) {
      petLast = time;
      mood.pet(dtm);
      if (mood.enough) mood.tiredOfPetting(dtm);
      if (state === "sleep" || state === "sleepy") wakeUp();
      else if (free() && state !== "pet" && state !== "eat") {
        petClock = 0;
        enter("pet");
      }
    } else if (fs.petting === "rough" && fs.over) mood.scribble(dtm);
    // A press held still on it is a pinch.
    if (fs.pinching && !fs.held && (state === "pinch" || free() || state === "poke")) {
      if (state !== "pinch") {
        enter("pinch");
        mood.pinchStart();
      }
      mood.pinch(dtm);
    }

    // Stage changes: a reaction waits until it is free, and is dropped if it has already calmed down.
    const stage = mood.irritationStage;
    if (stageIndex(stage) < stageIndex(handledStage)) handledStage = stage;
    else if (stageIndex(stage) > stageIndex(handledStage) && free() && state !== "pet") {
      handledStage = stage;
      react(stage);
    }
    const aff = mood.affectionStage;
    if (aff !== handledAffection && free()) {
      handledAffection = aff;
      if (aff === "happy") hearts(2);
      else if (aff === "bliss") hearts(3, true);
      else if (aff === "overjoyed" && state !== "pet") enter("joy");
    }

    // The pointer near it: it looks at it, gets suspicious of a stare, and follows it along the bottom when it is happy.
    if (free() && state !== "sleep" && state !== "sleepy") updateGaze();
    if (free() && stareCooldown <= 0 && fs.stareMs >= TUNING.stare.ms) {
      stareCooldown = TUNING.stare.cooldownMs / 1000;
      gestures.resetStare();
      enter("stare");
    }
    // Played with: a pointer that moves steadily and is not at it, and it is in the mood.
    const playing = ptr.on && ptr.fine && !fs.over && fs.speed > 200 && fs.speed < 900;
    playFor = playing ? playFor + dt : 0;
    const canPlay = state === "idle" || state === "run" || state === "sniff" || (state === "fly" && !leavingFlight);
    if (canPlay && playFor > 0.6 && mood.affectionStage !== "none") {
      playFor = 0;
      enter("follow");
    }
  }

  // ---- drawing -------------------------------------------------------------------------------
  function frameOf(): number {
    switch (c.anim) {
      case "run":
        return Q.walk[Math.floor(walkPhase * 4) % Q.walk.length];
      case "dash":
        return Q.flap[Math.floor(c.beat) % Q.flap.length];
      case "peck":
        return Math.floor(c.t * 9) % 2 ? Q.rest[0] : Q.move[0];
      case "squash":
        return 1;
      case "stretch":
        return 2;
      case "flap":
        return Q.flap[Math.floor(c.beat) % Q.flap.length];
      case "wiggle":
        return Math.floor(c.t * 3) % 2 ? 1 : 0;
      case "stomp":
        return Math.floor(c.t * 6) % 2 ? 1 : 0;
      case "hatch":
        return at(Q.intro, (st / INTRO) * Q.intro.length);
      default:
        if (c.cheep > 0) return at(Q.peep, (1 - c.cheep) * Q.peep.length);
        return Q.rest[0];
    }
  }

  /** One sprite cell at a place on the grid (whole cells, except for the rocking egg). */
  function splat(x: number, y: number, shade: number, a: number, weight: number, j = 0) {
    coverage(x, y, share);
    const col = share[0];
    const row = share[1];
    for (let n = 0; n < 4; n++) {
      const part = share[2 + n] * weight;
      const cx = col + (n & 1);
      const cy = row + (n >> 1);
      if (part < 0.004 || cx < 0 || cy < 0 || cx >= cols || cy >= rows) continue;
      const i = cy * cols + cx;
      if (liveMark[i] !== mark) {
        liveMark[i] = mark;
        cover[i] = light[i] = shadeSum[i] = clear[i] = 0;
        jitter[i] = 0;
        touched.push(i);
      }
      if (shade) {
        cover[i] += part;
        light[i] += part * a;
        shadeSum[i] += part * shade;
        jitter[i] = j;
      } else clear[i] += part;
    }
  }

  function stamp() {
    mark++;
    touched.length = 0;
    glowing.length = 0;
    liveGlyphs.length = 0;
    if (!visible() || c.x < -bodyW() || c.x > w + bodyW()) return;
    const frame = frameOf();
    const f = SPRITES[frame];
    const seed = c.seed * 97;
    // A cell appears when the forming chicken reaches it, over a moment, not at once.
    const formed = (lx: number, ly: number) => (c.form >= 1 ? 1 : smooth((c.form * 1.2 - hash(lx, ly, seed)) / 0.2));
    const X = onGridX(c.x) / u;
    const feet = Math.round((c.y - off) / u);
    const lift = Math.sin(Math.PI * smooth((c.hop - 0.12) / 0.72)) * 1.7 * SC;
    // A waddle: the body is a cell higher on each standing pose of the walk. A dash is a little above the ground.
    const stepUp = c.anim === "run" && Math.abs(c.vx) > 5 && Q.walk[Math.floor(walkPhase * 4) % Q.walk.length] === Q.rest[0] ? 1 : 0;
    const Y = feet - Math.round(lift) - stepUp - (c.anim === "dash" ? 2 : 0);
    // A soft shadow on the floor, smaller and fainter the higher it is.
    const floorRow = Math.round((floorY() - off) / u);
    const up = Math.min(1, (floorRow - Y) / (4 * SC));
    const half = Math.round(BW * 0.3 * (1 - up * 0.4));
    for (let k = -half; k <= half; k++) splat(X + k - 0.5, floorRow, 1, 0.7 * (1 - up * 0.6), 1);
    // The egg rocks on its base before it cracks. It is the one thing that is not on whole cells.
    const rock = state === "hatch" && st < INTRO * 0.6 ? Math.sin(st * 9) * 0.05 * smooth(st * 3) : 0;
    const cos = Math.cos(rock);
    const sin = Math.sin(rock);
    const dir = c.face;
    const cx = BW / 2;
    const cy = BH;
    const eye = EYES[frame];
    const closed = c.eye === "-" && eye !== null;
    for (let i = 0; i < f.cells.length; i += 3) {
      const lx = f.cells[i];
      const ly = f.cells[i + 1];
      const ox = (lx + 0.5 - cx) * dir;
      const oy = ly + 0.5 - cy;
      // A closed eye is skin; any other eye is the hole it was drawn with.
      const shade = f.cells[i + 2] === 0 && closed ? 5 : f.cells[i + 2];
      splat(X + ox * cos - oy * sin - 0.5, Y + ox * sin + oy * cos - 0.5, shade, 1, formed(lx, ly), jitterOf(lx, ly));
    }
    const glyphAt = (gx: number, gy: number, char: string, strength: number) => {
      const ox = (gx * SC + SC / 2 - cx) * dir;
      const oy = gy * SC + SC / 2 - cy;
      const px = X + ox * cos - oy * sin - SC / 2;
      const py = Y + ox * sin + oy * cos - SC / 2;
      const part = formed(gx * SC, gy * SC);
      // A character keeps its place clear, so the glow does not sit behind it.
      for (let sa = 0; sa < SC; sa++) for (let sb = 0; sb < SC; sb++) splat(px + sa, py + sb, 0, 1, part);
      const slot = GLYPHS.indexOf(char);
      liveGlyphs.push(px, py, dir < 0 ? FLIPPED[slot] : slot, part * strength, SC);
    };
    for (let i = 0; i < f.glyphs.length; i += 3) glyphAt(f.glyphs[i], f.glyphs[i + 1], String.fromCharCode(f.glyphs[i + 2]), 0.8);
    if (eye && c.eye) glyphAt(eye.x, eye.y, c.eye, 0.9);

    // The covered cells leave a faint wake behind a moving body, and light a ring of faint dots
    // around it (the glow).
    const R = S.glow;
    const own = dark ? 0.3 : 0.26;
    const halo = dark ? 0.14 : 0.12;
    for (const i of touched) {
      if (cover[i] < 0.01) continue;
      const shade = shadeSum[i] / cover[i];
      const a = Math.min(1, light[i]);
      const x = i % cols;
      const y = (i - x) / cols;
      const left = own * a * (shade / 5) * smooth(shade - 2);
      if (trail[i] < left) trail[i] = left;
      if (a < 0.05) continue;
      for (let dy = -R; dy <= R; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= rows) continue;
        for (let dx = -R; dx <= R; dx++) {
          const xx = x + dx;
          const d = Math.hypot(dx, dy);
          if (!d || d > R + 0.5 || xx < 0 || xx >= cols) continue;
          const j = yy * cols + xx;
          const v = halo * a * (1 - (d - 1) / (R + 0.5));
          if (glowMark[j] !== mark) {
            glowMark[j] = mark;
            glow[j] = v;
            glowing.push(j);
          } else if (glow[j] < v) glow[j] = v;
        }
      }
    }
  }

  function draw(dt: number) {
    const keep = dt ? Math.exp(-dt / 0.3) : 1;
    /** How much of a cell is not covered by the body, an eye or a character this frame. */
    const open = (i: number) => (liveMark[i] === mark ? Math.max(0, 1 - cover[i] - clear[i]) : 1);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.setTransform(dpr, 0, 0, dpr, 0, off * dpr);

    // Characters at a cell: the density and colour level pick the one from the atlas.
    const put = (i: number, level: number, g: number, alpha: number) => {
      const x = i % cols;
      ctx.globalAlpha = alpha;
      ctx.drawImage(ramp, (level * RAMP.length + g) * rampPx, 0, rampPx, rampPx, x * u, ((i - x) / cols) * u, u, u);
    };

    // The wake and the glow: dots, in a few steps of strength so they do not shimmer.
    const wakeLevel = dark ? 8 : 6;
    const dots = (a: number) => Math.round(Math.min(0.6, a * 2.2) * 6) / 6;
    for (let i = 0, n = cols * rows; i < n; i++) {
      const a = trail[i] * keep;
      trail[i] = a;
      if (a < 0.008 || (glowMark[i] === mark && glow[i] >= a)) continue;
      const alpha = dots(a) * open(i);
      if (alpha >= 0.05) put(i, wakeLevel, DOT, alpha);
    }
    for (const i of glowing) {
      if (trail[i] > glow[i]) continue;
      const alpha = dots(glow[i]) * open(i);
      if (alpha >= 0.05) put(i, wakeLevel, DOT, alpha);
    }

    // The body: each cell is the character for its shade, moved a step by its own fixed offset.
    for (const i of touched) {
      const cv = Math.min(1, cover[i]);
      if (cv < 0.3) continue;
      const shade = shadeSum[i] / cover[i];
      const level = Math.max(0, Math.min(LEVELS - 1, Math.round((shade - 1) * 4)));
      const tone = 0.25 + 0.75 * ((shade - 1) / 4);
      const g = Math.max(0, Math.min(RAMP.length - 1, Math.floor(cv * tone * RAMP.length) + jitter[i]));
      put(i, level, g, Math.min(1, light[i] / cover[i]) * (0.65 + 0.35 * (level / (LEVELS - 1))));
    }

    // Seed: a star each, fading out for the last seconds.
    for (const s of seeds) {
      const sx = Math.round(s.x / u - 0.5);
      const sy = Math.round((s.y - off) / u - 1);
      if (sx < 0 || sy < 0 || sx >= cols || sy >= rows) continue;
      put(sy * cols + sx, dark ? 12 : 9, SEED, smooth((SEED_LIFE - s.age) / 3));
    }

    // Characters are drawn where they are, on whole cells.
    for (let i = 0; i < liveGlyphs.length; i += 5) {
      const [gx, gy, slot, a, cells] = [liveGlyphs[i], liveGlyphs[i + 1], liveGlyphs[i + 2], liveGlyphs[i + 3], liveGlyphs[i + 4]];
      if (slot < 0 || a < 0.02) continue;
      ctx.globalAlpha = a;
      ctx.drawImage(atlas, slot * slotPx, 0, slotPx, slotPx, gx * u, gy * u, u * cells, u * cells);
    }

    // Effects: pixel hearts, and characters in their own colour. They step on whole cells too.
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (const m of motes) {
      if (m.life <= 0) continue;
      ctx.globalAlpha = smooth((m.life / m.max) * 1.6) * 0.95;
      ctx.fillStyle = m.color;
      const px = Math.round(m.x / u) * u;
      const py = Math.round((m.y - off) / u) * u;
      if (m.heart) {
        const cell = Math.max(2, Math.round(u * 0.45 * m.size));
        for (let r = 0; r < HEART.length; r++) {
          for (let k = 0; k < HEART[r].length; k++) {
            if (HEART[r][k] === "1") ctx.fillRect(px + (k - 2.5) * cell, py + (r - 2) * cell, cell, cell);
          }
        }
      } else {
        ctx.font = `700 ${Math.round(u * m.size * 1.5)}px ${family}`;
        ctx.fillText(m.ch, px, py);
      }
    }
    ctx.globalAlpha = 1;
  }

  /** One finished frame with nothing in motion, for reduced motion. */
  function still() {
    trail.fill(0);
    motes = [];
    c.anim = "stand";
    c.eye = "";
    c.cheep = 0;
    c.form = 1;
    stamp();
    draw(0);
  }

  // ---- the loop ------------------------------------------------------------------------------
  function step(dt: number) {
    sense(dt);
    update(dt);
    // Seed falls to the floor.
    const G = u * 160;
    for (const s of seeds) {
      s.age += dt;
      if (s.y < s.land) {
        s.vy += G * dt;
        s.y = Math.min(s.land, s.y + s.vy * dt);
      }
    }
    if (seeds.some((s) => s.age > SEED_LIFE)) seeds = seeds.filter((s) => s.age <= SEED_LIFE);
    const slow = Math.exp(-2 * dt);
    for (const m of motes) {
      m.life -= dt;
      m.x += m.vx * dt;
      m.y += m.vy * dt;
      m.vx *= slow;
      m.vy *= slow;
    }
    if (motes.length && motes[0].life <= 0) motes = motes.filter((m) => m.life > 0);
    setCursor();
  }

  /** The pointer says what it can do: pick up, or (when it is fed up) leave it be. */
  function setCursor() {
    let want = "";
    if (state === "held") want = "held";
    else if (visible() && fs.over && ptr.fine) want = mood.irritationStage === "furious" || mood.irritationStage === "angry" ? "stop" : "over";
    if (want === cursor) return;
    cursor = want;
    if (want) root.setAttribute("data-chick-state", want);
    else root.removeAttribute("data-chick-state");
  }

  function frame(stamp2: number) {
    raf = 0;
    // The first frame's timestamp can be earlier than the clock read when the loop started, so
    // never step backwards. A late frame is made up in full, in steps no longer than 1/60 s.
    const dt = Math.max(0, Math.min(0.1, (stamp2 - last) / 1000));
    last = stamp2;
    time += dt;
    for (let left = dt; left > 1e-5; left -= 1 / 60) step(Math.min(left, 1 / 60));
    stamp();
    draw(dt);
    wake();
  }

  function wake() {
    if (raf || dead || reduced || document.hidden) return;
    last = performance.now();
    raf = requestAnimationFrame(frame);
  }

  // ---- the pointer ---------------------------------------------------------------------------
  const busy = (t: EventTarget | null) => t instanceof Element && !!t.closest(BUSY);

  const onMove = (e: PointerEvent) => {
    ptr.fine = e.pointerType !== "touch";
    if (!ptr.fine || reduced) return;
    ptr.x = e.clientX;
    ptr.y = e.clientY;
    ptr.on = true;
    ptr.moved = time;
    for (const ev of gestures.move(now(), e.clientX, e.clientY)) handle(ev);
  };
  const onLeave = () => {
    ptr.on = false;
  };
  const onDown = (e: PointerEvent) => {
    if (reduced || e.button !== 0 || !e.isPrimary || busy(e.target) || !visible()) return;
    ptr.fine = e.pointerType !== "touch";
    ptr.x = e.clientX;
    ptr.y = e.clientY;
    if (ptr.fine) ptr.on = true;
    pressActive = gestures.down(now(), e.clientX, e.clientY, !ptr.fine);
  };
  const onUp = (e: PointerEvent) => {
    if (reduced) return;
    const had = pressActive;
    pressActive = false;
    if (had) {
      for (const ev of gestures.up(now())) handle(ev);
      return;
    }
    if (busy(e.target) || !e.isPrimary) return;
    // A click on bare page: it looks at the spot, and the click feeds it. Not on words, and not at the end of selecting some.
    if (Math.abs(e.clientX - c.x) < 400 && free() && state !== "sleep" && state !== "sleepy") c.face = e.clientX > c.x ? 1 : -1;
    if (e.target instanceof Element && e.target.closest(WORDS)) return;
    if (window.getSelection()?.toString()) return;
    sow(e.clientX, e.clientY);
  };
  const onCancel = () => {
    pressActive = false;
    for (const ev of gestures.cancel(now())) handle(ev);
  };
  /** Pressing on the chicken must not start selecting the text underneath it. */
  const onMouseDown = (e: MouseEvent) => {
    if (reduced || e.button !== 0 || busy(e.target) || !visible()) return;
    const r = hitRect();
    if (e.clientX >= r.x && e.clientX <= r.x + r.w && e.clientY >= r.y && e.clientY <= r.y + r.h) e.preventDefault();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape" && state === "held") onCancel();
  };

  /** Seed from a click: it drops from the pointer to the floor. */
  function sow(x: number, y: number) {
    if (!visible() || reduced) return;
    for (let k = 0; k < 3; k++) {
      if (seeds.length >= MAX_SEEDS) seeds.shift();
      const sx = Math.max(u, Math.min(w - u, x + (k - 1) * u * 3 + between(-u, u)));
      seeds.push({ x: sx, y: y + k * 2, vy: 0, land: floorY(), age: 0 });
    }
  }

  // ---- commands (the footer button) ----------------------------------------------------------
  function command(kind: ChickenCommand) {
    if (kind === "status") return emit();
    if (kind === "hide") {
      enabled = false;
      try {
        window.localStorage.setItem(STORAGE_KEY, "off");
      } catch {
        /* storage can be blocked */
      }
      seeds = [];
      if (reduced) {
        goAway(0);
        still();
      } else if (visible()) {
        if (state === "held") onCancel();
        leave();
      }
      return emit();
    }
    // "show" and "call"
    enabled = true;
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* storage can be blocked */
    }
    if (!visible()) {
      if (reduced) {
        c.y = floorY();
        c.x = onGridX(clampX(w / 2));
        c.face = 1;
        c.form = 1;
        enter("idle");
        still();
      } else away = 0.3;
    }
    emit();
  }
  const onCommand = (e: Event) => command(((e as CustomEvent).detail ?? "status") as ChickenCommand);

  // ---- start ---------------------------------------------------------------------------------
  const themes = new MutationObserver(() => {
    readTheme();
    if (reduced) still();
  });
  themes.observe(root, { attributes: true, attributeFilter: ["class"] });
  window.addEventListener("resize", measure, { passive: true });
  window.addEventListener(COMMAND_EVENT, onCommand);
  window.addEventListener("pointermove", onMove, { passive: true });
  window.addEventListener("pointerdown", onDown, { passive: true });
  window.addEventListener("pointerup", onUp, { passive: true });
  window.addEventListener("pointercancel", onCancel, { passive: true });
  window.addEventListener("mousedown", onMouseDown);
  window.addEventListener("keydown", onKey);
  root.addEventListener("pointerleave", onLeave);
  document.addEventListener("visibilitychange", wake);

  readTheme();
  measure();
  // The first time: 3 to 6 seconds after the page loads (a second when asked for with ?chicken=1). With reduced motion it never
  // turns up by itself: the footer button calls it, and it stands still.
  away = forced ? 1 : between(3, 6);
  emit();
  // The characters need the site's mono font.
  void document.fonts?.ready.then(() => {
    if (dead) return;
    buildAtlas();
    if (reduced) still();
  });
  wake();

  return {
    destroy() {
      dead = true;
      if (raf) cancelAnimationFrame(raf);
      themes.disconnect();
      window.removeEventListener("resize", measure);
      window.removeEventListener(COMMAND_EVENT, onCommand);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      window.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("keydown", onKey);
      root.removeEventListener("pointerleave", onLeave);
      document.removeEventListener("visibilitychange", wake);
      root.removeAttribute("data-chick-state");
    },
  };
}
