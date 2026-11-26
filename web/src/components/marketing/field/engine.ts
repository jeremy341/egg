/**
 * The chickens of the site: one fixed canvas over the whole public page.
 *
 * Everything is drawn as cells on a grid that divides the page's 30px grid (10px cells, 6px on a
 * phone), with fillRect only: no blur, no gradient. A chicken is a small sprite drawn `scale`
 * grid cells to a sprite cell, so it is big and still crisp. What makes it move smoothly:
 *
 *   Position. A chicken's place is a real number, not a cell. Each cell of its sprite is shared
 *   out over the four grid cells it overlaps, by how much of each it covers (sim.ts `coverage`).
 *   A body therefore slides by cross-fading cells. At rest it sits exactly on the grid and is crisp.
 *
 *   Pose. A chicken holds a weight for each of its frames. The weights ease towards the pose the
 *   animation asks for, so every change of frame (a hop, a flap, a cheep, the hatch) is a short
 *   cross-fade through the same cell blending, never a swap.
 *
 *   Time. Every rate is integrated for the real time that passed, in steps of at most 1/60 s, so
 *   it moves the same at 60, 90 and 120 Hz and catches up after a late frame.
 *
 * The chickens live on the page, not on the screen. Their place is in page coordinates (the feet
 * stand on a line of the 30px page grid) and the canvas, which covers the window, shows the part
 * that is scrolled into view. They keep out of the text (the boxes of headings, paragraphs, links
 * and the like, collected from the page and re-collected when it changes), come to the pointer,
 * can be poked, petted, picked up and thrown, and run for seed dropped with a click. When the
 * page is scrolled far away from one, it walks in from the edge of the window.
 *
 * The loop only runs while the tab is visible. With reduced motion it never runs: one still frame
 * is drawn, on the grid, and drawn again when the page scrolls. The canvas is decoration: hidden
 * from assistive technology, never focusable, and it takes no pointer events (the page listens).
 */

import { INK, SHELL, SPECIES, TEXT_DIM } from "./creatures";
import {
  cellSize,
  clearOf,
  countIndex,
  coverage,
  glyphSet,
  hash,
  mirror,
  mixHex,
  parse,
  pushOut,
  rng,
  smooth,
  steer,
  type Rect,
} from "./sim";

interface Seed {
  x: number;
  /** Page coordinates; it falls until it reaches `land`, a line of the page grid. */
  y: number;
  vy: number;
  land: number;
  age: number;
  claimed: Chicken | null;
}

interface Chicken {
  /** Page coordinates; y is where the feet stand. */
  x: number;
  y: number;
  vx: number;
  vy: number;
  tx: number;
  ty: number;
  face: 1 | -1;
  /** Facing as drawn: it eases from one side to the other through 0 (edge on). */
  dir: number;
  /** Its own clock, in seconds, started at a random phase. */
  t: number;
  /** Where it is in a wing beat, in poses. */
  beat: number;
  /** Where it is in a hop, 0 to 1. 0: on the ground. */
  hop: number;
  /** How much of each frame it shows. */
  pose: Float32Array;
  seed: number;
  /** Depth, 0.8 (a little slower) to 1. */
  z: number;
  rest: number;
  panic: number;
  /** What is left of a scatter push, and for how long it still acts. */
  kx: number;
  ky: number;
  kick: number;
  form: number;
  delay: number;
  intro: number;
  lured: boolean;
  wake: number;
  /** Where it settles around the pointer, in cells. */
  ox: number;
  oy: number;
  /** 1 in the clear, down to TEXT_DIM over text. */
  fade: number;
  /** Held by the pointer, and where on its body. */
  held: boolean;
  hx: number;
  hy: number;
  /** The seed it is running for, and how long it has been pecking at it. */
  eat: Seed | null;
  peck: number;
  /** Seconds left of a cheep, and of being stroked. */
  cheep: number;
  purr: number;
  /** How long the pointer has rested on it. */
  over: number;
  pokes: number;
  pokedAt: number;
  /** Next time to check it is where the reader can see it. */
  look: number;
}

interface Mote {
  x: number;
  y: number;
  vx: number;
  vy: number;
  slot: number;
  life: number;
  max: number;
  /** Size in grid cells. */
  size: number;
}

export interface Field {
  /** Where every chicken is, in cells (x, y pairs). For measuring motion. */
  peek(): number[];
  destroy(): void;
}

const S = SPECIES[0];
const SC = S.scale;
const PAGE_CELL = 30;
/** The fixed header covers this much of the top of the window. */
const HEADER = 64;
const INTRO = 2.1;
const FORM = 0.5;
const KICK = 0.14;
const CHEEP = 0.5;
const MAX_MOTES = 160;
const MAX_SEEDS = 10;
const SEED_LIFE = 16;
/** Shades are blended in quarter steps: 1, 1.25, ... 5. */
const LEVELS = 17;
const EMOTES = "!?~*zo";
/** Body characters, from the faintest to the densest: a cell is drawn as the one for how much of it is covered and how bright. */
const RAMP = ".:-=+*#%@";
const DOT = 0;
const SEED = RAMP.indexOf("*");
const GLYPHS = glyphSet(S.frames, S.wake + SHELL + EMOTES);
/** The character to draw in place of each one when a chicken faces left. */
const FLIPPED = [...GLYPHS].map((ch) => GLYPHS.indexOf(mirror([ch])[0]));
const SPRITES = S.frames.map((f) => parse(f, SC));
const SW = SPRITES[0].w;
const SH = SPRITES[0].h;
/** The body, in grid cells. */
const BW = SW * SC;
const BH = SH * SC;
const Q = S.seq;

/** A click on one of these belongs to the page, not to a chicken. */
const BUSY = "a, button, input, textarea, select, summary, label, [role='button'], [role='link'], [contenteditable], iframe, video";
/** A click on text is a click on text: it drops no seed. */
const WORDS = "h1, h2, h3, h4, p, li, pre, code, table, blockquote, figure, img, svg";

export function createField(canvas: HTMLCanvasElement, reduced: boolean): Field {
  const ctx = canvas.getContext("2d")!;
  const root = document.documentElement;
  const random = rng(20261114);
  const atlas = document.createElement("canvas");
  /** The body characters, once per colour level: drawing a cell of a body is then a blit. */
  const ramp = document.createElement("canvas");

  let w = 0;
  let h = 0;
  let dpr = 1;
  let u = 10; // cell size
  let cols = 0;
  let rows = 0;
  /** The page position at the top of grid row 0, always a whole number of cells. */
  let base = 0;
  /** How far the window is scrolled past `base`, 0 to one cell. */
  let offY = 0;
  let scrollY = 0;
  let docH = 0;
  let trail = new Float32Array(0);
  // What the bodies cover this frame, per grid cell: how much of the cell, how bright, which
  // shade (summed, to be averaged), and how much is kept clear (eyes, characters).
  let liveMark = new Uint32Array(0);
  let cover = new Float32Array(0);
  let light = new Float32Array(0);
  let shadeSum = new Float32Array(0);
  let clear = new Float32Array(0);
  let glow = new Float32Array(0);
  let glowMark = new Uint32Array(0);
  let mark = 0;
  const touched: number[] = [];
  const glowing: number[] = [];
  const buckets: number[][] = Array.from({ length: LEVELS }, () => []);
  const liveGlyphs: number[] = []; // x, y (in cells, fractional), slot, alpha, size
  const share: number[] = [];
  let rects: Rect[] = [];
  let dark = root.classList.contains("dark");
  let fills: string[] = [];
  let list: Chicken[] = [];
  let motes: Mote[] = [];
  let seeds: Seed[] = [];
  let slotPx = 0;
  let rampPx = 0;
  let time = 0;
  let last = 0;
  let raf = 0;
  let dead = false;
  const aimed = new Float32Array(S.frames.length);
  const ptr = { x: 0, y: 0, on: false, fine: false };
  /** The chicken under a button press, whether it is being carried, and the press itself. */
  let held: Chicken | null = null;
  let press: { c: Chicken | null; x: number; y: number; at: number; drag: boolean; id: number } | null = null;

  const between = (a: number, b: number) => a + random() * (b - a);
  const ease = (rate: number, dt: number) => 1 - Math.exp(-rate * dt);
  const theme = () => (dark ? "dark" : "light");

  function readTheme() {
    dark = root.classList.contains("dark");
    const t = theme();
    fills = Array.from({ length: LEVELS }, (_, l) => {
      const at = Math.min(3, Math.floor(l / 4));
      return mixHex(S.ramp[t][at], S.ramp[t][at + 1], l / 4 - at);
    });
    buildAtlas();
  }

  /** Every character once, in the ink colour, at device resolution: drawing one is then a blit. */
  function buildAtlas() {
    slotPx = Math.round(u * SC * dpr);
    atlas.width = slotPx * GLYPHS.length;
    atlas.height = slotPx;
    const a = atlas.getContext("2d")!;
    a.clearRect(0, 0, atlas.width, atlas.height);
    a.fillStyle = INK[theme()];
    a.font = `700 ${Math.round(u * SC * 1.5 * dpr)}px ${getComputedStyle(canvas).fontFamily}`;
    a.textAlign = "center";
    a.textBaseline = "middle";
    for (let i = 0; i < GLYPHS.length; i++) a.fillText(GLYPHS[i], (i + 0.5) * slotPx, slotPx * 0.54);

    rampPx = Math.round(u * dpr);
    ramp.width = rampPx * LEVELS * RAMP.length;
    ramp.height = rampPx;
    const r = ramp.getContext("2d")!;
    r.clearRect(0, 0, ramp.width, ramp.height);
    r.font = `700 ${Math.round(u * 1.5 * dpr)}px ${getComputedStyle(canvas).fontFamily}`;
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
    const regroup = cellSize(nw) !== u || countIndex(nw) !== countIndex(w) || !list.length;
    w = nw;
    h = nh;
    dpr = ndpr;
    u = cellSize(w);
    if (resized) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round((h + u) * dpr);
      cols = Math.ceil(w / u);
      rows = Math.ceil(h / u) + 1;
      const n = cols * rows;
      trail = new Float32Array(n);
      liveMark = new Uint32Array(n);
      cover = new Float32Array(n);
      light = new Float32Array(n);
      shadeSum = new Float32Array(n);
      clear = new Float32Array(n);
      glow = new Float32Array(n);
      glowMark = new Uint32Array(n);
      buildAtlas();
    }
    place();
    collect();
    if (regroup || (reduced && resized)) spawn(!reduced);
    if (reduced) still();
  }

  /** Where the window is on the page, as whole grid rows. Moves the trail with the page. */
  function place() {
    scrollY = window.scrollY;
    const next = Math.floor(scrollY / u) * u;
    const rowsMoved = Math.round((next - base) / u);
    if (rowsMoved && trail.length) {
      const n = Math.abs(rowsMoved) * cols;
      if (n >= trail.length) trail.fill(0);
      else if (rowsMoved > 0) {
        trail.copyWithin(0, n);
        trail.fill(0, trail.length - n);
      } else {
        trail.copyWithin(n, 0, trail.length - n);
        trail.fill(0, 0, n);
      }
    }
    base = next;
    offY = scrollY - base;
  }

  /**
   * The boxes chickens keep out of, in page coordinates: every line of text (so the empty end of
   * a heading is free) and the small controls and pictures.
   */
  function collect() {
    const sy = window.scrollY;
    const out: Rect[] = [];
    const add = (r: DOMRect) => {
      if (r.width >= 4 && r.height >= 4) out.push({ x: r.left, y: r.top + sy, w: r.width, h: r.height });
    };
    const range = document.createRange();
    for (const part of document.querySelectorAll("main, footer")) {
      const walk = document.createTreeWalker(part, NodeFilter.SHOW_TEXT, {
        acceptNode: (n) =>
          n.nodeValue?.trim() && !n.parentElement?.closest("script, style, noscript, [data-chickens-ignore]")
            ? NodeFilter.FILTER_ACCEPT
            : NodeFilter.FILTER_REJECT,
      });
      for (let n = walk.nextNode(); n; n = walk.nextNode()) {
        range.selectNodeContents(n);
        for (const r of range.getClientRects()) add(r);
      }
    }
    for (const el of document.querySelectorAll<HTMLElement>("main :is(button, a, input, textarea, select, img), footer :is(button, a)")) {
      const r = el.getBoundingClientRect();
      if (r.width < 420 && r.height < 90) add(r);
    }
    rects = out;
    docH = Math.max(document.documentElement.scrollHeight, window.innerHeight);
  }

  const bodyW = () => BW * u;
  const bodyH = () => BH * u;
  /** The nearest place where the sprite sits exactly on the grid, so a resting chicken is crisp. */
  const onGridX = (x: number) => (Math.round(x / u - BW / 2) + BW / 2) * u;
  const onGridY = (y: number) => Math.round(y / PAGE_CELL) * PAGE_CELL;
  /** The lowest the feet may be so that the head clears the header, and the highest the page allows. */
  const minFeet = () => scrollY + HEADER + bodyH() * 0.95;
  const maxFeet = () => Math.max(minFeet() + PAGE_CELL, Math.min(scrollY + h - 8, docH - 8));

  /** A place on the grid in the window: clear of the text and, when it can be, of the others. */
  function spot(apart: number, near?: Chicken): [number, number] {
    const margin = bodyW() * 0.5;
    const lo = minFeet();
    const hi = maxFeet();
    let best: [number, number] = [w / 2, hi];
    let bestScore = -Infinity;
    for (let i = 0; i < 40; i++) {
      const x = margin + random() * Math.max(1, w - margin * 2);
      const y = lo + random() * Math.max(1, hi - lo);
      const open = clearOf(x, y - bodyH() * 0.5, rects, bodyW() * 0.4, 1);
      let gap = Infinity;
      for (const c of list) {
        if (c === near) continue;
        gap = Math.min(gap, Math.hypot(c.tx - x, c.ty - y));
      }
      if (open >= 1 && gap >= apart) return [x, y];
      const score = open * 1e6 + Math.min(gap, apart);
      if (score > bestScore) {
        bestScore = score;
        best = [x, y];
      }
    }
    return best;
  }

  function spawn(forming: boolean) {
    const n = S.count[countIndex(w)];
    list = [];
    for (let k = 0; k < n; k++) {
      const [px, py] = spot(bodyW() * 1.1);
      const x = onGridX(px);
      const y = onGridY(py);
      const face = random() < 0.5 ? 1 : -1;
      const c: Chicken = {
        x,
        y,
        vx: 0,
        vy: 0,
        tx: x,
        ty: y,
        face,
        dir: face,
        t: random() * 20,
        beat: random() * 8,
        hop: 0,
        pose: new Float32Array(S.frames.length),
        seed: random(),
        z: between(0.85, 1),
        rest: between(0.2, 1.5),
        panic: 0,
        kx: 0,
        ky: 0,
        kick: 0,
        form: forming ? 0 : 1,
        delay: forming ? k * 0.25 + random() * 0.2 : 0,
        intro: forming ? INTRO : 0,
        lured: false,
        wake: 0,
        ox: (k - (n - 1) / 2) * BW * 0.8 + between(-2, 2),
        oy: between(0, 5),
        fade: 1,
        held: false,
        hx: 0,
        hy: 0,
        eat: null,
        peck: 0,
        cheep: 0,
        purr: 0,
        over: 0,
        pokes: 0,
        pokedAt: -9,
        look: 0,
      };
      aim(c, c.pose);
      list.push(c);
    }
    held = null;
    press = null;
    seeds = [];
  }

  /** A new place to go. `how`: 0 the nearest of three, 1 anywhere, 2 the farthest from the pointer. */
  function retarget(c: Chicken, how: 0 | 1 | 2) {
    let best: [number, number] | null = null;
    let score = -Infinity;
    for (let k = how === 1 ? 1 : 3; k > 0; k--) {
      const p = spot(bodyW() * 0.9, c);
      const s = how === 2 ? Math.hypot(p[0] - ptr.x, p[1] - (ptr.y + scrollY)) : -Math.hypot(p[0] - c.x, p[1] - c.y);
      if (s > score) {
        score = s;
        best = p;
      }
    }
    c.tx = onGridX(best![0]);
    c.ty = onGridY(best![1]);
  }

  function mote(x: number, y: number, chars: string, vx: number, vy: number, life: number, size = SC * 0.7) {
    if (motes.length >= MAX_MOTES) motes.shift();
    const ch = chars[Math.floor(random() * chars.length)];
    motes.push({ x, y, vx, vy, slot: GLYPHS.indexOf(ch), life, max: life, size });
  }

  /** A word over the head: `!` for a start, `?` for curiosity, `~` for a purr. */
  function say(c: Chicken, chars: string, n = 1) {
    for (let k = 0; k < n; k++) {
      mote(c.x + between(-3, 3) * u + (k - (n - 1) / 2) * u * 2.5, c.y - bodyH() * 1.02, chars, between(-2, 2) * u, -between(4, 7) * u, 1.1, SC);
    }
  }

  /** Add a place in a pose sequence to the weights: the two frames around `p`, by how near each is. */
  function along(out: Float32Array, seq: readonly number[], p: number, loops: boolean) {
    const n = seq.length;
    const at = loops ? ((p % n) + n) % n : Math.max(0, Math.min(n - 1, p));
    const a = Math.floor(at);
    const f = at - a;
    out[seq[a]] += 1 - f;
    out[seq[loops ? (a + 1) % n : Math.min(n - 1, a + 1)]] += f;
  }

  const flying = (c: Chicken) => c.held || c.panic > 0 || Math.abs(c.vy) > u * 2.5;

  /** The pose the chicken should be in now, as weights over its frames (they add up to 1). */
  function aim(c: Chicken, out: Float32Array) {
    out.fill(0);
    if (c.intro > 0) return along(out, Q.intro, (1 - c.intro / INTRO) * (Q.intro.length - 1), false);
    if (!reduced && flying(c)) return along(out, Q.flap, c.beat, true);
    if (c.peck > 0) return along(out, [0, 1, 0, 1], (c.t * 9) % 4, true);
    if (c.cheep > 0) return along(out, Q.peep, (1 - c.cheep / CHEEP) * (Q.peep.length - 1), false);
    if (c.hop > 0) return along(out, Q.hop, c.hop * (Q.hop.length - 1), false);
    const p = (c.t + c.seed * 7) % (c.lured ? 1.5 : 3.8);
    return along(out, p < 0.55 && !reduced ? Q.peep : Q.rest, (p / 0.55) * (Q.peep.length - 1), false);
  }

  const bodyAt = (c: Chicken): [number, number, number, number] => [
    c.x - bodyW() * 0.42,
    c.y - bodyH() * 0.95,
    c.x + bodyW() * 0.42,
    c.y,
  ];

  /** The chicken under a point of the window, if any. */
  function hit(clientX: number, clientY: number, slack: number): Chicken | null {
    const px = clientX;
    const py = clientY + scrollY;
    let best: Chicken | null = null;
    for (const c of list) {
      if (c.intro > 0 || c.delay > 0) continue;
      const [x0, y0, x1, y1] = bodyAt(c);
      if (px >= x0 - slack && px <= x1 + slack && py >= y0 - slack && py <= y1 + slack && (!best || c.y > best.y)) best = c;
    }
    return best;
  }

  function startle(c: Chicken, fromX: number, fromY: number, power: number) {
    let dx = c.x - fromX;
    let dy = c.y - bodyH() * 0.5 - fromY;
    if (Math.hypot(dx, dy) < 1) {
      dx = random() - 0.5;
      dy = random() - 0.5;
    }
    const n = Math.hypot(dx, dy);
    c.kx = (dx / n) * u * 62 * power * between(0.8, 1.2);
    c.ky = (dy / n) * u * 40 * power * between(0.8, 1.2);
    c.kick = KICK;
    c.panic = between(0.8, 1.3) * power;
    c.rest = 0;
    c.eat = null;
    c.peck = 0;
  }

  /** A tap or a click on a chicken: it cheeps and hops. The third in a row sends it off. */
  function poke(c: Chicken, x: number, y: number) {
    if (time - c.pokedAt < 0.2) return;
    c.pokes = time - c.pokedAt < 3 ? c.pokes + 1 : 1;
    c.pokedAt = time;
    c.face = x > c.x ? 1 : -1;
    c.rest = 0.6;
    c.eat = null;
    c.peck = 0;
    if (c.pokes >= 3) {
      say(c, "!", 3);
      startle(c, x, y + scrollY, 1);
      c.pokes = 0;
      return;
    }
    say(c, c.pokes === 1 ? "!" : "!?");
    c.cheep = CHEEP;
    c.hop = 0.0001;
    c.vy = -u * 8;
  }

  /** Seed from a click: it drops to the line of the grid below the pointer. */
  function sow(x: number, y: number) {
    for (let k = 0; k < 3; k++) {
      const sy = y + scrollY + k * 2;
      const sx = Math.max(u, Math.min(w - u, x + (k - 1) * u * 3 + between(-u, u)));
      const land = Math.min(docH - 4, Math.ceil((sy + 2) / PAGE_CELL) * PAGE_CELL);
      // Seed under a box of text could never be reached: the chickens keep out of those.
      if (clearOf(sx, land - u, rects, u * 2, 1) < 1) continue;
      if (seeds.length >= MAX_SEEDS) seeds.shift()!.claimed = null;
      seeds.push({ x: sx, y: sy, vy: 0, land, age: 0, claimed: null });
    }
  }

  function release() {
    const c = held;
    held = null;
    root.removeAttribute("data-chick-state");
    if (!c) return;
    c.held = false;
    const v = Math.hypot(c.vx, c.vy);
    const cap = u * 90;
    if (v > cap) {
      c.vx *= cap / v;
      c.vy *= cap / v;
    }
    c.panic = v > u * 12 ? 0.9 : 0.35;
    c.kick = 0;
    c.pokes = 0;
    say(c, v > u * 12 ? "!" : "~");
    c.rest = 0;
    retarget(c, 0);
  }

  function step(dt: number) {
    for (const c of list) {
      c.t += dt;
      if (c.delay > 0) {
        c.delay -= dt;
        continue;
      }
      if (c.form < 1) c.form = Math.min(1, c.form + dt / FORM);
      c.cheep = Math.max(0, c.cheep - dt);
      c.purr = Math.max(0, c.purr - dt);
      const speed = S.speed * u * c.z;

      if (c.held) {
        // Carried: it hangs from the pointer by the place it was taken, and its speed is what it
        // would be thrown with.
        const gx = ptr.x - c.hx;
        const gy = ptr.y + scrollY - c.hy;
        const k = ease(28, dt);
        const nx = c.x + (gx - c.x) * k;
        const ny = c.y + (gy - c.y) * k;
        const j = ease(14, dt);
        c.vx += ((nx - c.x) / dt - c.vx) * j;
        c.vy += ((ny - c.y) / dt - c.vy) * j;
        c.x = nx;
        c.y = ny;
        c.hop = 0;
        c.rest = 0;
        if (random() < dt * 3) mote(c.x, c.y - bodyH() * 0.5, "'", 0, -u * 2, 0.7, 1.3);
      } else if (c.intro > 0) {
        c.intro -= dt;
        if (c.intro <= 0) {
          // Hatched: bits of shell fly off.
          for (let k = 0; k < 8; k++) {
            mote(c.x + between(-6, 6) * u, c.y - between(3, 16) * u, SHELL, between(-6, 6) * u, between(-6, 1) * u, 0.9, 1.4);
          }
        }
      } else {
        c.lured = false;
        if (c.panic > 0) {
          // A scatter is a push that builds over a few frames, then drag takes the speed away.
          c.panic -= dt;
          if (c.kick > 0) {
            const part = Math.min(dt, c.kick) / KICK;
            c.vx += c.kx * part;
            c.vy += c.ky * part;
            c.kick -= dt;
          }
          const drag = Math.exp(-1.5 * dt);
          c.vx *= drag;
          c.vy *= drag;
          if (c.panic <= 0) retarget(c, 1);
        } else {
          let wx = 0;
          let wy = 0;
          // Seed beats everything but a startle: it runs for the nearest it can have.
          if (!c.eat) c.eat = nearestSeed(c);
          if (c.eat && c.eat.claimed !== c) c.eat = null;
          if (c.eat) {
            c.tx = onGridX(c.eat.x);
            c.ty = onGridY(c.eat.land);
            c.rest = 0;
            c.lured = true;
          } else if (ptr.on && ptr.fine) {
            const px = ptr.x - c.x;
            const py = ptr.y + scrollY - (c.y - bodyH() * 0.45);
            if (Math.hypot(px, py) < S.reach * u) {
              // Curious: it settles at its own spot around the pointer, a little below it.
              c.tx = onGridX(ptr.x + c.ox * u);
              c.ty = onGridY(ptr.y + scrollY + bodyH() * 0.45 + c.oy * u);
              c.rest = 0;
              c.lured = true;
            }
          }
          const dx = c.tx - c.x;
          const dy = c.ty - c.y;
          const d = Math.hypot(dx, dy);
          if (c.peck > 0) {
            // Pecking: it stands and bobs, then the seed is gone.
            c.peck -= dt;
            c.vx *= Math.exp(-12 * dt);
            c.vy *= Math.exp(-12 * dt);
            if (c.peck <= 0 && c.eat) {
              mote(c.eat.x, c.eat.y - u, ",", between(-2, 2) * u, -u * 3, 0.6, 1.2);
              seeds = seeds.filter((s) => s !== c.eat);
              c.eat = null;
              c.rest = between(0.1, 0.5);
              c.hop = 0.0001;
              if (random() < 0.35) say(c, "~");
            }
          } else if (c.eat && d < u * 3) {
            c.peck = between(0.55, 0.8);
          } else if (c.rest > 0) {
            c.rest -= dt;
            if (c.rest <= 0) retarget(c, 0);
          } else if (!c.lured && d < u * 0.5) {
            c.rest = between(S.rest[0], S.rest[1]);
          }
          if (d > 0.01 && c.peck <= 0) {
            // Slowing into a stop: the last cells are covered ever more slowly, down to nothing.
            const near = Math.min(1, d / (u * 4));
            wx += (dx / d) * speed * near * (c.eat ? 1.25 : 1);
            wy += (dy / d) * speed * near * (c.eat ? 1.25 : 1);
          }
          if (c.rest <= 0 && c.peck <= 0) {
            const [fx, fy] = pushOut(c.x, c.y - bodyH() * 0.5, rects, bodyW() * 0.45);
            wx += fx * speed * 1.5;
            wy += fy * speed * 1.5;
          }
          // They do not stand on each other: two bodies that overlap are pushed apart.
          for (const o of list) {
            if (o === c || o.delay > 0 || o.intro > 0) continue;
            const ax = (c.x - o.x) / (bodyW() * 0.7);
            const ay = (c.y - o.y) / (bodyH() * 0.6);
            const near = 1 - Math.hypot(ax, ay);
            if (near > 0) {
              const n = Math.hypot(ax, ay) || 1;
              wx += (ax / n || (c.seed > o.seed ? 1 : -1)) * near * speed * 2.4;
              wy += (ay / n) * near * speed * 2.4;
            }
          }
          [c.vx, c.vy] = steer(c.vx, c.vy, wx, wy, S.turn, S.accel, dt);
        }
        c.x += c.vx * dt;
        c.y += c.vy * dt;
        // Never off the left or right of the window, nor above the header or under the page.
        c.x = Math.max(bodyW() * 0.2, Math.min(w - bodyW() * 0.2, c.x));
        c.y = Math.max(bodyH() * 0.95 + 8, Math.min(docH - 4, c.y));
      }

      // Where the reader can see it: when the window has scrolled away, it walks in from the side.
      c.look -= dt;
      if (c.look <= 0 && !c.held && c.intro <= 0) {
        c.look = 0.4;
        const gone = c.y < scrollY - h * 0.6 || c.y - bodyH() > scrollY + h * 1.6;
        if (gone) {
          const side = random() < 0.5 ? -1 : 1;
          c.x = side < 0 ? -bodyW() * 0.6 : w + bodyW() * 0.6;
          const [, py] = spot(0);
          c.y = onGridY(py);
          c.vx = 0;
          c.vy = 0;
          c.eat = null;
          c.peck = 0;
          c.panic = 0;
          c.rest = 0;
          retarget(c, 1);
        } else if (c.panic <= 0 && c.peck <= 0 && !c.lured && (c.ty < minFeet() - PAGE_CELL || c.ty > maxFeet() + PAGE_CELL || c.y < minFeet() - PAGE_CELL * 2)) {
          c.rest = 0;
          retarget(c, 0);
        }
      }

      // Stroking: the pointer resting on a chicken, not moving off, makes it purr.
      if (!c.held && ptr.on && ptr.fine && !press) {
        const [x0, y0, x1, y1] = bodyAt(c);
        const on = ptr.x >= x0 && ptr.x <= x1 && ptr.y + scrollY >= y0 && ptr.y + scrollY <= y1;
        c.over = on ? c.over + dt : 0;
        if (on && c.over > 0.9 && c.purr <= 0 && c.panic <= 0 && c.peck <= 0) {
          c.purr = 1.4;
          c.cheep = CHEEP;
          say(c, "~*");
          c.over = 0.2;
        }
      } else c.over = 0;

      const v = Math.hypot(c.vx, c.vy);
      if (c.held) c.face = c.vx > u * 2 ? 1 : c.vx < -u * 2 ? -1 : c.face;
      else if (Math.abs(c.vx) > u * 0.8) c.face = c.vx > 0 ? 1 : -1;
      else if (c.lured && Math.abs(ptr.x - c.x) > u * 2 && !c.eat) c.face = ptr.x > c.x ? 1 : -1;
      c.dir += (c.face - c.dir) * ease(10, dt);

      // The beat: a hopping chicken takes a whole hop at a time and always lands before it stands.
      c.beat += dt * (S.fps * (c.held ? 1.7 : 1));
      const walking = v > u * 0.6 && !flying(c) && c.intro <= 0 && c.peck <= 0;
      if (walking || c.hop > 0) {
        c.hop += (dt * S.fps) / Q.hop.length;
        if (c.hop >= 1) c.hop = walking ? c.hop - 1 : 0;
      }
      aim(c, aimed);
      const k = ease(22, dt);
      for (let f = 0; f < aimed.length; f++) c.pose[f] += (aimed[f] - c.pose[f]) * k;

      // Less of it shows over text, so the words keep their contrast.
      const want = TEXT_DIM + (1 - TEXT_DIM) * clearOf(c.x, c.y - bodyH() * 0.45, rects, bodyW() * 0.18, u * 5);
      c.fade += (want - c.fade) * ease(8, dt);

      c.wake += v * dt;
      if (c.wake > u * 5 && v > u && !c.held) {
        c.wake = 0;
        mote(c.x - (c.vx / v) * 8 * u, c.y - u * (c.panic > 0 ? 6 : 0.5), S.wake, 0, 0, 1.5, SC * 0.6);
      }
    }

    // Seed falls to its line.
    for (const s of seeds) {
      s.age += dt;
      if (s.y < s.land) {
        s.vy += u * 120 * dt;
        s.y = Math.min(s.land, s.y + s.vy * dt);
      }
    }
    if (seeds.some((s) => s.age > SEED_LIFE)) {
      seeds = seeds.filter((s) => s.age <= SEED_LIFE);
      for (const c of list) if (c.eat && !seeds.includes(c.eat)) c.eat = null;
    }

    const slow = Math.exp(-2 * dt);
    for (const m of motes) {
      m.life -= dt;
      m.x += m.vx * dt;
      m.y += m.vy * dt;
      m.vx *= slow;
      m.vy *= slow;
    }
    if (motes.length && motes[0].life <= 0) motes = motes.filter((m) => m.life > 0);
  }

  /** The nearest seed that has landed and that nobody else is running for. */
  function nearestSeed(c: Chicken): Seed | null {
    let best: Seed | null = null;
    let near = Infinity;
    for (const s of seeds) {
      if (s.claimed && s.claimed !== c) continue;
      if (s.y < s.land - 1) continue;
      const d = Math.hypot(s.x - c.x, s.land - c.y);
      if (d < near) {
        near = d;
        best = s;
      }
    }
    if (best) best.claimed = c;
    return best;
  }

  /** One sprite cell at a place between grid cells: shared out over the four cells it overlaps. */
  function splat(x: number, y: number, shade: number, a: number, weight: number) {
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
        touched.push(i);
      }
      if (shade) {
        cover[i] += part;
        light[i] += part * a;
        shadeSum[i] += part * shade;
      } else clear[i] += part;
    }
  }

  function stamp() {
    mark++;
    touched.length = 0;
    glowing.length = 0;
    liveGlyphs.length = 0;
    for (const bucket of buckets) bucket.length = 0;
    // The lower a chicken stands on the page, the nearer it is: it is drawn over the others.
    const order = [...list].sort((p, q) => p.y - q.y);
    for (const c of order) {
      if (c.delay > 0) continue;
      const depth = 0.88 + 0.12 * ((c.z - 0.85) / 0.15);
      const a = depth * c.fade;
      const seed = c.seed * 97;
      // A cell appears when the forming chicken reaches it, over a moment, not at once.
      const formed = (lx: number, ly: number) => (c.form >= 1 ? 1 : smooth((c.form * 1.2 - hash(lx, ly, seed)) / 0.2));

      const X = c.x / u;
      let Y = (c.y - base) / u;
      const lift = Math.sin(Math.PI * smooth((c.hop - 0.12) / 0.72)) * 1.7 * SC;
      Y -= lift;
      // A soft shadow on the line it stands on (the line below it while it is carried or thrown),
      // smaller and fainter the higher it is.
      const floor = c.held || c.panic > 0 ? Math.ceil((c.y - 1) / PAGE_CELL) * PAGE_CELL : c.y;
      const up = Math.min(1, ((floor - c.y) / u + lift) / (4 * SC));
      const half = BW * 0.3 * (1 - up * 0.4);
      for (let k = -half; k <= half; k++) splat(X + k - 0.5, (floor - base) / u, 1, a * 0.7 * (1 - up * 0.6), 1);
      // The egg rocks on its base before it cracks.
      const rock = c.intro > INTRO * 0.4 ? Math.sin((INTRO - c.intro) * 9) * 0.05 * smooth((INTRO - c.intro) * 3) : 0;
      const cos = Math.cos(rock);
      const sin = Math.sin(rock);
      const dir = reduced ? c.face : c.dir;
      for (let index = 0; index < c.pose.length; index++) {
        const weight = c.pose[index];
        if (weight < 0.02) continue;
        const f = SPRITES[index];
        const cx = (f.w * SC) / 2;
        const cy = f.h * SC;
        for (let i = 0; i < f.cells.length; i += 3) {
          const lx = f.cells[i];
          const ly = f.cells[i + 1];
          const ox = (lx + 0.5 - cx) * dir;
          const oy = ly + 0.5 - cy;
          splat(X + ox * cos - oy * sin - 0.5, Y + ox * sin + oy * cos - 0.5, f.cells[i + 2], a, weight * formed(lx, ly));
        }
        for (let i = 0; i < f.glyphs.length; i += 3) {
          const ox = (f.glyphs[i] * SC + SC / 2 - cx) * dir;
          const oy = f.glyphs[i + 1] * SC + SC / 2 - cy;
          const gx = X + ox * cos - oy * sin - SC / 2;
          const gy = Y + ox * sin + oy * cos - SC / 2;
          const part = weight * formed(f.glyphs[i] * SC, f.glyphs[i + 1] * SC) * Math.min(1, Math.abs(dir) * 2.5);
          // A character keeps its place clear, so the glow does not sit behind it.
          for (let sa = 0; sa < SC; sa++) for (let sb = 0; sb < SC; sb++) splat(gx + sa, gy + sb, 0, a, part);
          const slot = GLYPHS.indexOf(String.fromCharCode(f.glyphs[i + 2]));
          liveGlyphs.push(gx, gy, dir < 0 ? FLIPPED[slot] : slot, (0.55 + 0.45 * a) * part, SC);
        }
      }
    }

    // Each covered cell is sorted by its blended shade, leaves itself in the trail (the wake
    // that fades behind a moving chicken) and lights a ring of faint cells around it (the glow).
    const R = S.glow;
    const own = dark ? 0.3 : 0.26;
    const halo = dark ? 0.14 : 0.1;
    for (const i of touched) {
      if (cover[i] < 0.01) continue;
      const shade = shadeSum[i] / cover[i];
      const a = Math.min(1, light[i]);
      buckets[Math.max(0, Math.min(LEVELS - 1, Math.round((shade - 1) * 4)))].push(i);
      const x = i % cols;
      const y = (i - x) / cols;
      // Only the core leaves a wake, so a fast chicken draws a streak and not a smear.
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
    const keep = dt ? Math.exp(-dt / 0.42) : 1;
    /** How much of a cell is not covered by a body, an eye or a character this frame. */
    const open = (i: number) => (liveMark[i] === mark ? Math.max(0, 1 - cover[i] - clear[i]) : 1);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h + u);
    // The grid is fixed to the page: the whole drawing shifts by what the window is scrolled
    // past the top row.
    ctx.setTransform(dpr, 0, 0, dpr, 0, -offY * dpr);

    // Characters at a cell: the density and colour level pick the one from the atlas.
    const put = (i: number, level: number, g: number, alpha: number) => {
      const x = i % cols;
      ctx.globalAlpha = alpha;
      ctx.drawImage(ramp, (level * RAMP.length + g) * rampPx, 0, rampPx, rampPx, x * u, ((i - x) / cols) * u, u, u);
    };

    // The wake: dots that fade on a smooth curve.
    const wakeLevel = dark ? 8 : 4;
    for (let i = 0, n = cols * rows; i < n; i++) {
      const a = trail[i] * keep;
      trail[i] = a;
      if (a < 0.008 || (glowMark[i] === mark && glow[i] >= a)) continue;
      const alpha = Math.min(0.6, a * 2.2) * open(i);
      if (alpha < 0.02) continue;
      put(i, wakeLevel, DOT, alpha);
    }

    // The glow: a faint ring of dots.
    for (const i of glowing) {
      if (trail[i] > glow[i]) continue;
      const alpha = Math.min(0.5, glow[i] * 2.4) * open(i);
      if (alpha < 0.02) continue;
      put(i, wakeLevel, DOT, alpha);
    }

    // The bodies: each cell is the character for how much of it is covered and how bright it is.
    for (let l = 0; l < LEVELS; l++) {
      const tone = 0.25 + (0.75 * l) / (LEVELS - 1);
      for (const i of buckets[l]) {
        const c = Math.min(1, cover[i]);
        const g = Math.min(RAMP.length - 1, Math.floor(c * tone * RAMP.length));
        if (c * tone < 0.1) continue;
        put(i, l, g, Math.min(1, light[i] / cover[i]) * (0.6 + 0.4 * (l / (LEVELS - 1))));
      }
    }

    // Seed: a star each, fading out for the last seconds.
    for (const s of seeds) {
      const sx = Math.round(s.x / u - 0.5);
      const sy = Math.round((s.y - base) / u - 1);
      if (sx < 0 || sy < 0 || sx >= cols || sy >= rows) continue;
      put(sy * cols + sx, dark ? 12 : 8, SEED, smooth((SEED_LIFE - s.age) / 3));
    }

    // Characters are drawn where they really are, between cells.
    const glyph = (gx: number, gy: number, slot: number, a: number, cells: number) => {
      if (slot < 0 || a < 0.02 || gx < -cells || gy < -cells || gx > cols || gy > rows) return;
      ctx.globalAlpha = a;
      ctx.drawImage(atlas, slot * slotPx, 0, slotPx, slotPx, gx * u, gy * u, u * cells, u * cells);
    };
    for (let i = 0; i < liveGlyphs.length; i += 5) {
      glyph(liveGlyphs[i], liveGlyphs[i + 1], liveGlyphs[i + 2], liveGlyphs[i + 3], liveGlyphs[i + 4]);
    }
    for (const m of motes) {
      if (m.life > 0) {
        glyph(m.x / u - m.size / 2, (m.y - base) / u - m.size / 2, m.slot, smooth((m.life / m.max) * 1.6) * 0.8, m.size);
      }
    }
    ctx.globalAlpha = 1;
  }

  /** One finished frame with nothing in motion, for reduced motion. */
  function still() {
    trail.fill(0);
    motes = [];
    for (const c of list) {
      c.form = 1;
      c.delay = 0;
      c.intro = 0;
      c.fade = TEXT_DIM + (1 - TEXT_DIM) * clearOf(c.x, c.y - bodyH() * 0.45, rects, bodyW() * 0.18, u * 5);
      aim(c, c.pose);
    }
    stamp();
    draw(0);
  }

  function frame(now: number) {
    raf = 0;
    // The first frame's timestamp can be earlier than the clock read when the loop started, so
    // never step backwards. A late frame is made up in full, in steps no longer than 1/60 s.
    const dt = Math.max(0, Math.min(0.1, (now - last) / 1000));
    last = now;
    time += dt;
    place();
    for (let left = dt; left > 1e-5; left -= 1 / 60) step(Math.min(left, 1 / 60));
    stamp();
    draw(dt);
    wake();
  }

  function wake() {
    if (raf || reduced || dead || document.hidden) return;
    last = performance.now();
    raf = requestAnimationFrame(frame);
  }

  /** Reduced motion has no loop: a scroll draws the still picture again. */
  function onScroll() {
    if (!reduced || raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      place();
      // Nothing walks over to the reader, so when none of them is in the window any more they are
      // set down again where it is.
      if (!list.some((c) => c.y > scrollY + HEADER && c.y - bodyH() < scrollY + h)) {
        collect();
        spawn(false);
        return still();
      }
      stamp();
      draw(0);
    });
  }

  // ---- the pointer -------------------------------------------------------------------------

  const busy = (t: EventTarget | null) => t instanceof Element && !!t.closest(BUSY);
  const hover = (c: Chicken | null) => {
    if (held) return;
    if (c) root.setAttribute("data-chick-state", "over");
    else root.removeAttribute("data-chick-state");
  };

  const onMove = (e: PointerEvent) => {
    ptr.fine = e.pointerType !== "touch";
    if (!ptr.fine) return;
    ptr.x = e.clientX;
    ptr.y = e.clientY;
    ptr.on = true;
    if (press && !press.drag && press.c && Math.hypot(e.clientX - press.x, e.clientY - press.y) > 6) {
      // Taken: it hangs from the point that was pressed, so it does not jump to the pointer.
      const c = press.c;
      press.drag = true;
      held = c;
      c.held = true;
      c.eat = null;
      c.peck = 0;
      c.panic = 0;
      c.vx = c.vy = 0;
      c.hx = press.x - c.x;
      c.hy = press.y + scrollY - c.y;
      say(c, "!");
      root.setAttribute("data-chick-state", "held");
    }
    if (!press && !held) hover(busy(e.target) ? null : hit(e.clientX, e.clientY, u));
  };
  const onLeave = () => {
    ptr.on = false;
    hover(null);
  };
  const onDown = (e: PointerEvent) => {
    if (reduced || e.button !== 0 || !e.isPrimary || busy(e.target)) return;
    ptr.fine = e.pointerType !== "touch";
    if (ptr.fine) {
      ptr.x = e.clientX;
      ptr.y = e.clientY;
    }
    press = { c: hit(e.clientX, e.clientY, ptr.fine ? u : u * 3), x: e.clientX, y: e.clientY, at: time, drag: false, id: e.pointerId };
  };
  const onUp = (e: PointerEvent) => {
    const p = press;
    press = null;
    if (!p || p.id !== e.pointerId) return;
    if (p.drag) return release();
    if (Math.hypot(e.clientX - p.x, e.clientY - p.y) > 8) return;
    if (p.c) return poke(p.c, e.clientX, e.clientY);
    // A click on bare page feeds them. Not on words, and not at the end of selecting some.
    if (e.target instanceof Element && e.target.closest(WORDS)) return;
    if (window.getSelection()?.toString()) return;
    sow(e.clientX, e.clientY);
  };
  const onCancel = () => {
    press = null;
    if (held) release();
  };
  /** Pressing on a chicken must not start selecting the text underneath it. */
  const onMouseDown = (e: MouseEvent) => {
    if (reduced || e.button !== 0 || busy(e.target)) return;
    if (hit(e.clientX, e.clientY, u)) e.preventDefault();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape" && held) release();
  };

  const sizes = new ResizeObserver(() => {
    collect();
    if (reduced) still();
  });
  sizes.observe(document.body);
  const themes = new MutationObserver(() => {
    readTheme();
    if (reduced) still();
  });
  themes.observe(root, { attributes: true, attributeFilter: ["class"] });
  // A new page, or new content in this one: the boxes of the text are collected again.
  let recollect = 0;
  const pages = new MutationObserver(() => {
    window.clearTimeout(recollect);
    recollect = window.setTimeout(() => {
      collect();
      if (reduced) still();
    }, 250);
  });
  const main = document.querySelector("main");
  pages.observe(main ?? document.body, { childList: true, subtree: true });
  window.addEventListener("resize", measure, { passive: true });
  window.addEventListener("scroll", onScroll, { passive: true });
  if (!reduced) {
    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("pointerdown", onDown, { passive: true });
    window.addEventListener("pointerup", onUp, { passive: true });
    window.addEventListener("pointercancel", onCancel, { passive: true });
    window.addEventListener("mousedown", onMouseDown);
    window.addEventListener("keydown", onKey);
    root.addEventListener("pointerleave", onLeave);
  }
  document.addEventListener("visibilitychange", wake);

  readTheme();
  measure();
  // The text settles after its entrance, and the characters need the site's mono font.
  const settle = [400, 1700].map((ms) =>
    window.setTimeout(() => {
      collect();
      if (reduced) still();
    }, ms)
  );
  void document.fonts?.ready.then(() => {
    if (dead) return;
    buildAtlas();
    collect();
  });
  wake();

  return {
    peek: () => list.flatMap((c) => [c.x / u, c.y / u]),
    destroy() {
      dead = true;
      if (raf) cancelAnimationFrame(raf);
      window.clearTimeout(recollect);
      settle.forEach((t) => window.clearTimeout(t));
      sizes.disconnect();
      themes.disconnect();
      pages.disconnect();
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", onScroll);
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
