import { describe, expect, it } from "vitest";
import { SPECIES } from "./creatures";
import {
  blend,
  cellSize,
  clearOf,
  contrast,
  countIndex,
  coverage,
  glyphSet,
  hash,
  hexToRgb,
  mirror,
  mixHex,
  parse,
  pickSpot,
  pushOut,
  rng,
  smooth,
  steer,
  type Rect,
} from "./sim";

const TEXT: Rect = { x: 300, y: 200, w: 400, h: 300 };

describe("sprites", () => {
  it("parses cells and characters", () => {
    const s = parse(["1.>", ".5."]);
    expect([s.w, s.h]).toEqual([3, 2]);
    expect([...s.cells]).toEqual([0, 0, 1, 1, 1, 5]);
    expect([...s.glyphs]).toEqual([2, 0, ">".charCodeAt(0)]);
  });

  it("mirrors rows and the characters that lean", () => {
    expect(mirror(["12/>", "L..\\"])).toEqual(["<\\21", "/..J"]);
    for (const s of SPECIES) for (const f of s.frames) expect(mirror(mirror(f))).toEqual([...f]);
  });

  it("collects every character once", () => {
    const set = glyphSet([["1>.", "..L"]], "~>");
    expect([...set].sort().join("")).toBe("<>JL~");
  });
});

describe("randomness", () => {
  it("hash is repeatable and inside 0..1", () => {
    for (let i = 0; i < 200; i++) {
      const v = hash(i, i * 3, 0.37);
      expect(v).toBe(hash(i, i * 3, 0.37));
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it("rng repeats for a seed", () => {
    const a = rng(5);
    const b = rng(5);
    for (let i = 0; i < 20; i++) expect(a()).toBe(b());
  });
});

describe("the grid", () => {
  it("uses cells that divide the 30px page grid", () => {
    for (const width of [320, 390, 639, 640, 768, 1440]) expect(30 % cellSize(width)).toBe(0);
    expect(cellSize(390)).toBeLessThan(cellSize(1440));
  });

  it("picks fewer creatures on narrow screens", () => {
    expect([countIndex(390), countIndex(768), countIndex(1440)]).toEqual([0, 1, 2]);
  });
});

describe("the text zone", () => {
  it("is 0 inside the text and 1 far from it", () => {
    expect(clearOf(500, 350, [TEXT], 10, 40)).toBe(0);
    expect(clearOf(295, 350, [TEXT], 10, 40)).toBe(0);
    expect(clearOf(100, 100, [TEXT], 10, 40)).toBe(1);
    const edge = clearOf(270, 350, [TEXT], 10, 40);
    expect(edge).toBeGreaterThan(0);
    expect(edge).toBeLessThan(1);
    expect(clearOf(500, 350, [], 10, 40)).toBe(1);
  });

  it("pushes out of the nearest edge, and not at all outside", () => {
    expect(pushOut(100, 100, [TEXT], 50)).toEqual([0, 0]);
    const [lx, ly] = pushOut(310, 350, [TEXT], 50);
    expect(lx).toBeLessThan(0);
    expect(ly).toBe(0);
    const [tx, ty] = pushOut(500, 180, [TEXT], 50);
    expect(tx).toBe(0);
    expect(ty).toBeLessThan(0);
    const [, by] = pushOut(500, 520, [TEXT], 50);
    expect(by).toBeGreaterThan(0);
  });

  it("places creatures inside the field, clear of the text and apart", () => {
    const random = rng(1);
    const taken: [number, number][] = [];
    for (let i = 0; i < 6; i++) {
      const [x, y] = pickSpot(random, 1000, 700, [TEXT], 60, taken, 120);
      expect(x).toBeGreaterThanOrEqual(60);
      expect(x).toBeLessThanOrEqual(940);
      expect(y).toBeGreaterThanOrEqual(60);
      expect(y).toBeLessThanOrEqual(640);
      expect(clearOf(x, y, [TEXT], 0, 1)).toBe(1);
      for (const [ox, oy] of taken) expect(Math.hypot(ox - x, oy - y)).toBeGreaterThanOrEqual(120);
      taken.push([x, y]);
    }
  });

  it("still returns a place when the text fills the field", () => {
    const [x, y] = pickSpot(rng(2), 300, 300, [{ x: 0, y: 0, w: 300, h: 300 }], 40, [], 0);
    expect(Number.isFinite(x) && Number.isFinite(y)).toBe(true);
  });
});

describe("colour", () => {
  it("measures contrast like WCAG", () => {
    expect(contrast([0, 0, 0], [255, 255, 255])).toBeCloseTo(21, 5);
    expect(contrast([119, 119, 119], [255, 255, 255])).toBeCloseTo(4.48, 1);
  });

  it("blends and parses", () => {
    expect(hexToRgb("#ff8000")).toEqual([255, 128, 0]);
    expect(blend([255, 255, 255], [0, 0, 0], 0.5)).toEqual([127.5, 127.5, 127.5]);
  });
});

describe("smooth motion", () => {
  it("shares a cell out over four grid cells, and the shares add up to 1", () => {
    for (const [x, y] of [[0, 0], [3.25, 7.5], [-2.9, 4.01], [10.999, -0.5]]) {
      const [col, row, a, b, c, d] = coverage(x, y);
      expect([col, row]).toEqual([Math.floor(x), Math.floor(y)]);
      expect(a + b + c + d).toBeCloseTo(1, 10);
      for (const part of [a, b, c, d]) expect(part).toBeGreaterThanOrEqual(0);
    }
    expect(coverage(4, 9).slice(2)).toEqual([1, 0, 0, 0]);
    const out: number[] = [];
    expect(coverage(1.5, 2.5, out)).toBe(out);
    expect(out).toEqual([1, 2, 0.25, 0.25, 0.25, 0.25]);
  });

  it("moves coverage continuously: a small step changes every share by a small amount", () => {
    // What a grid cell receives from a sprite cell at x, including across a cell boundary.
    const at = (x: number, cell: number) => {
      const [col, , a, b] = coverage(x, 0);
      return cell === col ? a : cell === col + 1 ? b : 0;
    };
    for (let x = 0; x < 3; x += 0.01) {
      for (const cell of [0, 1, 2, 3]) expect(Math.abs(at(x + 0.01, cell) - at(x, cell))).toBeLessThan(0.0101);
    }
  });

  it("eases without a jump at either end", () => {
    expect([smooth(-1), smooth(0), smooth(0.5), smooth(1), smooth(2)]).toEqual([0, 0, 0.5, 1, 1]);
    for (let t = 0; t < 1; t += 0.01) expect(smooth(t + 0.01)).toBeGreaterThanOrEqual(smooth(t));
    expect(smooth(0.01)).toBeLessThan(0.001);
  });

  it("never turns faster than the turn rate, whatever is wished", () => {
    const random = rng(9);
    for (let i = 0; i < 500; i++) {
      const vx = random() * 400 - 200;
      const vy = random() * 400 - 200;
      const dt = 0.001 + random() * 0.05;
      const maxTurn = 0.5 + random() * 9;
      const [nx, ny] = steer(vx, vy, random() * 400 - 200, random() * 400 - 200, maxTurn, 1 + random() * 8, dt);
      let turned = Math.abs(Math.atan2(ny, nx) - Math.atan2(vy, vx));
      if (turned > Math.PI) turned = Math.PI * 2 - turned;
      expect(turned).toBeLessThanOrEqual(maxTurn * dt + 1e-9);
    }
  });

  it("eases the speed, the same over one long step or many short ones", () => {
    let [ax, ay] = steer(100, 0, 300, 0, 3, 2, 0.1);
    expect(ax).toBeGreaterThan(100);
    expect(ax).toBeLessThan(300);
    expect(ay).toBeCloseTo(0, 10);
    let bx = 100;
    let by = 0;
    for (let i = 0; i < 10; i++) [bx, by] = steer(bx, by, 300, 0, 3, 2, 0.01);
    expect(bx).toBeCloseTo(ax, 6);
    // Without a turn rate the velocity slows, stops and reverses: it never flips in one step.
    [ax, ay] = steer(100, 0, -100, 0, 0, 5, 1 / 60);
    expect(ax).toBeGreaterThan(80);
    expect(ax).toBeLessThan(100);
  });

  it("mixes two colours", () => {
    expect(mixHex("#000000", "#ffffff", 0.5)).toBe("rgb(128 128 128)");
    expect(mixHex("#102030", "#ffffff", 0)).toBe("rgb(16 32 48)");
  });
});
