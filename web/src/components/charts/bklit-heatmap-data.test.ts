import { describe, expect, it } from "vitest";
import {
  buildCalendarColumns,
  buildWeekdayHourColumns,
  calendarTable,
  countLabel,
  dayNumber,
  formatCalendarDay,
  highestCount,
  hourCellTitle,
  hourGridTable,
  levelFunction,
} from "./bklit-heatmap-data";

/** The days of one cell column, in the chart's order (Sunday first, as the chart expects). */
const dayStrings = (cols: ReturnType<typeof buildCalendarColumns>) =>
  cols!.columns.map((c) =>
    c.bins.map((b) =>
      b.skip ? "-" : `${b.date.getFullYear()}-${String(b.date.getMonth() + 1).padStart(2, "0")}-${String(b.date.getDate()).padStart(2, "0")}`
    )
  );

describe("dayNumber", () => {
  it("reads real calendar days only", () => {
    expect(dayNumber("1970-01-01")).toBe(0);
    expect(dayNumber("2026-11-12")).not.toBeNull();
    expect(dayNumber("2026-02-30")).toBeNull();
    expect(dayNumber("2026-13-01")).toBeNull();
    expect(dayNumber("12 Nov 2026")).toBeNull();
    expect(dayNumber("2026-11-12T00:00:00Z")).toBeNull();
  });
});

describe("buildCalendarColumns", () => {
  // Thursday 12 November 2026 to Tuesday 17 November.
  const days = [
    { day: "2026-11-12", count: 3 },
    { day: "2026-11-13", count: 0 },
    { day: "2026-11-15", count: 7 },
    { day: "2026-11-17", count: 1 },
  ];

  it("makes one column per week with seven cells indexed by weekday, Sunday first", () => {
    const grid = buildCalendarColumns(days, 1)!;
    expect(grid.columns).toHaveLength(2);
    for (const c of grid.columns) {
      expect(c.bins).toHaveLength(7);
      c.bins.forEach((b, i) => expect(b.date.getDay()).toBe(i));
    }
  });

  it("starts the first week on the week start day, so Monday 9 November opens the grid for a Monday week", () => {
    const grid = buildCalendarColumns(days, 1)!;
    const monday = grid.columns[0].bins[1];
    expect(monday.date.getDate()).toBe(9);
    expect(monday.date.getMonth()).toBe(10);
    // Sunday week: the first column starts on Sunday 8 November.
    const sundayGrid = buildCalendarColumns(days, 0)!;
    expect(sundayGrid.columns[0].bins[0].date.getDate()).toBe(8);
  });

  it("draws only the days it was given: the rest of the first and last week and any day left out are skipped, not zero", () => {
    const grid = buildCalendarColumns(days, 0)!;
    expect(dayStrings(grid)).toEqual([
      ["-", "-", "-", "-", "2026-11-12", "2026-11-13", "-"],
      ["2026-11-15", "-", "2026-11-17", "-", "-", "-", "-"],
    ]);
  });

  it("keeps a real zero as a cell and a missing reading as no cell", () => {
    const grid = buildCalendarColumns([...days, { day: "2026-11-14", count: null }], 0)!;
    const flat = grid.columns.flatMap((c) => c.bins);
    const zero = flat.find((b) => b.date.getDate() === 13)!;
    expect(zero.skip).toBe(false);
    expect(zero.count).toBe(0);
    const gap = flat.find((b) => b.date.getDate() === 14)!;
    expect(gap.skip).toBe(true);
    expect(grid.ignored).toBe(0);
  });

  it("keeps the numbers as given, in the cells that were given", () => {
    const grid = buildCalendarColumns(days, 0)!;
    const given = grid.columns.flatMap((c) => c.bins).filter((b) => !b.skip);
    expect(given.map((b) => b.count)).toEqual([3, 0, 7, 1]);
  });

  it("takes days in any order, and the later row for a day that appears twice", () => {
    const shuffled = [days[3], days[0], { day: "2026-11-12", count: 9 }, days[2], days[1]];
    const grid = buildCalendarColumns(shuffled, 0)!;
    expect(grid.firstDay).toBe("2026-11-12");
    expect(grid.lastDay).toBe("2026-11-17");
    expect(grid.ignored).toBe(1);
    expect(grid.columns.flatMap((c) => c.bins).find((b) => b.date.getDate() === 12)!.count).toBe(9);
  });

  it("counts rows it cannot use", () => {
    const grid = buildCalendarColumns([...days, { day: "soon", count: 1 }, { day: "2026-11-16", count: Number.NaN }], 0)!;
    expect(grid.ignored).toBe(2);
  });

  it("gives a full year as 53 or 54 columns at most and builds the dates in local time, so a day does not move", () => {
    const year: { day: string; count: number }[] = [];
    for (let n = dayNumber("2025-11-13")!; n <= dayNumber("2026-11-12")!; n++) {
      year.push({ day: new Date(n * 86_400_000).toISOString().slice(0, 10), count: n % 5 });
    }
    expect(year).toHaveLength(365);
    const grid = buildCalendarColumns(year, 1)!;
    expect(grid.columns.length).toBeGreaterThanOrEqual(53);
    expect(grid.columns.length).toBeLessThanOrEqual(54);
    const drawn = grid.columns.flatMap((c) => c.bins).filter((b) => !b.skip);
    expect(drawn).toHaveLength(365);
    for (const b of drawn) expect([b.date.getHours(), b.date.getMinutes()]).toEqual([0, 0]);
  });

  it("returns nothing for no days", () => {
    expect(buildCalendarColumns([])).toBeNull();
    expect(buildCalendarColumns([{ day: "nope", count: 1 }])).toBeNull();
  });
});

describe("buildWeekdayHourColumns", () => {
  const cells = [
    { weekday: 1, hour: 9, count: 12 },
    { weekday: 1, hour: 10, count: 0 },
    { weekday: 6, hour: 23, count: 4 },
    { weekday: 0, hour: 0, count: null },
  ];

  it("makes 24 hour columns of seven weekday cells, Sunday first", () => {
    const grid = buildWeekdayHourColumns(cells)!;
    expect(grid.columns).toHaveLength(24);
    for (const [h, col] of grid.columns.entries()) {
      expect(col.bins).toHaveLength(7);
      col.bins.forEach((b, w) => {
        expect(b.date.getDay()).toBe(w);
        expect(b.date.getHours()).toBe(h);
      });
    }
  });

  it("puts each number in its own cell and leaves every other cell skipped, not zero", () => {
    const grid = buildWeekdayHourColumns(cells)!;
    const drawn: [number, number, number][] = [];
    grid.columns.forEach((col, h) =>
      col.bins.forEach((b, w) => {
        if (!b.skip) drawn.push([w, h, b.count]);
      })
    );
    expect(drawn).toEqual([
      [1, 9, 12],
      [1, 10, 0],
      [6, 23, 4],
    ]);
  });

  it("counts cells it cannot use and keeps the later of two for the same cell", () => {
    const grid = buildWeekdayHourColumns([
      ...cells,
      { weekday: 7, hour: 1, count: 1 },
      { weekday: 1, hour: 24, count: 1 },
      { weekday: 1.5, hour: 2, count: 1 },
      { weekday: 1, hour: 9, count: 99 },
    ])!;
    expect(grid.ignored).toBe(4);
    expect(grid.columns[9].bins[1].count).toBe(99);
  });

  it("returns nothing for no cells", () => {
    expect(buildWeekdayHourColumns([])).toBeNull();
  });
});

describe("levelFunction", () => {
  it("cuts the range above zero into four equal steps and never turns some into none", () => {
    const level = levelFunction(40);
    expect([0, 1, 10, 11, 20, 21, 30, 31, 40].map(level)).toEqual([0, 1, 1, 2, 2, 3, 3, 4, 4]);
    expect(level(0.001)).toBe(1);
  });

  it("puts everything on level 0 when nothing is above zero", () => {
    expect([0, 3].map(levelFunction(0))).toEqual([0, 0]);
  });

  it("uses the thresholds given", () => {
    const level = levelFunction(999, [1, 3, 5, 10]);
    expect([0, 1, 2, 3, 4, 5, 9, 10, 500].map(level)).toEqual([0, 1, 1, 2, 2, 3, 3, 4, 4]);
  });

  it("finds the highest count among cells that have a reading", () => {
    const grid = buildCalendarColumns([{ day: "2026-11-12", count: 3 }, { day: "2026-11-13", count: 8 }, { day: "2026-11-14", count: null }], 0)!;
    expect(highestCount(grid.columns)).toBe(8);
  });
});

describe("labels and tables", () => {
  it("writes a count with its unit", () => {
    expect(countLabel(1, { one: "deployment", other: "deployments" })).toBe("1 deployment");
    expect(countLabel(1234, { one: "deployment", other: "deployments" })).toBe("1,234 deployments");
    expect(countLabel(0, { one: "view", other: "views" })).toBe("0 views");
  });

  it("names a weekday-and-hour cell", () => {
    expect(hourCellTitle(1, 14)).toEqual({ title: "Monday", subtitle: "14:00 to 15:00" });
    expect(hourCellTitle(0, 23)).toEqual({ title: "Sunday", subtitle: "23:00 to 00:00" });
  });

  it("writes a day as the day itself", () => {
    expect(formatCalendarDay("2026-11-12")).toBe("Thu 12 Nov 2026");
    expect(formatCalendarDay("soon")).toBe("soon");
  });

  it("lists the days as given, with no reading said as such", () => {
    const table = calendarTable([{ day: "2026-11-13", count: null }, { day: "2026-11-12", count: 3 }], "Deployments per day", "Deployments");
    expect(table.rows).toEqual([
      ["Fri 13 Nov 2026", "No reading"],
      ["Thu 12 Nov 2026", "3"],
    ]);
  });

  it("lists the grid by weekday in the week's order, 24 hours across", () => {
    const table = hourGridTable([{ weekday: 1, hour: 9, count: 12 }, { weekday: 0, hour: 0, count: 5 }], "Views", 1);
    expect(table.headers).toHaveLength(25);
    expect(table.rows).toHaveLength(7);
    expect(table.rows[0][0]).toBe("Monday");
    expect(table.rows[0][10]).toBe("12");
    expect(table.rows[6][0]).toBe("Sunday");
    expect(table.rows[6][1]).toBe("5");
    expect(table.rows[0][1]).toBe("No reading");
  });
});
