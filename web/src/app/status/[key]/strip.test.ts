import { describe, expect, it } from "vitest";
import type { StripDay } from "@/server/status-page";
import { STRIP_LEGEND, STRIP_TONE, dayDetail, dayLabel, minutes, stripSummary } from "./strip";

const day = (state: StripDay["state"], downMinutes = 0): StripDay => ({ day: "2026-11-05", state, downMinutes });

describe("status strip text", () => {
  it("describes worker days as running or stopped instead of HTTP answers", () => {
    expect(dayDetail(day("up"), "worker")).toBe("Ran all day");
    expect(dayDetail(day("partial", 12), "worker")).toBe("Stopped for 12 min");
    expect(stripSummary([day("up"), day("down", 800)], 2, "worker")).toBe("Last 2 days: 1 ran all day, 0 stopped for part of the day, 1 stopped for most of the day.");
  });
  it("has a legend entry and a colour for every kind of day", () => {
    expect(STRIP_LEGEND.map((l) => l.state).sort()).toEqual(Object.keys(STRIP_TONE).sort());
  });

  it("labels the day in UTC", () => {
    expect(dayLabel("2026-11-05")).toBe("Nov 5");
  });

  it("formats minutes", () => {
    expect(minutes(45)).toBe("45 min");
    expect(minutes(120)).toBe("2 h");
    expect(minutes(200)).toBe("3 h 20 min");
  });

  it("describes each kind of day", () => {
    expect(dayDetail(day("up"))).toBe("Answered all day");
    expect(dayDetail(day("partial", 12))).toBe("Down for 12 min");
    expect(dayDetail(day("down", 900))).toBe("Down for most of the day, 15 h");
    expect(dayDetail(day("none"))).toBe("No checks yet");
  });

  it("summarises the strip and mentions days without checks only when there are some", () => {
    expect(stripSummary([day("up"), day("up"), day("partial", 5)], 3)).toBe(
      "Last 3 days: 2 answered all day, 1 down for part of the day, 0 down for most of the day."
    );
    expect(stripSummary([day("none"), day("down", 800)], 2)).toBe(
      "Last 2 days: 0 answered all day, 0 down for part of the day, 1 down for most of the day, 1 with no checks yet."
    );
  });
});
