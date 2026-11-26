import { describe, expect, it } from "vitest";
import { CHAPTERS, MARK_STATUSES, isChapter, isMarkStatus, parseMarks } from "@/lib/onboarding-marks";

describe("parseMarks", () => {
  it("keeps valid chapters with valid statuses from a JSON string", () => {
    expect(parseMarks('{"connect":"done","import":"skipped","deploy":"paused"}')).toEqual({
      connect: "done",
      import: "skipped",
      deploy: "paused",
    });
  });

  it("accepts an already parsed object", () => {
    expect(parseMarks({ address: "done" })).toEqual({ address: "done" });
  });

  it("drops unknown chapters and unknown statuses", () => {
    expect(parseMarks({ connect: "done", telepathy: "done", import: "started", deploy: 1 })).toEqual({
      connect: "done",
    });
  });

  it("drops chapter names that only differ by case or spacing", () => {
    expect(parseMarks({ Connect: "done", " import": "done" })).toEqual({});
  });

  it("reads arrays, numbers, null and other non-objects as no marks", () => {
    for (const raw of [[], ["connect"], 0, 42, true, null, undefined, "", "null", "42", '"done"', "[]"]) {
      expect(parseMarks(raw), JSON.stringify(raw)).toEqual({});
    }
  });

  it("reads invalid JSON text as no marks", () => {
    expect(parseMarks("{not json")).toEqual({});
    expect(parseMarks('{"connect":"done"')).toEqual({});
  });

  it("returns an object with only the known keys", () => {
    const out = parseMarks({ connect: "done", extra: "done" });
    expect(Object.keys(out)).toEqual(["connect"]);
  });
});

describe("isChapter and isMarkStatus", () => {
  it("accepts every listed chapter and status", () => {
    for (const c of CHAPTERS) expect(isChapter(c)).toBe(true);
    for (const s of MARK_STATUSES) expect(isMarkStatus(s)).toBe(true);
  });

  it("refuses anything else", () => {
    for (const v of ["", "Connect", "connect ", "start", "undefined", null, undefined, 1, {}, ["connect"]]) {
      expect(isChapter(v), JSON.stringify(v)).toBe(false);
    }
    for (const v of ["", "Done", "complete", "started", null, undefined, 1, {}, ["done"]]) {
      expect(isMarkStatus(v), JSON.stringify(v)).toBe(false);
    }
  });

  it("lists the four chapters and three statuses the plan names", () => {
    expect([...CHAPTERS]).toEqual(["connect", "import", "deploy", "address"]);
    expect([...MARK_STATUSES]).toEqual(["done", "skipped", "paused"]);
  });
});
