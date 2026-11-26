import { describe, expect, it } from "vitest";
import { INK, SHADE_ALPHA, SHELL, SPECIES, TEXT_DIM } from "./creatures";
import { blend, contrast, hexToRgb, type RGB } from "./sim";

const HEX = /^#[0-9a-f]{6}$/;
const chick = SPECIES[0];

describe("the chicken", () => {
  it("is the only creature, and it hatches from the egg", () => {
    expect(SPECIES).toHaveLength(1);
    expect(chick.id).toBe("chick");
    expect(chick.seq.intro.length).toBeGreaterThan(0);
  });

  it("has rectangular frames with cells in them", () => {
    expect(chick.frames.length).toBeGreaterThan(0);
    for (const frame of chick.frames) {
      expect(frame.length).toBeGreaterThan(0);
      for (const row of frame) expect(row.length, row).toBe(frame[0].length);
      expect(frame.join("")).toMatch(/[1-5]/);
    }
  });

  it("has a ramp of five colours for both themes", () => {
    for (const theme of ["dark", "light"] as const) {
      expect(chick.ramp[theme]).toHaveLength(5);
      for (const hex of chick.ramp[theme]) expect(hex).toMatch(HEX);
      expect(SHADE_ALPHA[theme]).toHaveLength(5);
    }
  });

  it("has valid motion settings", () => {
    expect(chick.seq.move.length).toBeGreaterThan(0);
    expect(chick.seq.rest.length).toBeGreaterThan(0);
    for (const [name, seq] of Object.entries(chick.seq)) {
      for (const index of seq) expect(chick.frames[index], `${name} frame ${index}`).toBeDefined();
    }
    expect(chick.fps).toBeGreaterThan(0);
    expect(chick.turn).toBeGreaterThanOrEqual(0);
    expect(chick.count).toHaveLength(3);
    expect(chick.count[0]).toBeLessThanOrEqual(chick.count[1]);
    expect(chick.count[1]).toBeLessThanOrEqual(chick.count[2]);
    for (const n of chick.count) expect(n).toBeGreaterThan(0);
    expect(chick.speed).toBeGreaterThan(0);
    expect(chick.accel).toBeGreaterThan(0);
    expect(chick.rest[0]).toBeLessThanOrEqual(chick.rest[1]);
    expect(chick.reach).toBeGreaterThan(0);
    expect(chick.pointer).not.toBe(0);
    expect(chick.wake.length).toBeGreaterThan(0);
    expect(chick.glow).toBeGreaterThanOrEqual(1);
  });

  it("is few and big: a handful on the page, each drawn at least twice the sprite size", () => {
    expect(chick.scale).toBeGreaterThanOrEqual(2);
    expect(chick.count[2]).toBeLessThanOrEqual(4);
  });

  it("gives every action enough poses to read as one movement", () => {
    expect(chick.seq.hop.length).toBeGreaterThanOrEqual(5);
    expect(chick.seq.flap.length).toBeGreaterThanOrEqual(4);
    expect(chick.seq.peep.length).toBeGreaterThanOrEqual(4);
    expect(new Set(chick.seq.intro).size).toBeGreaterThanOrEqual(6);
    // The poses share a width, so every pose is centred on the same cells and a cross-fade
    // between two of them does not shift.
    expect(new Set(chick.frames.map((f) => f[0].length)).size).toBe(1);
  });

  it("draws its beak, legs and shell with keyboard characters", () => {
    expect(/[^.0-5]/.test(chick.frames.flat().join(""))).toBe(true);
    expect(chick.wake.length).toBeGreaterThan(0);
    expect(SHELL.length).toBeGreaterThan(0);
  });
});

/**
 * The text under a chicken. The worst case is the brightest thing the field can draw under the
 * words: a core cell (or a character) at the dimmed strength, on the page colour. The text colours
 * are the tokens in globals.css (--muted-foreground on --background, both themes).
 */
describe("text under a chicken", () => {
  const PAGE = { dark: [10, 10, 10] as RGB, light: [255, 255, 255] as RGB };
  const MUTED = { dark: [161, 161, 161] as RGB, light: [77, 77, 77] as RGB };

  it.each(["dark", "light"] as const)("keeps at least 4.5:1 for the muted text on the %s page", (theme) => {
    let worst = Infinity;
    const under = [...chick.ramp[theme], INK[theme]];
    for (const hex of under) {
      const behind = blend(hexToRgb(hex), PAGE[theme], TEXT_DIM);
      worst = Math.min(worst, contrast(MUTED[theme], behind));
    }
    expect(worst).toBeGreaterThanOrEqual(4.5);
  });
});
