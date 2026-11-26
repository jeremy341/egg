/**
 * The chicken of the site: one mascot, fixed to the bottom of the window of every public page.
 *
 * It is drawn as characters on a grid that divides the page's 30px grid (10px cells, 6px on a
 * phone). A body cell is the character for how dense that bit of the chicken is (`.:-=+*#%@`, see
 * RAMP). What keeps it clean, learned from how ascii-animals does it, is that nothing about the
 * picture is left to chance or to the sub-cell position:
 *
 *   Snapped. The body sits on whole cells, so a cell is covered or it is not. It never slides
 *   half across two cells, which is what makes characters flicker as a body moves. It steps from
 *   cell to cell, like a character on a terminal.
 *
 *   Anchored glyphs. Which of the characters a cell shows is worked out once from the cell of the
 *   chicken it belongs to (its shade, and a fixed hash of its place in the sprite), never from
 *   where it is on the screen and never from a per-frame random number. Each character stays
 *   with its part of the body.
 *
 *   Whole poses. One pose is drawn at a time and it changes at a frame boundary. There is no
 *   cross-fade, so there are no ghost legs; the turn is a flip.
 *
 *   Time. Every rate is integrated for the real time that passed, in steps of at most 1/60 s, so
 *   it moves the same at 60, 90 and 120 Hz and catches up after a late frame.
 *
 * The chicken stands on the bottom of the window, not on the page, so it stays there while the
 * page scrolls. It walks along the bottom, comes to the pointer, can be poked, stroked, picked up
 * and thrown (it falls back down), and runs along the bottom for seed dropped with a click.
 *
 * The loop only runs while the tab is visible. With reduced motion it never runs: one still frame
 * is drawn. The canvas is decoration: hidden from assistive technology, never focusable, and it
 * takes no pointer events (the window listens).
 */

import { INK, SHELL, SPECIES } from "./creatures";
import { cellSize, countIndex, coverage, glyphSet, hash, mirror, mixHex, parse, rng, smooth } from "./sim";

interface Seed {
  x: number;
  y: number;
  vy: number;
  /** Where it comes to rest: the floor. */
  land: number;
  age: number;
  claimed: Chicken | null;
}

interface Chicken {
  /** Window coordinates; y is where the feet stand. */
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Where it is walking to along the floor. */
  tx: number;
  face: 1 | -1;
  /** Its own clock, in seconds, started at a random phase. */
  t: number;
  /** Where it is in a wing beat, in poses. */
  beat: number;
  /** Where it is in a hop, 0 to 1. 0: on the ground. */
  hop: number;
  /** The frame it shows now. */
  frame: number;
  seed: number;
  rest: number;
  panic: number;
  /** What is left of a startle push, and for how long it still acts. */
  kx: number;
  ky: number;
  kick: number;
  form: number;
  intro: number;
  lured: boolean;
  /** Where it settles beside the pointer, in cells. */
  ox: number;
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
const INTRO = 2.1;
const FORM = 0.5;
const KICK = 0.14;
const CHEEP = 0.5;
const MAX_MOTES = 120;
const MAX_SEEDS = 10;
const SEED_LIFE = 16;
/** How far above the bottom edge of the window the feet stand, in pixels. */
const FLOOR_PAD = 12;
/** Shades are mapped to colour in quarter steps: 1, 1.25, ... 5. */
const LEVELS = 17;
const EMOTES = "!?~*zo";
/** Body characters, from the faintest to the densest. */
const RAMP = ".:-=+*#%@";
const DOT = 0;
const SEED = RAMP.indexOf("*");
const GLYPHS = glyphSet(S.frames, S.wake + SHELL + EMOTES);
/** The character to draw in place of each one when the chicken faces left. */
const FLIPPED = [...GLYPHS].map((ch) => GLYPHS.indexOf(mirror([ch])[0]));
const SPRITES = S.frames.map((f) => parse(f, SC));
const SW = SPRITES[0].w;
const SH = SPRITES[0].h;
/** The body, in grid cells. */
const BW = SW * SC;
const BH = SH * SC;
const Q = S.seq;

/** A click on one of these belongs to the page, not to the chicken. */
const BUSY = "a, button, input, textarea, select, summary, label, [role='button'], [role='link'], [contenteditable], iframe, video";
/** A click on text is a click on text: it drops no seed. */
const WORDS = "h1, h2, h3, h4, p, li, pre, code, table, blockquote, figure, img, svg";

/** -1, 0 or 1, fixed for a cell of the sprite: it breaks up bands of one character. */
const jitterOf = (x: number, y: number) => Math.floor(hash(x, y, 11) * 3) - 1;

export function createField(canvas: HTMLCanvasElement, reduced: boolean): Field {
  const ctx = canvas.getContext("2d")!;
  const root = document.documentElement;
  const random = rng(20261114);
  const atlas = document.createElement("canvas");
  /** The body characters, once per colour level: drawing a cell of the body is then a blit. */
  const ramp = document.createElement("canvas");

  let w = 0;
  let h = 0;
  let dpr = 1;
  let u = 10; // cell size
  let cols = 0;
  let rows = 0;
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
  let list: Chicken[] = [];
  let motes: Mote[] = [];
  let seeds: Seed[] = [];
  let slotPx = 0;
  let rampPx = 0;
  let time = 0;
  let last = 0;
  let raf = 0;
  let dead = false;
  const ptr = { x: 0, y: 0, on: false, fine: false };
  /** The chicken that is being carried, and the press (a button held on the page) itself. */
  let held: Chicken | null = null;
  let press: { c: Chicken | null; x: number; y: number; drag: boolean; id: number } | null = null;

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
      canvas.height = Math.round(h * dpr);
      cols = Math.ceil(w / u);
      rows = Math.ceil(h / u);
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
    if (regroup || (reduced && resized)) spawn(!reduced);
    else for (const c of list) c.y = floorY();
    if (reduced) still();
  }

  const bodyW = () => BW * u;
  const bodyH = () => BH * u;
  /** The row of the grid the feet stand on, in pixels. */
  const floorY = () => Math.floor((h - FLOOR_PAD) / u) * u;
  /** The nearest place where the sprite sits exactly on the grid. */
  const onGridX = (x: number) => (Math.round(x / u - BW / 2) + BW / 2) * u;
  const margin = () => bodyW() * 0.5;
  const clampX = (x: number) => Math.max(margin(), Math.min(w - margin(), x));

  function spawn(forming: boolean) {
    const n = S.count[countIndex(w)];
    list = [];
    for (let k = 0; k < n; k++) {
      const x = onGridX(clampX(between(w * 0.25, w * 0.75)));
      const face = random() < 0.5 ? 1 : -1;
      const c: Chicken = {
        x,
        y: floorY(),
        vx: 0,
        vy: 0,
        tx: x,
        face,
        t: random() * 20,
        beat: random() * 8,
        hop: 0,
        frame: 0,
        seed: random(),
        rest: between(0.6, 1.5),
        panic: 0,
        kx: 0,
        ky: 0,
        kick: 0,
        form: forming ? 0 : 1,
        intro: forming ? INTRO : 0,
        lured: false,
        ox: (k - (n - 1) / 2) * BW * 0.8 + between(-2, 2),
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
      };
      c.frame = pick(c);
      list.push(c);
    }
    held = null;
    press = null;
    seeds = [];
  }

  /** A new place to walk to along the floor. `how`: 0 not far from here, 1 anywhere, 2 away from the pointer. */
  function retarget(c: Chicken, how: 0 | 1 | 2) {
    let x: number;
    if (how === 0) x = c.x + between(-0.3, 0.3) * w;
    else if (how === 1) x = between(0, w);
    else x = ptr.x < w / 2 ? between(w * 0.6, w) : between(0, w * 0.4);
    c.tx = onGridX(clampX(x));
    // Far enough to be worth the walk.
    if (Math.abs(c.tx - c.x) < bodyW() * 0.4) c.tx = onGridX(clampX(c.x + (c.x < w / 2 ? 1 : -1) * bodyW() * between(0.6, 1.4)));
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

  const flying = (c: Chicken) => c.held || c.panic > 0 || c.y < floorY() - u * 2;
  const at = (seq: readonly number[], p: number) => seq[Math.max(0, Math.min(seq.length - 1, Math.floor(p)))];

  /** The frame to show now. One at a time: the pose changes at a frame boundary, never as a blend. */
  function pick(c: Chicken): number {
    if (c.intro > 0) return at(Q.intro, (1 - c.intro / INTRO) * Q.intro.length);
    if (reduced) return Q.rest[0];
    if (flying(c)) return Q.flap[Math.floor(c.beat) % Q.flap.length];
    if (c.peck > 0) return Math.floor(c.t * 9) % 2 ? Q.rest[0] : Q.move[0];
    if (c.cheep > 0) return at(Q.peep, (1 - c.cheep / CHEEP) * Q.peep.length);
    if (c.hop > 0) return at(Q.hop, c.hop * Q.hop.length);
    const p = (c.t + c.seed * 7) % (c.lured ? 1.5 : 3.8);
    return p < 0.55 ? at(Q.peep, (p / 0.55) * Q.peep.length) : Q.rest[0];
  }

  const bodyAt = (c: Chicken): [number, number, number, number] => [c.x - bodyW() * 0.42, c.y - bodyH() * 0.95, c.x + bodyW() * 0.42, c.y];

  /** The chicken under a point of the window, if any. */
  function hit(x: number, y: number, slack: number): Chicken | null {
    for (const c of list) {
      if (c.intro > 0) continue;
      const [x0, y0, x1, y1] = bodyAt(c);
      if (x >= x0 - slack && x <= x1 + slack && y >= y0 - slack && y <= y1 + slack) return c;
    }
    return null;
  }

  function startle(c: Chicken, fromX: number, power: number) {
    const side = c.x >= fromX ? 1 : -1;
    c.kx = side * u * 62 * power * between(0.8, 1.2);
    c.ky = -u * 52 * power;
    c.kick = KICK;
    c.panic = between(0.7, 1.1) * power;
    c.rest = 0;
    c.eat = null;
    c.peck = 0;
  }

  /** A tap or a click on the chicken: it cheeps and hops. The third in a row sends it off. */
  function poke(c: Chicken, x: number) {
    if (time - c.pokedAt < 0.2) return;
    c.pokes = time - c.pokedAt < 3 ? c.pokes + 1 : 1;
    c.pokedAt = time;
    c.face = x > c.x ? 1 : -1;
    c.rest = 0.6;
    c.eat = null;
    c.peck = 0;
    if (c.pokes >= 3) {
      say(c, "!", 3);
      startle(c, x, 1);
      c.pokes = 0;
      return;
    }
    say(c, c.pokes === 1 ? "!" : "!?");
    c.cheep = CHEEP;
    c.vy = -u * 44;
  }

  /** Seed from a click: it drops from the pointer to the floor. */
  function sow(x: number, y: number) {
    for (let k = 0; k < 3; k++) {
      if (seeds.length >= MAX_SEEDS) seeds.shift()!.claimed = null;
      const sx = Math.max(u, Math.min(w - u, x + (k - 1) * u * 3 + between(-u, u)));
      seeds.push({ x: sx, y: y + k * 2, vy: 0, land: floorY(), age: 0, claimed: null });
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
    c.panic = 0.5;
    c.kick = 0;
    c.pokes = 0;
    say(c, v > u * 12 ? "!" : "~");
    c.rest = 0;
  }

  /** The nearest seed that has landed and that nobody else is running for. */
  function nearestSeed(c: Chicken): Seed | null {
    let best: Seed | null = null;
    let near = Infinity;
    for (const s of seeds) {
      if (s.claimed && s.claimed !== c) continue;
      if (s.y < s.land - 1) continue;
      const d = Math.abs(s.x - c.x);
      if (d < near) {
        near = d;
        best = s;
      }
    }
    if (best) best.claimed = c;
    return best;
  }

  function land(c: Chicken, speed: number) {
    if (speed > u * 14) {
      for (let k = 0; k < 5; k++) mote(c.x + between(-6, 6) * u, c.y - u, ",'.", between(-8, 8) * u, -between(2, 8) * u, 0.5, 1.4);
      c.hop = 0.0001;
      c.rest = Math.max(c.rest, 0.25);
    }
  }

  function step(dt: number) {
    const G = u * 160;
    for (const c of list) {
      c.t += dt;
      if (c.form < 1) c.form = Math.min(1, c.form + dt / FORM);
      c.cheep = Math.max(0, c.cheep - dt);
      c.purr = Math.max(0, c.purr - dt);
      const speed = S.speed * u;
      const floor = floorY();

      if (c.held) {
        // Carried: it hangs from the pointer by the place it was taken, and its speed is what it
        // would be thrown with.
        const gx = ptr.x - c.hx;
        const gy = ptr.y - c.hy;
        const k = ease(28, dt);
        const nx = c.x + (gx - c.x) * k;
        const ny = Math.min(floor, c.y + (gy - c.y) * k);
        const j = ease(14, dt);
        c.vx += ((nx - c.x) / dt - c.vx) * j;
        c.vy += ((ny - c.y) / dt - c.vy) * j;
        c.x = nx;
        c.y = ny;
        c.hop = 0;
        c.rest = 0;
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
          // A startle is a push that builds over a few frames, then drag takes the sideways speed
          // away and gravity brings it back down.
          c.panic -= dt;
          if (c.kick > 0) {
            const part = Math.min(dt, c.kick) / KICK;
            c.vx += c.kx * part;
            c.vy += c.ky * part;
            c.kick -= dt;
          }
          c.vx *= Math.exp(-1.5 * dt);
          c.vy *= Math.exp(-0.4 * dt);
          c.vy += G * dt;
          if (c.panic <= 0 && c.y >= floor - 1) retarget(c, 1);
        } else {
          const air = c.y < floor - 0.5;
          // Seed beats everything but a startle: it runs for the nearest it can have.
          if (!c.eat) c.eat = nearestSeed(c);
          if (c.eat && c.eat.claimed !== c) c.eat = null;
          if (c.eat) {
            c.tx = onGridX(clampX(c.eat.x));
            c.rest = 0;
            c.lured = true;
          } else if (ptr.on && ptr.fine) {
            // Curious: it settles beside the pointer, along the floor.
            c.tx = onGridX(clampX(ptr.x + c.ox * u));
            c.rest = 0;
            c.lured = true;
          }
          const dx = c.tx - c.x;
          const d = Math.abs(dx);
          if (c.peck > 0) {
            // Pecking: it stands and bobs, then the seed is gone.
            c.peck -= dt;
            c.vx *= Math.exp(-12 * dt);
            if (c.peck <= 0 && c.eat) {
              mote(c.eat.x, c.eat.y - u, ",", between(-2, 2) * u, -u * 3, 0.6, 1.2);
              seeds = seeds.filter((s) => s !== c.eat);
              c.eat = null;
              c.rest = between(0.1, 0.5);
              c.hop = 0.0001;
              if (random() < 0.35) say(c, "~");
            }
          } else if (c.eat && d < u * 3 && !air) {
            c.peck = between(0.55, 0.8);
          } else if (c.rest > 0) {
            c.rest -= dt;
            if (c.rest <= 0) retarget(c, 0);
          } else if (!c.lured && d < u * 0.5) {
            c.rest = between(S.rest[0], S.rest[1]);
          }
          let want = 0;
          if (c.peck <= 0 && c.rest <= 0 && d > 0.01) {
            // Slowing into a stop: the last cells are covered ever more slowly, down to nothing.
            const near = Math.min(1, d / (u * 5));
            want = Math.sign(dx) * speed * near * (c.eat ? 1.3 : 1);
          }
          c.vx += (want * (air ? 0.4 : 1) - c.vx) * ease(S.accel, dt);
          if (air) c.vy += G * dt;
        }
        c.x += c.vx * dt;
        c.y += c.vy * dt;
        c.x = Math.max(bodyW() * 0.2, Math.min(w - bodyW() * 0.2, c.x));
        if (c.y >= floor) {
          if (c.vy > 0) land(c, c.vy);
          c.y = floor;
          c.vy = 0;
        }
        c.y = Math.max(bodyH() * 0.95 + 8, c.y);
      }

      // Stroking: the pointer resting on the chicken, not moving off, makes it purr.
      if (!c.held && ptr.on && ptr.fine && !press) {
        const [x0, y0, x1, y1] = bodyAt(c);
        const on = ptr.x >= x0 && ptr.x <= x1 && ptr.y >= y0 && ptr.y <= y1;
        c.over = on ? c.over + dt : 0;
        if (on && c.over > 0.9 && c.purr <= 0 && c.panic <= 0 && c.peck <= 0) {
          c.purr = 1.4;
          c.cheep = CHEEP;
          say(c, "~*");
          c.over = 0.2;
        }
      } else c.over = 0;

      // Which way it faces: where it is going, and a flip is a flip.
      if (c.held) c.face = c.vx > u * 2 ? 1 : c.vx < -u * 2 ? -1 : c.face;
      else if (Math.abs(c.vx) > u * 0.8) c.face = c.vx > 0 ? 1 : -1;
      else if (c.lured && Math.abs(ptr.x - c.x) > u * 2 && !c.eat) c.face = ptr.x > c.x ? 1 : -1;

      // The beat: a hopping chicken takes a whole hop at a time and always lands before it stands.
      c.beat += dt * S.fps * (c.held ? 1.7 : 1);
      const walking = Math.abs(c.vx) > u * 0.6 && !flying(c) && c.intro <= 0 && c.peck <= 0;
      if (walking || c.hop > 0) {
        c.hop += (dt * S.fps) / Q.hop.length;
        if (c.hop >= 1) c.hop = walking ? c.hop - 1 : 0;
      }
      c.frame = pick(c);

      // A little dust behind a quick walk.
      if (walking && Math.abs(c.vx) > speed * 0.6 && random() < dt * 5) {
        mote(c.x - Math.sign(c.vx) * bodyW() * 0.25, c.y - u, S.wake, 0, -u * 1.5, 0.7, SC * 0.5);
      }
    }

    // Seed falls to the floor.
    for (const s of seeds) {
      s.age += dt;
      if (s.y < s.land) {
        s.vy += G * dt;
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
    for (const c of list) {
      const seed = c.seed * 97;
      // A cell appears when the forming chicken reaches it, over a moment, not at once.
      const formed = (lx: number, ly: number) => (c.form >= 1 ? 1 : smooth((c.form * 1.2 - hash(lx, ly, seed)) / 0.2));
      const X = onGridX(c.x) / u;
      const feet = Math.round(c.y / u);
      const lift = Math.sin(Math.PI * smooth((c.hop - 0.12) / 0.72)) * 1.7 * SC;
      const Y = feet - Math.round(lift);
      // A soft shadow on the floor, smaller and fainter the higher it is.
      const up = Math.min(1, (feet - Y + (c.y < floorY() ? (floorY() - c.y) / u : 0)) / (4 * SC));
      const half = Math.round(BW * 0.3 * (1 - up * 0.4));
      const floorRow = Math.round(floorY() / u);
      for (let k = -half; k <= half; k++) splat(X + k - 0.5, floorRow, 1, 0.7 * (1 - up * 0.6), 1);
      // The egg rocks on its base before it cracks. It is the one thing that is not on whole cells.
      const rock = c.intro > INTRO * 0.4 ? Math.sin((INTRO - c.intro) * 9) * 0.05 * smooth((INTRO - c.intro) * 3) : 0;
      const cos = Math.cos(rock);
      const sin = Math.sin(rock);
      const dir = c.face;
      const f = SPRITES[c.frame];
      const cx = BW / 2;
      const cy = BH;
      for (let i = 0; i < f.cells.length; i += 3) {
        const lx = f.cells[i];
        const ly = f.cells[i + 1];
        const ox = (lx + 0.5 - cx) * dir;
        const oy = ly + 0.5 - cy;
        splat(X + ox * cos - oy * sin - 0.5, Y + ox * sin + oy * cos - 0.5, f.cells[i + 2], 1, formed(lx, ly), jitterOf(lx, ly));
      }
      for (let i = 0; i < f.glyphs.length; i += 3) {
        const ox = (f.glyphs[i] * SC + SC / 2 - cx) * dir;
        const oy = f.glyphs[i + 1] * SC + SC / 2 - cy;
        const gx = X + ox * cos - oy * sin - SC / 2;
        const gy = Y + ox * sin + oy * cos - SC / 2;
        const part = formed(f.glyphs[i] * SC, f.glyphs[i + 1] * SC);
        // A character keeps its place clear, so the glow does not sit behind it.
        for (let sa = 0; sa < SC; sa++) for (let sb = 0; sb < SC; sb++) splat(gx + sa, gy + sb, 0, 1, part);
        const slot = GLYPHS.indexOf(String.fromCharCode(f.glyphs[i + 2]));
        liveGlyphs.push(gx, gy, dir < 0 ? FLIPPED[slot] : slot, part * 0.8, SC);
      }
    }

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
      const c = Math.min(1, cover[i]);
      if (c < 0.3) continue;
      const shade = shadeSum[i] / cover[i];
      const level = Math.max(0, Math.min(LEVELS - 1, Math.round((shade - 1) * 4)));
      const tone = 0.25 + 0.75 * ((shade - 1) / 4);
      const g = Math.max(0, Math.min(RAMP.length - 1, Math.floor(c * tone * RAMP.length) + jitter[i]));
      put(i, level, g, Math.min(1, light[i] / cover[i]) * (0.65 + 0.35 * (level / (LEVELS - 1))));
    }

    // Seed: a star each, fading out for the last seconds.
    for (const s of seeds) {
      const sx = Math.round(s.x / u - 0.5);
      const sy = Math.round(s.y / u - 1);
      if (sx < 0 || sy < 0 || sx >= cols || sy >= rows) continue;
      put(sy * cols + sx, dark ? 12 : 9, SEED, smooth((SEED_LIFE - s.age) / 3));
    }

    // Characters are drawn where they are, on whole cells.
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
        // On whole cells too, so a mote steps, it does not blur.
        glyph(Math.round(m.x / u - m.size / 2), Math.round(m.y / u - m.size / 2), m.slot, smooth((m.life / m.max) * 1.6) * 0.8, m.size);
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
      c.intro = 0;
      c.y = floorY();
      c.frame = pick(c);
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
      c.hy = press.y - c.y;
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
    press = { c: hit(e.clientX, e.clientY, ptr.fine ? u : u * 3), x: e.clientX, y: e.clientY, drag: false, id: e.pointerId };
  };
  const onUp = (e: PointerEvent) => {
    const p = press;
    press = null;
    if (!p || p.id !== e.pointerId) return;
    if (p.drag) return release();
    if (Math.hypot(e.clientX - p.x, e.clientY - p.y) > 8) return;
    if (p.c) return poke(p.c, e.clientX);
    // A click on bare page feeds it. Not on words, and not at the end of selecting some.
    if (e.target instanceof Element && e.target.closest(WORDS)) return;
    if (window.getSelection()?.toString()) return;
    sow(e.clientX, e.clientY);
  };
  const onCancel = () => {
    press = null;
    if (held) release();
  };
  /** Pressing on the chicken must not start selecting the text underneath it. */
  const onMouseDown = (e: MouseEvent) => {
    if (reduced || e.button !== 0 || busy(e.target)) return;
    if (hit(e.clientX, e.clientY, u)) e.preventDefault();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape" && held) release();
  };

  const themes = new MutationObserver(() => {
    readTheme();
    if (reduced) still();
  });
  themes.observe(root, { attributes: true, attributeFilter: ["class"] });
  window.addEventListener("resize", measure, { passive: true });
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
  // The characters need the site's mono font.
  void document.fonts?.ready.then(() => {
    if (dead) return;
    buildAtlas();
    if (reduced) still();
  });
  wake();

  return {
    peek: () => list.flatMap((c) => [c.x / u, c.y / u]),
    destroy() {
      dead = true;
      if (raf) cancelAnimationFrame(raf);
      themes.disconnect();
      window.removeEventListener("resize", measure);
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
