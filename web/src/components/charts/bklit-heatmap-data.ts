import type { HeatmapColumn } from "@/components/charts/bklit/heatmap";
import type { Table } from "@/components/charts/bklit-kit";

/**
 * The shapes behind `BklitHeatmap`, kept apart from the component so a page (a server component)
 * can build the text alternative with them. Nothing here sorts, adds up, smooths or fills in a
 * number: a day or an hour with no reading stays "no reading" and is drawn as nothing, never as 0.
 */

/** One calendar day. `count` null (or a day that is left out) means there was no reading. */
export type HeatmapDay = {
  /** A calendar day, "YYYY-MM-DD". It is a date, not a moment: no time zone moves it. */
  day: string;
  count: number | null;
};

/** One weekday-and-hour cell. A cell that is left out, or has `count` null, has no reading. */
export type HeatmapHourCell = {
  /** 0 to 6, Sunday is 0 (the same as `Date.getDay()` and SQLite `%w`). */
  weekday: number;
  /** 0 to 23. */
  hour: number;
  count: number | null;
};

/** 0 = the week starts on Sunday, 1 = on Monday. */
export type HeatmapWeekStart = 0 | 1;

export const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;
const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

const DAY_MS = 86_400_000;

/** The number of whole days since 1970-01-01 of a valid "YYYY-MM-DD", else null. */
export function dayNumber(day: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const ms = Date.UTC(y, mo - 1, d);
  const back = new Date(ms);
  // Date.UTC rolls 31 February over into March; a real date comes back unchanged.
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) return null;
  return ms / DAY_MS;
}

/** The weekday (0 = Sunday) of a day number. 1970-01-01 was a Thursday. */
function weekdayOf(n: number): number {
  return (((n + 4) % 7) + 7) % 7;
}

/** The day as a Date at local midnight, so the chart's local `getDate()` and `getMonth()` read the same calendar day. */
function localDate(n: number): Date {
  const u = new Date(n * DAY_MS);
  return new Date(u.getUTCFullYear(), u.getUTCMonth(), u.getUTCDate());
}

/** "YYYY-MM-DD" of a day number. */
export function dayString(n: number): string {
  return new Date(n * DAY_MS).toISOString().slice(0, 10);
}

export type CalendarGrid = {
  /** One column per week, each with seven cells indexed by weekday (Sunday 0), as the chart expects. */
  columns: HeatmapColumn[];
  /** The day the first column starts on and the day the last column ends on. */
  firstDay: string;
  lastDay: string;
  /** Rows of the input that were not used: not a real "YYYY-MM-DD", or a day given again later. */
  ignored: number;
};

/**
 * Weeks from the week that holds the earliest day to the week that holds the latest. A cell that
 * is not one of the given days (the rest of the first and last week, or a day left out between)
 * is marked `skip` so the chart draws nothing there. The input order does not matter; a day that
 * appears twice takes the later row.
 */
export function buildCalendarColumns(days: readonly HeatmapDay[], weekStart: HeatmapWeekStart = 1): CalendarGrid | null {
  const byDay = new Map<number, number | null>();
  let ignored = 0;
  for (const d of days) {
    const n = dayNumber(d.day);
    if (n === null || (d.count !== null && !Number.isFinite(d.count))) {
      ignored += 1;
      continue;
    }
    if (byDay.has(n)) ignored += 1;
    byDay.set(n, d.count);
  }
  if (byDay.size === 0) return null;
  const numbers = [...byDay.keys()];
  const min = Math.min(...numbers);
  const max = Math.max(...numbers);
  const start = min - ((weekdayOf(min) - weekStart + 7) % 7);
  const weeks = Math.ceil((max - start + 1) / 7);
  const columns: HeatmapColumn[] = [];
  for (let c = 0; c < weeks; c++) {
    const bins = new Array(7);
    for (let k = 0; k < 7; k++) {
      const n = start + c * 7 + k;
      const w = weekdayOf(n);
      const value = byDay.get(n);
      const has = value !== undefined && value !== null;
      bins[w] = { bin: w, count: has ? value : 0, date: localDate(n), skip: !has };
    }
    columns.push({ bin: c, bins });
  }
  return { columns, firstDay: dayString(min), lastDay: dayString(max), ignored };
}

export type WeekdayHourGrid = {
  /** 24 columns (hours), each with seven cells indexed by weekday (Sunday 0). */
  columns: HeatmapColumn[];
  /** Cells that were not used: weekday or hour out of range, not a whole number, or given twice. */
  ignored: number;
};

/**
 * 24 hour columns by seven weekday rows. The chart's cells carry a date, so each cell gets a
 * fixed reference date (the week of Sunday 7 January 2001, at that hour) that is never shown:
 * the tooltip names the cell from `date.getDay()` and `date.getHours()`.
 */
export function buildWeekdayHourColumns(cells: readonly HeatmapHourCell[]): WeekdayHourGrid | null {
  const byCell = new Map<number, number | null>();
  let ignored = 0;
  for (const c of cells) {
    const ok =
      Number.isInteger(c.weekday) && c.weekday >= 0 && c.weekday <= 6 && Number.isInteger(c.hour) && c.hour >= 0 && c.hour <= 23;
    if (!ok || (c.count !== null && !Number.isFinite(c.count))) {
      ignored += 1;
      continue;
    }
    const key = c.weekday * 24 + c.hour;
    if (byCell.has(key)) ignored += 1;
    byCell.set(key, c.count);
  }
  if (byCell.size === 0) return null;
  const columns: HeatmapColumn[] = [];
  for (let h = 0; h < 24; h++) {
    const bins = new Array(7);
    for (let w = 0; w < 7; w++) {
      const value = byCell.get(w * 24 + h);
      const has = value !== undefined && value !== null;
      bins[w] = { bin: w, count: has ? value : 0, date: new Date(2001, 0, 7 + w, h), skip: !has };
    }
    columns.push({ bin: h, bins });
  }
  return { columns, ignored };
}

/** The highest count that has a reading, or 0. */
export function highestCount(columns: readonly HeatmapColumn[]): number {
  let max = 0;
  for (const col of columns) for (const b of col.bins) if (!b.skip && b.count > max) max = b.count;
  return max;
}

/**
 * Which of the five colour levels a count takes. With `thresholds` (the smallest count of levels
 * 1, 2, 3 and 4, rising) the level is the number of thresholds the count reaches. Without them the
 * range from above zero up to `highest` is cut in four equal steps. Zero is always level 0 and any
 * count above zero is at least level 1, so "some" never looks like "none".
 */
export function levelFunction(
  highest: number,
  thresholds?: readonly [number, number, number, number]
): (count: number) => number {
  if (thresholds) {
    return (count) => {
      if (!(count > 0)) return 0;
      let level = 0;
      for (const t of thresholds) if (count >= t) level += 1;
      return Math.max(1, level);
    };
  }
  return (count) => {
    if (!(count > 0) || !(highest > 0)) return 0;
    return Math.min(4, Math.max(1, Math.ceil((count / highest) * 4)));
  };
}

const number = new Intl.NumberFormat("en");

/** "3 deployments" or "1 deployment". */
export function countLabel(count: number, unit: { one: string; other: string }): string {
  return `${number.format(count)} ${count === 1 ? unit.one : unit.other}`;
}

/** "Monday, 14:00 to 15:00" parts for a cell of the weekday-by-hour grid. */
export function hourCellTitle(weekday: number, hour: number): { title: string; subtitle: string } {
  const pad = (h: number) => String(h).padStart(2, "0");
  return { title: WEEKDAY_NAMES[weekday] ?? "", subtitle: `${pad(hour)}:00 to ${pad((hour + 1) % 24)}:00` };
}

/** The day as people say it: "Thu 12 Nov 2026" (English, the day itself, no time zone). */
export function formatCalendarDay(day: string): string {
  const n = dayNumber(day);
  if (n === null) return day;
  const d = new Date(n * DAY_MS);
  const month = d.toLocaleString("en-GB", { month: "short", timeZone: "UTC" });
  return `${WEEKDAY_SHORT[weekdayOf(n)]} ${d.getUTCDate()} ${month} ${d.getUTCFullYear()}`;
}

/** The text alternative of the calendar: one row per day given, in the order given. */
export function calendarTable(days: readonly HeatmapDay[], caption: string, valueHeader: string): Table {
  return {
    caption,
    headers: ["Day", valueHeader],
    rows: days.map((d) => [formatCalendarDay(d.day), d.count === null ? "No reading" : number.format(d.count)]),
  };
}

/** The text alternative of the weekday-by-hour grid: one row per weekday, one column per hour. */
export function hourGridTable(
  cells: readonly HeatmapHourCell[],
  caption: string,
  weekStart: HeatmapWeekStart = 1
): Table {
  const byCell = new Map<number, number | null>();
  for (const c of cells) byCell.set(c.weekday * 24 + c.hour, c.count);
  const hours = Array.from({ length: 24 }, (_, h) => String(h).padStart(2, "0"));
  const rows: (string | number)[][] = [];
  for (let r = 0; r < 7; r++) {
    const w = (r + weekStart) % 7;
    rows.push([
      WEEKDAY_NAMES[w],
      ...hours.map((_, h) => {
        const v = byCell.get(w * 24 + h);
        return v === undefined || v === null ? "No reading" : number.format(v);
      }),
    ]);
  }
  return { caption, headers: ["Weekday", ...hours], rows };
}
