/** Pure helpers of the creature field: sprite parsing, the text zone, placement, colour maths. */

import type { Frame } from "./creatures";

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Sprite {
  w: number;
  h: number;
  /** Cells as x, y, shade triples (finer than the frame when it was parsed with a scale). Shade 0 is a hole: nothing is drawn there, not even the glow. */
  cells: Int16Array;
  /** Characters as x, y, char code triples. */
  glyphs: Int16Array;
}

const SWAP: Record<string, string> = {
  "/": "\\",
  "\\": "/",
  "<": ">",
  ">": "<",
  "(": ")",
  ")": "(",
  L: "J",
  J: "L",
};

/** The same frame facing left: rows reversed, and characters that lean swapped for their twin. */
export function mirror(frame: Frame): string[] {
  return frame.map((row) =>
    [...row]
      .reverse()
      .map((ch) => SWAP[ch] ?? ch)
      .join("")
  );
}

/**
 * The cells of a frame drawn `k` times as large, as x, y, shade triples. For `k` 2 it is Scale2x,
 * the classic pixel-art enlargement: each cell becomes four, and a corner where two neighbours
 * agree and the other two differ takes the neighbour's shade, so the stair-steps of a diagonal
 * edge are cut into half steps and a big body is rounded instead of being a block-for-block
 * magnification. Any other `k` is a plain magnification. Characters (beaks, legs) are not body,
 * and a hole (shade 0) is enlarged and rounded like any shade, so an eye stays an eye.
 */
export function upscale(frame: Frame, k: number): number[] {
  const h = frame.length;
  const w = frame[0].length;
  const at = (x: number, y: number) => {
    const ch = x < 0 || y < 0 || x >= w || y >= h ? "." : frame[y][x];
    return ch >= "0" && ch <= "5" ? ch : ".";
  };
  const cells: number[] = [];
  const put = (x: number, y: number, ch: string) => {
    if (ch !== ".") cells.push(x, y, Number(ch));
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = at(x, y);
      if (k !== 2) {
        for (let b = 0; b < k; b++) for (let a = 0; a < k; a++) put(x * k + a, y * k + b, p);
        continue;
      }
      const up = at(x, y - 1);
      const right = at(x + 1, y);
      const left = at(x - 1, y);
      const down = at(x, y + 1);
      put(x * 2, y * 2, left === up && left !== down && up !== right ? up : p);
      put(x * 2 + 1, y * 2, up === right && up !== left && right !== down ? right : p);
      put(x * 2, y * 2 + 1, down === left && down !== right && left !== up ? left : p);
      put(x * 2 + 1, y * 2 + 1, right === down && right !== up && down !== left ? down : p);
    }
  }
  return cells;
}

/**
 * A frame as cells and characters. With `k` above 1 the cells are `k` times finer (see upscale)
 * while the characters stay where they are, in cells of the original frame, so the field can draw
 * each one `k` cells large.
 */
export function parse(frame: Frame, k = 1): Sprite {
  const cells: number[] = [];
  const glyphs: number[] = [];
  frame.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const ch = row[x];
      if (ch === ".") continue;
      if (ch >= "0" && ch <= "5") {
        if (k === 1) cells.push(x, y, Number(ch));
      } else glyphs.push(x, y, ch.charCodeAt(0));
    }
  });
  if (k > 1) cells.push(...upscale(frame, k));
  return { w: frame[0].length, h: frame.length, cells: Int16Array.from(cells), glyphs: Int16Array.from(glyphs) };
}

/** Every character a set of frames and loose strings can draw, once each. */
export function glyphSet(frames: readonly Frame[], extra: string): string {
  const seen = new Set<string>(extra);
  for (const frame of frames) {
    for (const row of [...frame, ...mirror(frame)]) {
      for (const ch of row) if (ch !== "." && (ch < "0" || ch > "5")) seen.add(ch);
    }
  }
  return [...seen].join("");
}

/** A repeatable 0..1 value for a cell, used to dissolve and re-form creatures cell by cell. */
export function hash(x: number, y: number, seed: number): number {
  let n = (x * 374761393 + y * 668265263 + seed * 2147483647) | 0;
  n = (n ^ (n >>> 13)) * 1274126177;
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}

/** A small seeded random number generator (mulberry32). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Cell size for a hero width. Both divide the page's 30px grid. */
export function cellSize(width: number): number {
  return width < 640 ? 6 : 10;
}

/** Which of a species' three counts applies at a hero width. */
export function countIndex(width: number): 0 | 1 | 2 {
  return width < 640 ? 0 : width < 1024 ? 1 : 2;
}

/**
 * How far outside the text a point is: 0 inside any rectangle grown by `pad`, rising to 1 over
 * the next `soft` pixels. The field dims by it, so nothing bright passes under the words.
 */
export function clearOf(x: number, y: number, rects: readonly Rect[], pad: number, soft: number): number {
  let clear = 1;
  for (const r of rects) {
    const dx = Math.max(r.x - pad - x, 0, x - (r.x + r.w + pad));
    const dy = Math.max(r.y - pad - y, 0, y - (r.y + r.h + pad));
    const d = Math.hypot(dx, dy);
    if (d < soft) clear = Math.min(clear, d / soft);
  }
  return clear;
}

/**
 * The push that keeps a creature out of the text: a unit-or-shorter vector pointing out of the
 * nearest edge of any rectangle (grown by `pad`) the point is inside, longer the deeper it is.
 */
export function pushOut(x: number, y: number, rects: readonly Rect[], pad: number): [number, number] {
  let fx = 0;
  let fy = 0;
  for (const r of rects) {
    const left = x - (r.x - pad);
    const right = r.x + r.w + pad - x;
    const top = y - (r.y - pad);
    const bottom = r.y + r.h + pad - y;
    if (left <= 0 || right <= 0 || top <= 0 || bottom <= 0) continue;
    const depth = Math.min(left, right, top, bottom);
    const force = Math.min(1, depth / pad);
    if (depth === top) fy -= force;
    else if (depth === bottom) fy += force;
    else if (depth === left) fx -= force;
    else fx += force;
  }
  return [fx, fy];
}

/**
 * A place for a creature: inside the field with a margin, clear of the text, and not on top of
 * the places already taken. After a number of tries it takes the best it found.
 */
export function pickSpot(
  random: () => number,
  w: number,
  h: number,
  rects: readonly Rect[],
  margin: number,
  taken: readonly (readonly [number, number])[],
  apart: number
): [number, number] {
  let best: [number, number] = [w / 2, margin];
  let bestScore = -Infinity;
  for (let i = 0; i < 40; i++) {
    const x = margin + random() * Math.max(1, w - margin * 2);
    const y = margin + random() * Math.max(1, h - margin * 2);
    const clear = clearOf(x, y, rects, margin * 0.6, 1);
    let near = Infinity;
    for (const [tx, ty] of taken) near = Math.min(near, Math.hypot(tx - x, ty - y));
    if (clear >= 1 && near >= apart) return [x, y];
    const score = clear * 1e6 + Math.min(near, apart);
    if (score > bestScore) {
      bestScore = score;
      best = [x, y];
    }
  }
  return best;
}

export type RGB = [number, number, number];

export function hexToRgb(hex: string): RGB {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** `top` at opacity `alpha` over `under`. */
export function blend(top: RGB, under: RGB, alpha: number): RGB {
  return [0, 1, 2].map((i) => under[i] + (top[i] - under[i]) * alpha) as RGB;
}

function luminance([r, g, b]: RGB): number {
  const lin = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** WCAG contrast ratio of two colours. */
export function contrast(a: RGB, b: RGB): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** 0 to 1 with no sudden start or stop. */
export function smooth(t: number): number {
  return t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t);
}

/**
 * How a cell at a position between grid cells is shared out. Returns the column and row of the
 * top-left grid cell it touches and its share of that cell, of the one to the right, of the one
 * below and of the one below right. The four shares always add up to 1, so a body that slides
 * across the grid cross-fades from cell to cell and never jumps. Pass `out` to reuse an array.
 */
export function coverage(x: number, y: number, out: number[] = []): number[] {
  const col = Math.floor(x);
  const row = Math.floor(y);
  const fx = x - col;
  const fy = y - row;
  out[0] = col;
  out[1] = row;
  out[2] = (1 - fx) * (1 - fy);
  out[3] = fx * (1 - fy);
  out[4] = (1 - fx) * fy;
  out[5] = fx * fy;
  return out;
}

/**
 * One step of steering. The speed eases towards the wished speed (`rate` per second, correct for
 * any step length), and the heading turns towards the wished heading by at most `maxTurn`
 * radians per second, so a creature banks through a turn. With `maxTurn` 0 there is no heading
 * to keep: the velocity itself eases to the wish, which slows, stops and reverses.
 */
export function steer(
  vx: number,
  vy: number,
  wx: number,
  wy: number,
  maxTurn: number,
  rate: number,
  dt: number
): [number, number] {
  const k = 1 - Math.exp(-rate * dt);
  const v = Math.hypot(vx, vy);
  const wv = Math.hypot(wx, wy);
  if (!maxTurn || v < 1e-3 || wv < 1e-3) return [vx + (wx - vx) * k, vy + (wy - vy) * k];
  const from = Math.atan2(vy, vx);
  let turn = Math.atan2(wy, wx) - from;
  if (turn > Math.PI) turn -= Math.PI * 2;
  if (turn < -Math.PI) turn += Math.PI * 2;
  const most = maxTurn * dt;
  const angle = from + Math.max(-most, Math.min(most, turn));
  const speed = v + (wv - v) * k;
  return [Math.cos(angle) * speed, Math.sin(angle) * speed];
}

/** A colour between two hex colours, as a CSS colour. */
export function mixHex(a: string, b: string, t: number): string {
  const [r, g, bl] = blend(hexToRgb(b), hexToRgb(a), t);
  return `rgb(${Math.round(r)} ${Math.round(g)} ${Math.round(bl)})`;
}
