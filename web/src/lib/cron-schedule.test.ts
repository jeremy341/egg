import { describe, expect, it } from "vitest";
import { describeSchedule, nextRun, parseSchedule, toOnCalendar } from "@/lib/cron-schedule";

const calendar = (expr: string) => toOnCalendar(parseSchedule(expr));
const words = (expr: string) => describeSchedule(parseSchedule(expr));
const at = (iso: string) => new Date(iso);

describe("parseSchedule", () => {
  it("reads steps, ranges, lists and plain numbers", () => {
    expect(parseSchedule("*/15 * * * *").minutes).toEqual([0, 15, 30, 45]);
    expect(parseSchedule("0 9-17 * * *").hours).toEqual([9, 10, 11, 12, 13, 14, 15, 16, 17]);
    expect(parseSchedule("5,35 8 * * *").minutes).toEqual([5, 35]);
    expect(parseSchedule("10/20 * * * *").minutes).toEqual([10, 30, 50]);
  });

  it("treats day-of-week 7 as Sunday and every-value fields as unrestricted", () => {
    expect(parseSchedule("0 0 * * 7").weekdays).toEqual([0]);
    expect(parseSchedule("0 0 * * 0-6").weekdays).toEqual([]);
    expect(parseSchedule("0 0 1-31 * *").days).toEqual([]);
  });

  it("accepts the common nicknames", () => {
    expect(parseSchedule("@hourly").expression).toBe("0 * * * *");
    expect(parseSchedule("@daily").hours).toEqual([0]);
    expect(parseSchedule("@weekly").weekdays).toEqual([0]);
    expect(parseSchedule("@monthly").days).toEqual([1]);
  });

  it("collapses extra spaces", () => {
    expect(parseSchedule("  30   3 *  * * ").expression).toBe("30 3 * * *");
  });

  it.each([
    ["", /Enter a schedule/],
    ["* * * *", /five fields/],
    ["* * * * * *", /five fields/],
    ["60 * * * *", /minute field takes 0 to 59/],
    ["0 24 * * *", /hour field takes 0 to 23/],
    ["0 0 0 * *", /day of month field takes 1 to 31/],
    ["0 0 * 13 *", /month field takes 1 to 12/],
    ["0 0 * * 8", /day of week field takes 0 to 7/],
    ["x * * * *", /not a number/],
    ["10-5 * * * *", /counts down/],
    ["*/0 * * * *", /step/],
    ["0,,5 * * * *", /empty item/],
    ["0 0 * * MON", /not a number/],
    ["@reboot", /@hourly/],
    ["0 0 1 * 1", /either the day of the month or the day of the week/],
  ])("refuses %j", (input, message) => {
    expect(() => parseSchedule(input)).toThrow(message);
  });

  it("refuses runs closer together than five minutes", () => {
    expect(() => parseSchedule("* * * * *")).toThrow(/every 1 minute\b/);
    expect(() => parseSchedule("*/2 * * * *")).toThrow(/every 2 minutes/);
    expect(() => parseSchedule("0,3 * * * *")).toThrow(/every 3 minutes/);
    expect(parseSchedule("*/5 * * * *").minutes).toHaveLength(12);
    expect(parseSchedule("0 0,1 * * *").hours).toEqual([0, 1]);
  });

  it("rejects absurd input without hanging", () => {
    expect(() => parseSchedule("0 0 * * * ".repeat(30))).toThrow(/too long/);
    expect(() => parseSchedule("1".repeat(500))).toThrow(/too long/);
  });
});

describe("toOnCalendar", () => {
  it("writes numbers only, in UTC", () => {
    expect(calendar("*/15 * * * *")).toBe("*-*-* 00,01,02,03,04,05,06,07,08,09,10,11,12,13,14,15,16,17,18,19,20,21,22,23:00,15,30,45:00 UTC");
    expect(calendar("30 3 * * *")).toBe("*-*-* 03:30:00 UTC");
    expect(calendar("0 6 * * 1-5")).toBe("Mon,Tue,Wed,Thu,Fri *-*-* 06:00:00 UTC");
    expect(calendar("0 0 1,15 * *")).toBe("*-*-01,15 00:00:00 UTC");
    expect(calendar("0 12 1 1,7 *")).toBe("*-01,07-01 12:00:00 UTC");
  });

  it("never lets anything but digits, commas, day names and fixed words through", () => {
    for (const expr of ["*/10 */3 * * *", "0 0 1-31/5 * *", "0 0 * 2-4 *", "15 4 * * 0,6", "@weekly"]) {
      expect(calendar(expr)).toMatch(/^(?:(?:Sun|Mon|Tue|Wed|Thu|Fri|Sat)(?:,(?:Sun|Mon|Tue|Wed|Thu|Fri|Sat))* )?\*-[\d,*]+-[\d,*]+ [\d,]+:[\d,]+:00 UTC$/);
    }
  });
});

describe("describeSchedule", () => {
  it("puts the common shapes in words", () => {
    expect(words("*/15 * * * *")).toBe("Every 15 minutes");
    expect(words("0 * * * *")).toBe("Every hour");
    expect(words("20 * * * *")).toBe("Every hour at :20");
    expect(words("30 3 * * *")).toBe("Every day at 03:30 UTC");
    expect(words("0 */6 * * *")).toBe("Every 6 hours at :00");
    expect(words("0 9 * * 1")).toBe("Mon at 09:00 UTC");
    expect(words("0 9 * * 1,3,5")).toBe("Mon, Wed, Fri at 09:00 UTC");
    expect(words("0 4 1 * *")).toBe("Day 1 of each month at 04:00 UTC");
  });

  it("falls back to the expression for anything unusual", () => {
    expect(words("5,50 9-11 * * *")).toBe("5,50 9-11 * * * (UTC)");
  });
});

describe("nextRun", () => {
  it("finds the next time today, tomorrow or later", () => {
    const daily = parseSchedule("30 3 * * *");
    expect(nextRun(daily, at("2026-11-13T02:00:00Z"))?.toISOString()).toBe("2026-11-13T03:30:00.000Z");
    expect(nextRun(daily, at("2026-11-13T03:30:00Z"))?.toISOString()).toBe("2026-11-14T03:30:00.000Z");
    expect(nextRun(daily, at("2026-12-31T23:59:59Z"))?.toISOString()).toBe("2027-01-01T03:30:00.000Z");
  });

  it("steps by the interval and skips the current minute", () => {
    const every15 = parseSchedule("*/15 * * * *");
    expect(nextRun(every15, at("2026-11-13T10:07:20Z"))?.toISOString()).toBe("2026-11-13T10:15:00.000Z");
    expect(nextRun(every15, at("2026-11-13T10:15:00Z"))?.toISOString()).toBe("2026-11-13T10:30:00.000Z");
  });

  it("follows weekdays, days of the month and months", () => {
    // 2026-11-13 is a Friday.
    expect(nextRun(parseSchedule("0 9 * * 1"), at("2026-11-13T10:00:00Z"))?.toISOString()).toBe("2026-11-16T09:00:00.000Z");
    expect(nextRun(parseSchedule("0 0 1 * *"), at("2026-11-13T10:00:00Z"))?.toISOString()).toBe("2026-12-01T00:00:00.000Z");
    expect(nextRun(parseSchedule("0 0 1 3 *"), at("2026-11-13T10:00:00Z"))?.toISOString()).toBe("2027-03-01T00:00:00.000Z");
  });

  it("gives up on a date that does not exist", () => {
    expect(nextRun(parseSchedule("0 0 31 2 *"), at("2026-11-13T10:00:00Z"))).toBeNull();
  });
});
