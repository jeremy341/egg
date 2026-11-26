/**
 * The creature field: one canvas behind the hero.
 *
 * Everything is drawn as cells on a grid that divides the page's 30px grid (10px cells, 6px on a
 * phone), with fillRect only: no blur, no gradient. What makes it move smoothly:
 *
 *   Position. A creature's place is a real number, not a cell. Each cell of its sprite is shared
 *   out over the four grid cells it overlaps, by how much of each it covers (sim.ts `coverage`).
 *   A body therefore slides by cross-fading cells: the leading edge brightens as the trailing
 *   edge dims. At rest a creature sits exactly on the grid and is crisp.
 *
 *   Pose. A creature holds a weight for each of its frames. The weights ease towards the pose
 *   the animation asks for, so every change of frame (a wing beat, a blink, a hop, the hatch) is
 *   a short cross-fade through the same cell blending, never a swap.
 *
 *   Turning. Facing is a number from -1 to 1 that scales the sprite across its width: a turn
 *   narrows the creature to a sliver and opens it again the other way. Fliers also pitch with
 *   their climb, and their heading can only turn so fast, so they bank through curves.
 *
 *   Time. Every rate is integrated for the real time that passed, in steps of at most 1/60 s, so
 *   it moves the same at 60, 90 and 120 Hz and catches up after a late frame.
 *
 * Where a body was, its cells fade out on an exponential curve, and a ring of faint cells around
 * it stands in for a glow. The loop only runs while the hero is on screen and the tab is visible.
 * With reduced motion it never runs: one still frame is drawn, on the grid.
 */

import { INK, SHADE_ALPHA, SHELL, SPECIES, TEXT_DIM, type Species } from "./creatures";
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
  pickSpot,
  pushOut,
  rng,
  smooth,
  steer,
  type Rect,
  type Sprite,
} from "./sim";

interface Creature {
  x: number;
  y: number;
  vx: number;
  vy: number;
  tx: number;
  ty: number;
  face: 1 | -1;
  /** Facing as drawn: it eases from one side to the other through 0 (edge on). */
  dir: number;
  /** Pitch as drawn, in radians. */
  tilt: number;
  /** Its own clock, in seconds, started at a random phase. */
  t: number;
  /** Where it is in its wing beat or wave, in poses. */
  beat: number;
  /** Where it is in a hop, 0 to 1. 0: on the ground. */
  hop: number;
  /** How much of each frame it shows. */
  pose: Float32Array;
  seed: number;
  /** Depth, 0.7 (far: slower and dimmer) to 1. */
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
  spine: Float32Array | null;
}

interface Mote {
  x: number;
  y: number;
  vx: number;
  vy: number;
  slot: number;
  life: number;
  max: number;
}

interface Ghost {
  i: number;
  level: number;
  sp: number;
  a: number;
  die: number;
}

export interface Field {
  /** Show another creature: the old cells dissolve and the new ones form. */
  set(index: number): void;
  /** Whether the hero text is shown. When it is not, the whole field is at full strength. */
  ui(shown: boolean): void;
  /** Send every creature away from a point (viewport coordinates). */
  scatter(clientX: number, clientY: number): void;
  /** True while the hero is on screen. */
  onScreen(): boolean;
  /** Where every creature is, in cells (x, y pairs). For measuring motion. */
  peek(): number[];
  destroy(): void;
}

const PAGE_CELL = 30;
const INTRO = 2.1;
const FORM = 0.5;
const KICK = 0.14;
const MAX_MOTES = 140;
/** Shades are blended in quarter steps: 1, 1.25, ... 5. */
const LEVELS = 17;
const GLYPHS = glyphSet(
  SPECIES.flatMap((s) => s.frames),
  SPECIES.map((s) => s.wake).join("") + SHELL
);
/** The character to draw in place of each one when a creature faces left. */
const FLIPPED = [...GLYPHS].map((ch) => GLYPHS.indexOf(mirror([ch])[0]));
const SPRITES: Sprite[][] = SPECIES.map((s) => s.frames.map((f) => parse(f)));

export function createField(
  canvas: HTMLCanvasElement,
  zones: readonly HTMLElement[],
  start: number,
  reduced: boolean
): Field {
  const ctx = canvas.getContext("2d")!;
  const root = document.documentElement;
  const random = rng(20261114);
  const atlas = document.createElement("canvas");

  let w = 0;
  let h = 0;
  let dpr = 1;
  let u = 10; // cell size
  let inset = 1;
  let cols = 0;
  let rows = 0;
  let trail = new Float32Array(0);
  let trailSp = new Uint8Array(0);
  let att = new Float32Array(0);
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
  const liveGlyphs: number[] = []; // x, y (in cells, fractional), slot, alpha
  const share: number[] = [];
  let rects: Rect[] = [];
  let dark = root.classList.contains("dark");
  let fills: string[][] = [];
  let levelAlpha: number[] = [];
  let cur = start;
  let list: Creature[] = [];
  let motes: Mote[] = [];
  let ghosts: Ghost[] = [];
  let slotPx = 0;
  let time = 0;
  let last = 0;
  let raf = 0;
  let seen = true;
  let uiTarget = 1;
  let uiMix = 1;
  let dead = false;
  const ptr = { x: 0, y: 0, on: false };

  const theme = () => (dark ? "dark" : "light");
  const between = (a: number, b: number) => a + random() * (b - a);
  const ease = (rate: number, dt: number) => 1 - Math.exp(-rate * dt);

  function readTheme() {
    dark = root.classList.contains("dark");
    const t = theme();
    fills = SPECIES.map((s) =>
      Array.from({ length: LEVELS }, (_, l) => {
        const at = Math.min(3, Math.floor(l / 4));
        return mixHex(s.ramp[t][at], s.ramp[t][at + 1], l / 4 - at);
      })
    );
    levelAlpha = Array.from({ length: LEVELS }, (_, l) => {
      const at = Math.min(3, Math.floor(l / 4));
      return SHADE_ALPHA[t][at] + (SHADE_ALPHA[t][at + 1] - SHADE_ALPHA[t][at]) * (l / 4 - at);
    });
    buildAtlas();
  }

  /** Every character once, in the ink colour, at device resolution: drawing one is then a blit. */
  function buildAtlas() {
    slotPx = Math.round(u * dpr);
    atlas.width = slotPx * GLYPHS.length;
    atlas.height = slotPx;
    const a = atlas.getContext("2d")!;
    a.clearRect(0, 0, atlas.width, atlas.height);
    a.fillStyle = INK[theme()];
    a.font = `700 ${Math.round(u * 1.5 * dpr)}px ${getComputedStyle(canvas).fontFamily}`;
    a.textAlign = "center";
    a.textBaseline = "middle";
    for (let i = 0; i < GLYPHS.length; i++) a.fillText(GLYPHS[i], (i + 0.5) * slotPx, slotPx * 0.54);
  }

  function measure() {
    const box = canvas.getBoundingClientRect();
    const nw = Math.max(1, Math.round(box.width));
    const nh = Math.max(1, Math.round(box.height));
    const ndpr = Math.min(window.devicePixelRatio || 1, 2);
    const resized = nw !== w || nh !== h || ndpr !== dpr;
    const regroup = cellSize(nw) !== u || countIndex(nw) !== countIndex(w) || !list.length;
    w = nw;
    h = nh;
    dpr = ndpr;
    u = cellSize(w);
    inset = Math.max(1, Math.round(u * 0.1 * dpr)) / dpr;
    if (resized) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      cols = Math.ceil(w / u);
      rows = Math.ceil(h / u);
      const n = cols * rows;
      trail = new Float32Array(n);
      trailSp = new Uint8Array(n);
      att = new Float32Array(n);
      liveMark = new Uint32Array(n);
      cover = new Float32Array(n);
      light = new Float32Array(n);
      shadeSum = new Float32Array(n);
      clear = new Float32Array(n);
      glow = new Float32Array(n);
      glowMark = new Uint32Array(n);
      buildAtlas();
    }
    rects = zones.map((el) => {
      const r = el.getBoundingClientRect();
      return { x: r.left - box.left, y: r.top - box.top, w: r.width, h: r.height };
    });
    for (let y = 0, i = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++, i++) {
        att[i] = TEXT_DIM + (1 - TEXT_DIM) * clearOf((x + 0.5) * u, (y + 0.5) * u, rects, u * 1.5, u * 4);
      }
    }
    // A still picture is composed for its size, so it is composed again when the size changes.
    if (regroup || (reduced && resized)) spawn(false);
    if (reduced) still();
  }

  /** The rectangles creatures keep out of: the text, while it is shown. */
  const keepOut = () => (uiTarget ? rects : []);
  const line = (y: number) => Math.min(Math.floor((h - 1) / PAGE_CELL), Math.max(5, Math.round(y / PAGE_CELL))) * PAGE_CELL;
  /** The nearest place where the sprite sits exactly on the grid, so a resting creature is crisp. */
  const onGridX = (x: number) => (Math.round(x / u - SPRITES[cur][0].w / 2) + SPRITES[cur][0].w / 2) * u;
  const onGridY = (y: number) =>
    SPECIES[cur].ground ? line(y) : (Math.round(y / u - SPRITES[cur][0].h / 2) + SPRITES[cur][0].h / 2) * u;

  function spawn(forming: boolean) {
    const S = SPECIES[cur];
    const n = S.count[countIndex(w)];
    const taken: [number, number][] = [];
    list = [];
    for (let k = 0; k < n; k++) {
      const [px, py] = pickSpot(random, w, h, keepOut(), u * 7, taken, u * 15);
      const x = onGridX(px);
      const y = onGridY(py);
      taken.push([x, y]);
      const face = random() < 0.5 ? 1 : -1;
      const c: Creature = {
        x,
        y,
        vx: 0,
        vy: 0,
        tx: x,
        ty: y,
        face,
        dir: face,
        tilt: 0,
        t: random() * 20,
        beat: random() * 8,
        hop: 0,
        pose: new Float32Array(S.frames.length),
        seed: random(),
        z: between(0.7, 1),
        rest: between(0.2, 1.5),
        panic: 0,
        kx: 0,
        ky: 0,
        kick: 0,
        form: forming ? 0 : 1,
        delay: forming ? k * 0.07 + random() * 0.1 : 0,
        intro: forming && S.seq.intro ? INTRO : 0,
        lured: false,
        wake: 0,
        ox: between(-8, 8),
        oy: between(-5, 5),
        spine: null,
      };
      if (S.mode === "swim") {
        // Points half a cell apart, laid out behind the head along a gentle curve.
        const len = S.frames[0].length * 2 - 1;
        const angle = random() * Math.PI * 2;
        c.spine = new Float32Array(len * 2);
        for (let i = 0; i < len; i++) {
          const bend = angle + Math.sin(i * 0.25 + c.seed * 6) * 0.35;
          c.spine[i * 2] = i ? c.spine[i * 2 - 2] - (Math.cos(bend) * u) / 2 : x;
          c.spine[i * 2 + 1] = i ? c.spine[i * 2 - 1] - (Math.sin(bend) * u) / 2 : y;
        }
        c.vx = Math.cos(angle) * S.speed * u;
        c.vy = Math.sin(angle) * S.speed * u;
      }
      aim(S, c, c.pose);
      list.push(c);
    }
  }

  /** A new place to go. `how`: 0 the nearest of three, 1 anywhere, 2 the farthest from the pointer. */
  function retarget(c: Creature, how: 0 | 1 | 2) {
    let best: [number, number] | null = null;
    let score = -Infinity;
    for (let k = how === 1 ? 1 : 3; k > 0; k--) {
      const p = pickSpot(random, w, h, keepOut(), u * 6, [], 0);
      const s = how === 2 ? Math.hypot(p[0] - ptr.x, p[1] - ptr.y) : -Math.hypot(p[0] - c.x, p[1] - c.y);
      if (s > score) {
        score = s;
        best = p;
      }
    }
    c.tx = onGridX(best![0]);
    c.ty = onGridY(best![1]);
  }

  function mote(x: number, y: number, chars: string, vx: number, vy: number, life: number) {
    if (motes.length >= MAX_MOTES) motes.shift();
    const ch = chars[Math.floor(random() * chars.length)];
    motes.push({ x, y, vx, vy, slot: GLYPHS.indexOf(ch), life, max: life });
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

  const flying = (c: Creature) => c.panic > 0 || Math.abs(c.vy) > u * 2;

  /** The pose the creature should be in now, as weights over its frames (they add up to 1). */
  function aim(S: Species, c: Creature, out: Float32Array) {
    out.fill(0);
    const q = S.seq;
    if (c.intro > 0) return along(out, q.intro, (1 - c.intro / INTRO) * (q.intro.length - 1), false);
    const v = Math.hypot(c.vx, c.vy);
    switch (S.mode) {
      case "hop": {
        if (!reduced && flying(c)) return along(out, q.flap, c.beat, true);
        if (c.hop > 0) return along(out, q.hop, c.hop * (q.hop.length - 1), false);
        const p = (c.t + c.seed * 7) % (c.lured ? 1.5 : 3.8);
        return along(out, p < 0.55 && !reduced ? q.peep : q.rest, (p / 0.55) * (q.peep.length - 1), false);
      }
      case "perch": {
        if (!reduced && v > u * 0.9) return along(out, v < u * 3 ? q.crouch : q.move, v < u * 3 ? 0 : c.beat, true);
        // Awake to the pointer: wide eyes when it is near, and a look towards it when it is closer.
        const px = ptr.x - c.x;
        const pd = ptr.on ? Math.hypot(px, ptr.y - c.y) : Infinity;
        const base = pd < S.reach * u * 1.8 ? q.look[px * c.face > 0 ? 1 : 0] : pd < S.reach * u * 3 ? q.alert[0] : q.rest[0];
        const b = (c.t + c.seed * 9) % 3.7;
        if (b < 0.32 && !reduced) return along(out, [base, ...q.blink, base], (b / 0.32) * (q.blink.length + 1), false);
        out[base] = 1;
        return;
      }
      default:
        return along(out, v > u * 0.9 ? q.move : q.rest, reduced ? Math.floor(c.seed * 8) : c.beat, true);
    }
  }

  function step(dt: number) {
    const S = SPECIES[cur];
    uiMix += (uiTarget - uiMix) * ease(6, dt);

    for (const c of list) {
      c.t += dt;
      if (c.delay > 0) {
        c.delay -= dt;
        continue;
      }
      if (c.form < 1) c.form = Math.min(1, c.form + dt / FORM);
      if (c.intro > 0) {
        c.intro -= dt;
        if (c.intro <= 0) {
          // Hatched: bits of shell fly off.
          for (let k = 0; k < 6; k++) {
            mote(c.x + between(-4, 4) * u, c.y - between(2, 10) * u, SHELL, between(-5, 5) * u, between(-5, 1) * u, 0.9);
          }
        }
      } else {
        const speed = S.speed * u * c.z;
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
          if (ptr.on) {
            const px = ptr.x - c.x;
            const py = ptr.y - c.y;
            const pd = Math.hypot(px, py) || 1;
            const reach = S.reach * u;
            if (pd < reach) {
              if (S.pointer > 0) {
                // Curious: it settles at its own spot around the pointer.
                c.tx = onGridX(ptr.x + c.ox * u);
                c.ty = onGridY(ptr.y + c.oy * u);
                c.rest = 0;
                c.lured = true;
              } else {
                // Shy: pushed away in flight, and it leaves its perch when the pointer comes close.
                const k = smooth(1 - pd / reach);
                wx -= (px / pd) * speed * 1.8 * k;
                wy -= (py / pd) * speed * 1.8 * k;
                if (c.rest > 0 && pd < reach * 0.7) {
                  c.rest = 0;
                  retarget(c, 2);
                }
              }
            }
          }
          const dx = c.tx - c.x;
          const dy = c.ty - c.y;
          const d = Math.hypot(dx, dy);
          const stops = S.rest[1] > 0;
          if (c.rest > 0) {
            c.rest -= dt;
            if (c.rest <= 0) retarget(c, 0);
          } else if (!c.lured && d < u * (stops ? 0.5 : 1.5)) {
            if (stops) c.rest = between(S.rest[0], S.rest[1]);
            else retarget(c, S.mode === "fly" ? 1 : 0);
          }
          if (d > 0.01) {
            // Slowing into a stop: the last cells are covered ever more slowly, down to nothing.
            const slows = stops || (c.lured && S.mode !== "swim");
            const near = slows ? Math.min(1, d / (u * 3)) : 1;
            wx += (dx / d) * speed * near;
            wy += (dy / d) * speed * near;
          }
          if (S.mode === "pulse") {
            wx += Math.sin(c.t * 1.3 + c.seed * 9) * speed * 0.7;
            wy += Math.cos(c.t * 1.1 + c.seed * 5) * speed * 0.7;
          }
          if (uiTarget && c.rest <= 0) {
            const [fx, fy] = pushOut(c.x, c.y, rects, u * 5);
            wx += fx * speed * 1.5;
            wy += fy * speed * 1.5;
          }
          [c.vx, c.vy] = steer(c.vx, c.vy, wx, wy, S.turn, S.accel, dt);
        }
        c.x += c.vx * dt;
        c.y += c.vy * dt;
      }

      const v = Math.hypot(c.vx, c.vy);
      if (Math.abs(c.vx) > u * 0.8) c.face = c.vx > 0 ? 1 : -1;
      else if (c.lured && Math.abs(ptr.x - c.x) > u * 2) c.face = ptr.x > c.x ? 1 : -1;
      c.dir += (c.face - c.dir) * ease(S.mode === "swim" ? 0 : 10, dt);
      const pitches = S.mode === "fly" || S.mode === "dart";
      const pitch = pitches && v > u ? Math.max(-0.5, Math.min(0.5, Math.atan2(c.vy, Math.abs(c.vx) + 1) * 0.7)) : 0;
      c.tilt += (pitch - c.tilt) * ease(5, dt);

      // The beat: a swallow works its wings harder when it climbs, a hopping chick takes a
      // whole hop at a time and always lands before it stands.
      const climb = v > 1 ? Math.max(0, -c.vy / v) : 0;
      c.beat += dt * (S.mode === "fly" ? S.fps * (0.5 + 0.8 * climb + (c.panic > 0 ? 0.4 : 0)) : S.mode === "swim" ? 2 + (v / u) * 0.5 : S.fps);
      if (S.mode === "hop") {
        const walking = v > u * 0.6 && !flying(c) && c.intro <= 0;
        if (walking || c.hop > 0) {
          c.hop += (dt * S.fps) / S.seq.hop.length;
          if (c.hop >= 1) c.hop = walking ? c.hop - 1 : 0;
        }
      }
      const want = aimed;
      aim(S, c, want);
      const k = ease(22, dt);
      for (let f = 0; f < want.length; f++) c.pose[f] += (want[f] - c.pose[f]) * k;

      if (c.spine) {
        const sp = c.spine;
        sp[0] = c.x;
        sp[1] = c.y;
        for (let i = 2; i < sp.length; i += 2) {
          const ex = sp[i] - sp[i - 2];
          const ey = sp[i + 1] - sp[i - 1];
          const e = Math.hypot(ex, ey) || 1;
          sp[i] = sp[i - 2] + ((ex / e) * u) / 2;
          sp[i + 1] = sp[i - 1] + ((ey / e) * u) / 2;
        }
      }

      c.wake += v * dt;
      if (c.wake > u * (S.mode === "swim" ? 6 : 3.5) && v > u) {
        c.wake = 0;
        const back = S.mode === "pulse" ? 1 : 6;
        const rises = S.mode === "swim" || S.mode === "pulse" ? -0.7 * u : 0;
        const tx = c.spine ? c.spine[c.spine.length - 2] : c.x - (c.vx / v) * back * u;
        const ty = c.spine ? c.spine[c.spine.length - 1] : S.ground ? c.y - u * (c.panic > 0 ? 4 : 0.5) : c.y - (c.vy / v) * back * u;
        mote(tx, ty, S.wake, 0, rises, 1.5);
      }
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
  let aimed = new Float32Array(0);

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
    const S = SPECIES[cur];
    mark++;
    touched.length = 0;
    glowing.length = 0;
    liveGlyphs.length = 0;
    for (const bucket of buckets) bucket.length = 0;
    for (const c of list) {
      if (c.delay > 0) continue;
      const depth = 0.84 + 0.16 * ((c.z - 0.7) / 0.3);
      const pulse = S.mode === "pulse" && !reduced ? 0.4 + 0.6 * (0.5 + 0.5 * Math.sin(c.t * 2.2 + c.seed * 40)) ** 2 : 1;
      const a = depth * pulse;
      const seed = c.seed * 97;
      // A cell appears when the forming creature reaches it, over a moment, not at once.
      const formed = (lx: number, ly: number) => (c.form >= 1 ? 1 : smooth((c.form * 1.2 - hash(lx, ly, seed)) / 0.2));

      if (c.spine) {
        const body = S.frames[0];
        const sp = c.spine;
        const last = sp.length / 2 - 1;
        for (let j = 0; j <= last; j++) {
          const before = Math.max(0, j - 1);
          const after = Math.min(last, j + 1);
          let nx = sp[before * 2] - sp[after * 2];
          let ny = sp[before * 2 + 1] - sp[after * 2 + 1];
          const n = Math.hypot(nx, ny) || 1;
          nx /= n;
          ny /= n;
          // A wave runs down the body: the tail sweeps wide, the head barely moves.
          const sway = reduced ? 0 : Math.sin(c.beat * 2.4 - j * 0.3) * u * 1.1 * (j / last) ** 2;
          // Two points per body slice, so each carries half; a point between slices shows both.
          for (const r of j & 1 ? [(j - 1) / 2, (j + 1) / 2] : [j / 2]) {
            const row = body[r];
            for (let k = -2; k <= 2; k++) {
              const ch = row[k + 2];
              if (ch === ".") continue;
              const off = k * u + sway;
              const part = (j & 1 ? 0.25 : 0.5) * formed(k, r);
              splat((sp[j * 2] - ny * off) / u - 0.5, (sp[j * 2 + 1] + nx * off) / u - 0.5, Number(ch), a, part);
            }
          }
        }
        continue;
      }

      const X = c.x / u;
      let Y = c.y / u;
      if (S.mode === "hop") Y -= Math.sin(Math.PI * smooth((c.hop - 0.12) / 0.72)) * 1.7;
      else if (!S.ground && S.mode !== "fly" && !reduced) Y += Math.sin(c.t * 1.7 + c.seed * 6) * 0.7;
      // The egg rocks on its base before it cracks.
      const rock = c.intro > INTRO * 0.4 ? Math.sin((INTRO - c.intro) * 9) * 0.05 * smooth((INTRO - c.intro) * 3) : 0;
      const angle = (reduced ? 0 : c.tilt) * (c.dir < 0 ? -1 : 1) + rock;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      const dir = reduced ? c.face : c.dir;
      for (let index = 0; index < c.pose.length; index++) {
        const weight = c.pose[index];
        if (weight < 0.02) continue;
        const f = SPRITES[cur][index];
        const cx = f.w / 2;
        const cy = S.ground ? f.h : f.h / 2;
        for (let i = 0; i < f.cells.length; i += 3) {
          const ox = (f.cells[i] + 0.5 - cx) * dir;
          const oy = f.cells[i + 1] + 0.5 - cy;
          splat(X + ox * cos - oy * sin - 0.5, Y + ox * sin + oy * cos - 0.5, f.cells[i + 2], a, weight * formed(f.cells[i], f.cells[i + 1]));
        }
        for (let i = 0; i < f.glyphs.length; i += 3) {
          const ox = (f.glyphs[i] + 0.5 - cx) * dir;
          const oy = f.glyphs[i + 1] + 0.5 - cy;
          const gx = X + ox * cos - oy * sin - 0.5;
          const gy = Y + ox * sin + oy * cos - 0.5;
          const part = weight * formed(f.glyphs[i], f.glyphs[i + 1]) * Math.min(1, Math.abs(dir) * 2.5);
          // A character keeps its place clear, so the glow does not sit behind it.
          splat(gx, gy, 0, a, part);
          const slot = GLYPHS.indexOf(String.fromCharCode(f.glyphs[i + 2]));
          liveGlyphs.push(gx, gy, dir < 0 ? FLIPPED[slot] : slot, (0.55 + 0.45 * a) * part);
        }
      }
    }

    // Each covered cell is sorted by its blended shade, leaves itself in the trail (the wake
    // that fades behind a moving creature) and lights a ring of faint cells around it (the glow).
    const R = S.glow;
    const own = dark ? 0.32 : 0.28;
    const halo = dark ? 0.16 : 0.11;
    for (const i of touched) {
      if (cover[i] < 0.01) continue;
      const shade = shadeSum[i] / cover[i];
      const a = Math.min(1, light[i]);
      buckets[Math.max(0, Math.min(LEVELS - 1, Math.round((shade - 1) * 4)))].push(i);
      const x = i % cols;
      const y = (i - x) / cols;
      // Only the core leaves a wake, so a fast creature draws a streak and not a smear.
      const left = own * a * (shade / 5) * smooth(shade - 2);
      if (trail[i] < left) {
        trail[i] = left;
        trailSp[i] = cur;
      }
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
    const size = u - inset * 2;
    const keep = dt ? Math.exp(-dt / 0.42) : 1;
    const shown = (i: number) => 1 - (1 - att[i]) * uiMix;
    /** How much of a cell is not covered by a body, an eye or a character this frame. */
    const open = (i: number) => (liveMark[i] === mark ? Math.max(0, 1 - cover[i] - clear[i]) : 1);
    const cell = (i: number) => {
      const x = i % cols;
      ctx.fillRect(x * u + inset, ((i - x) / cols) * u + inset, size, size);
    };
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    // The trail: one colour per creature, usually one creature. It fades on a smooth curve.
    let sp = -1;
    for (let i = 0, n = cols * rows; i < n; i++) {
      const a = trail[i] * keep;
      trail[i] = a;
      if (a < 0.008 || (glowMark[i] === mark && glow[i] >= a)) continue;
      const alpha = a * open(i) * shown(i);
      if (alpha < 0.004) continue;
      if (trailSp[i] !== sp) {
        sp = trailSp[i];
        ctx.fillStyle = fills[sp][dark ? 8 : 4];
      }
      ctx.globalAlpha = alpha;
      cell(i);
    }

    // The glow.
    ctx.fillStyle = fills[cur][dark ? 8 : 4];
    for (const i of glowing) {
      if (trail[i] > glow[i]) continue;
      const alpha = glow[i] * open(i) * shown(i);
      if (alpha < 0.004) continue;
      ctx.globalAlpha = alpha;
      cell(i);
    }

    // The bodies, one blended shade at a time.
    for (let l = 0; l < LEVELS; l++) {
      if (!buckets[l].length) continue;
      ctx.fillStyle = fills[cur][l];
      for (const i of buckets[l]) {
        ctx.globalAlpha = levelAlpha[l] * Math.min(1, light[i]) * shown(i);
        cell(i);
      }
    }

    // Cells of the creature that was just switched away: each fades out in its own time.
    if (ghosts.length) {
      ghosts = ghosts.filter((g) => g.die > time);
      for (const g of ghosts) {
        ctx.fillStyle = fills[g.sp][g.level];
        ctx.globalAlpha = levelAlpha[g.level] * g.a * smooth((g.die - time) / 0.22) * open(g.i) * shown(g.i);
        cell(g.i);
      }
    }

    // Characters are drawn where they really are, between cells.
    const glyph = (gx: number, gy: number, slot: number, a: number) => {
      const cx = Math.round(gx);
      const cy = Math.round(gy);
      if (cx < 0 || cy < 0 || cx >= cols || cy >= rows || slot < 0 || a < 0.02) return;
      ctx.globalAlpha = a * shown(cy * cols + cx);
      ctx.drawImage(atlas, slot * slotPx, 0, slotPx, slotPx, gx * u, gy * u, u, u);
    };
    for (let i = 0; i < liveGlyphs.length; i += 4) glyph(liveGlyphs[i], liveGlyphs[i + 1], liveGlyphs[i + 2], liveGlyphs[i + 3]);
    for (const m of motes) {
      if (m.life > 0) glyph(m.x / u - 0.5, m.y / u - 0.5, m.slot, smooth((m.life / m.max) * 1.6) * 0.75);
    }
    ctx.globalAlpha = 1;
  }

  /** One finished frame with nothing in motion, for reduced motion. */
  function still() {
    trail.fill(0);
    motes = [];
    ghosts = [];
    uiMix = uiTarget;
    for (const c of list) {
      c.form = 1;
      c.delay = 0;
      c.intro = 0;
      aim(SPECIES[cur], c, c.pose);
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
    if (aimed.length !== SPECIES[cur].frames.length) aimed = new Float32Array(SPECIES[cur].frames.length);
    for (let left = dt; left > 1e-5; left -= 1 / 60) step(Math.min(left, 1 / 60));
    stamp();
    draw(dt);
    wake();
  }

  function wake() {
    if (raf || reduced || dead || !seen || document.hidden) return;
    last = performance.now();
    raf = requestAnimationFrame(frame);
  }

  const onMove = (e: PointerEvent) => {
    if (e.pointerType === "touch") return;
    const box = canvas.getBoundingClientRect();
    ptr.x = e.clientX - box.left;
    ptr.y = e.clientY - box.top;
    ptr.on = ptr.x >= 0 && ptr.y >= 0 && ptr.x <= box.width && ptr.y <= box.height;
  };
  const onLeave = () => {
    ptr.on = false;
  };

  const sizes = new ResizeObserver(measure);
  sizes.observe(canvas);
  const views = new IntersectionObserver(([entry]) => {
    seen = entry.isIntersecting;
    wake();
  });
  views.observe(canvas);
  const themes = new MutationObserver(() => {
    readTheme();
    if (reduced) still();
  });
  themes.observe(root, { attributes: true, attributeFilter: ["class"] });
  window.addEventListener("pointermove", onMove, { passive: true });
  root.addEventListener("pointerleave", onLeave);
  document.addEventListener("visibilitychange", wake);

  readTheme();
  measure();
  if (!reduced) spawn(true);
  // The text settles after its entrance, and the characters need the site's mono font.
  const settle = window.setTimeout(measure, 1700);
  void document.fonts?.ready.then(() => {
    if (dead) return;
    buildAtlas();
    measure();
  });
  wake();

  return {
    set(index) {
      if (index === cur || !SPECIES[index]) return;
      if (reduced) {
        cur = index;
        spawn(false);
        still();
        return;
      }
      buckets.forEach((bucket, level) => {
        for (const i of bucket) {
          ghosts.push({ i, level, sp: cur, a: Math.min(1, light[i]), die: time + 0.2 + random() * 0.4 });
        }
        bucket.length = 0;
      });
      touched.length = 0;
      motes = [];
      cur = index;
      spawn(true);
    },
    ui(shown) {
      uiTarget = shown ? 1 : 0;
      if (reduced) still();
      else for (const c of list) if (c.panic <= 0 && c.rest <= 0) retarget(c, 0);
    },
    scatter(clientX, clientY) {
      if (reduced) return;
      const box = canvas.getBoundingClientRect();
      const x = clientX - box.left;
      const y = clientY - box.top;
      for (const c of list) {
        if (c.intro > 0 || c.delay > 0) continue;
        let dx = c.x - x;
        let dy = c.y - y;
        const d = Math.hypot(dx, dy);
        if (d < 1) {
          dx = random() - 0.5;
          dy = random() - 0.5;
        }
        const n = Math.hypot(dx, dy);
        const push = u * 62 * (0.4 + 0.6 * Math.exp(-d / (u * 40))) * between(0.8, 1.2);
        c.kx = (dx / n) * push;
        c.ky = (dy / n) * push;
        c.kick = KICK;
        c.panic = between(0.8, 1.3);
        c.rest = 0;
      }
    },
    onScreen: () => seen,
    peek: () => list.flatMap((c) => [c.x / u, c.y / u]),
    destroy() {
      dead = true;
      if (raf) cancelAnimationFrame(raf);
      window.clearTimeout(settle);
      sizes.disconnect();
      views.disconnect();
      themes.disconnect();
      window.removeEventListener("pointermove", onMove);
      root.removeEventListener("pointerleave", onLeave);
      document.removeEventListener("visibilitychange", wake);
    },
  };
}
