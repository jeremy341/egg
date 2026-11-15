import { describe, expect, it } from "vitest";
import { dragonflyPose, INK, SHADE_ALPHA, SHELL, SPECIES, swallowPose, TEXT_DIM } from "./creatures";
import { blend, contrast, hexToRgb, type RGB } from "./sim";

const HEX = /^#[0-9a-f]{6}$/;

describe("creatures", () => {
  it("has five or six, with unique ids and names", () => {
    expect(SPECIES.length).toBeGreaterThanOrEqual(5);
    expect(SPECIES.length).toBeLessThanOrEqual(6);
    expect(new Set(SPECIES.map((s) => s.id)).size).toBe(SPECIES.length);
    expect(new Set(SPECIES.map((s) => s.name)).size).toBe(SPECIES.length);
  });

  it("starts with the chick, which hatches from the egg", () => {
    expect(SPECIES[0].id).toBe("chick");
    expect(SPECIES[0].seq.intro.length).toBeGreaterThan(0);
  });

  it.each(SPECIES.map((s) => [s.id, s] as const))("%s has rectangular frames with cells in them", (_id, s) => {
    expect(s.frames.length).toBeGreaterThan(0);
    for (const frame of s.frames) {
      expect(frame.length).toBeGreaterThan(0);
      for (const row of frame) expect(row.length, row).toBe(frame[0].length);
      expect(frame.join("")).toMatch(/[1-5]/);
    }
  });

  it.each(SPECIES.map((s) => [s.id, s] as const))("%s has a ramp of five colours for both themes", (_id, s) => {
    for (const theme of ["dark", "light"] as const) {
      expect(s.ramp[theme]).toHaveLength(5);
      for (const hex of s.ramp[theme]) expect(hex).toMatch(HEX);
      expect(SHADE_ALPHA[theme]).toHaveLength(5);
    }
  });

  it.each(SPECIES.map((s) => [s.id, s] as const))("%s has valid motion settings", (_id, s) => {
    expect(s.seq.move.length).toBeGreaterThan(0);
    expect(s.seq.rest.length).toBeGreaterThan(0);
    for (const [name, seq] of Object.entries(s.seq)) {
      for (const index of seq) expect(s.frames[index], `${name} frame ${index}`).toBeDefined();
    }
    expect(s.fps).toBeGreaterThan(0);
    expect(s.turn).toBeGreaterThanOrEqual(0);
    expect(s.count).toHaveLength(3);
    expect(s.count[0]).toBeLessThanOrEqual(s.count[1]);
    expect(s.count[1]).toBeLessThanOrEqual(s.count[2]);
    for (const n of s.count) expect(n).toBeGreaterThan(0);
    expect(s.speed).toBeGreaterThan(0);
    expect(s.accel).toBeGreaterThan(0);
    expect(s.rest[0]).toBeLessThanOrEqual(s.rest[1]);
    expect(s.reach).toBeGreaterThan(0);
    expect(s.pointer).not.toBe(0);
    expect(s.wake.length).toBeGreaterThan(0);
    expect(s.glow).toBeGreaterThanOrEqual(1);
  });

  it("gives every action enough poses to read as one movement", () => {
    const by = Object.fromEntries(SPECIES.map((sp) => [sp.id, sp]));
    expect(by.swallow.seq.move.length).toBeGreaterThanOrEqual(6);
    expect(by.dragonfly.seq.move.length).toBeGreaterThanOrEqual(6);
    expect(by.chick.seq.hop.length).toBeGreaterThanOrEqual(5);
    expect(by.chick.seq.flap.length).toBeGreaterThanOrEqual(4);
    expect(by.chick.seq.peep.length).toBeGreaterThanOrEqual(4);
    expect(new Set(by.chick.seq.intro).size).toBeGreaterThanOrEqual(6);
    expect(by.owl.seq.blink.length).toBeGreaterThanOrEqual(3);
    expect(by.owl.seq.look).toHaveLength(2);
    expect(by.owl.seq.move.length).toBeGreaterThanOrEqual(4);
    expect(by.firefly.seq.move.length).toBeGreaterThanOrEqual(4);
    // The chick's poses share a width, and the owl's widths are all odd, so every pose of a
    // creature is centred on the same cells and a cross-fade between two of them does not shift.
    expect(new Set(by.chick.frames.map((f) => f[0].length)).size).toBe(1);
    for (const f of by.owl.frames) expect(f[0].length % 2).toBe(1);
  });

  it("draws wing beats whose neighbouring poses differ, but not by much", () => {
    for (const [pose, n] of [[swallowPose, 8], [dragonflyPose, 6]] as const) {
      for (let k = 0; k < n; k++) {
        const a = pose(k, n).join("");
        const b = pose((k + 1) % n, n).join("");
        let changed = 0;
        for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) changed++;
        expect(changed, `pose ${k}`).toBeGreaterThan(0);
        expect(changed / a.length, `pose ${k}`).toBeLessThan(0.25);
        // The body and its characters never move during a beat.
        expect(a.replace(/[.1-5]/g, "")).toBe(b.replace(/[.1-5]/g, ""));
      }
    }
  });

  it("draws appendages with keyboard characters", () => {
    const withGlyphs = SPECIES.filter((s) => /[^.1-5]/.test(s.frames.flat().join("")) || s.wake.length > 0);
    expect(withGlyphs).toHaveLength(SPECIES.length);
    expect(SHELL.length).toBeGreaterThan(0);
  });
});

/**
 * The hero text over the field. The worst case is the brightest thing the field can draw under
 * the words: a core cell (or a character) at the dimmed strength, on the page colour. The text
 * colours are the tokens in globals.css (--muted-foreground on --background, both themes).
 */
describe("text over the field", () => {
  const PAGE = { dark: [10, 10, 10] as RGB, light: [255, 255, 255] as RGB };
  const MUTED = { dark: [161, 161, 161] as RGB, light: [77, 77, 77] as RGB };

  it.each(["dark", "light"] as const)("keeps at least 4.5:1 for the muted text on the %s page", (theme) => {
    let worst = Infinity;
    const under = [...SPECIES.flatMap((s) => s.ramp[theme]), INK[theme]];
    for (const hex of under) {
      const behind = blend(hexToRgb(hex), PAGE[theme], TEXT_DIM);
      worst = Math.min(worst, contrast(MUTED[theme], behind));
    }
    expect(worst).toBeGreaterThanOrEqual(4.5);
  });
});
