/**
 * Cron-style schedules for jobs that run on the user's container.
 *
 * People write the five-field form they already know ("*\/15 * * * *"). On the
 * container a systemd timer runs it, so the schedule is turned into an
 * OnCalendar line. Every field is expanded into explicit numbers first, which
 * keeps the conversion small and means nothing the user typed ever reaches
 * systemd as text. Times are UTC, so a job does not depend on the container's
 * time zone.
 *
 * Not supported on purpose: names (MON, JAN), "?", "L" and friends, seconds,
 * and setting both day-of-month and day-of-week (cron treats that as "either",
 * systemd as "both", and people are surprised by either). Runs closer together
 * than every 5 minutes are refused: the container is small and shared with the
 * app.
 */

export const MIN_GAP_MINUTES = 5;

export type Schedule = {
  /** The expression as normalised for storage, such as "*\/15 * * * *". */
  expression: string;
  minutes: number[];
  hours: number[];
  /** Days of the month 1-31, empty for "every day". */
  days: number[];
  /** Months 1-12, empty for "every month". */
  months: number[];
  /** Days of the week 0-6 with 0 as Sunday, empty for "every day". */
  weekdays: number[];
};

export class ScheduleError extends Error {}

const NICKNAMES: Record<string, string> = {
  "@hourly": "0 * * * *",
  "@daily": "0 0 * * *",
  "@midnight": "0 0 * * *",
  "@weekly": "0 0 * * 0",
  "@monthly": "0 0 1 * *",
};

type Range = { name: string; min: number; max: number };
const FIELDS: Range[] = [
  { name: "minute", min: 0, max: 59 },
  { name: "hour", min: 0, max: 23 },
  { name: "day of month", min: 1, max: 31 },
  { name: "month", min: 1, max: 12 },
  { name: "day of week", min: 0, max: 7 },
];

const NUMBER = /^\d{1,2}$/;

function parseField(raw: string, f: Range): number[] {
  const out = new Set<number>();
  for (const part of raw.split(",")) {
    if (part === "") throw new ScheduleError(`The ${f.name} field has an empty item.`);
    const [rangeText, stepText, extra] = part.split("/");
    if (extra !== undefined) throw new ScheduleError(`The ${f.name} field has more than one "/".`);
    let step = 1;
    if (stepText !== undefined) {
      if (!NUMBER.test(stepText) || Number(stepText) < 1) {
        throw new ScheduleError(`The step in the ${f.name} field must be a whole number of 1 or more.`);
      }
      step = Number(stepText);
    }
    let lo: number;
    let hi: number;
    if (rangeText === "*") {
      lo = f.min;
      // Day of week 7 is Sunday again; "*" stops at 6.
      hi = f.name === "day of week" ? 6 : f.max;
    } else if (rangeText.includes("-")) {
      const [a, b, more] = rangeText.split("-");
      if (more !== undefined || !NUMBER.test(a ?? "") || !NUMBER.test(b ?? "")) {
        throw new ScheduleError(`"${rangeText}" is not a valid range in the ${f.name} field.`);
      }
      lo = Number(a);
      hi = Number(b);
    } else {
      if (!NUMBER.test(rangeText)) {
        throw new ScheduleError(`"${rangeText}" is not a number in the ${f.name} field.`);
      }
      lo = Number(rangeText);
      // "5/10" means from 5 to the end in steps of 10, as in cron.
      hi = stepText !== undefined ? f.max : lo;
    }
    if (lo < f.min || hi > f.max) {
      throw new ScheduleError(`The ${f.name} field takes ${f.min} to ${f.max}.`);
    }
    if (lo > hi) throw new ScheduleError(`"${rangeText}" counts down; write the smaller number first.`);
    for (let v = lo; v <= hi; v += step) out.add(f.name === "day of week" && v === 7 ? 0 : v);
  }
  return [...out].sort((a, b) => a - b);
}

/** A field that lists every possible value is the same as "*". */
function isEvery(values: number[], f: Range) {
  const max = f.name === "day of week" ? 6 : f.max;
  return values.length === max - f.min + 1;
}

function normaliseText(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

/** Read an expression. Throws ScheduleError with a message fit to show to the person. */
export function parseSchedule(input: string): Schedule {
  const text = normaliseText(input);
  if (!text) throw new ScheduleError("Enter a schedule, for example */15 * * * * for every 15 minutes.");
  if (text.length > 100) throw new ScheduleError("That schedule is too long.");
  // Own keys only: "constructor" or "toString" must not reach the object's built-in properties.
  const nicknameKey = text.toLowerCase();
  const expanded = Object.hasOwn(NICKNAMES, nicknameKey) ? NICKNAMES[nicknameKey] : text;
  if (expanded.startsWith("@")) {
    throw new ScheduleError("Use @hourly, @daily, @weekly or @monthly, or write all five fields.");
  }
  const fields = expanded.split(" ");
  if (fields.length !== 5) {
    throw new ScheduleError(
      "A schedule has five fields: minute, hour, day of month, month, day of week. For example 30 3 * * * is every day at 03:30 UTC."
    );
  }
  const parsed = fields.map((raw, i) => parseField(raw, FIELDS[i]));
  const [minutes, hours, days, months, weekdays] = parsed;
  const dayLimited = !isEvery(days, FIELDS[2]);
  const weekLimited = !isEvery(weekdays, FIELDS[4]);
  if (dayLimited && weekLimited) {
    throw new ScheduleError(
      "Set either the day of the month or the day of the week, not both. Cron and systemd read that differently, so it is not allowed."
    );
  }
  const schedule: Schedule = {
    expression: expanded,
    minutes,
    hours,
    days: dayLimited ? days : [],
    months: isEvery(months, FIELDS[3]) ? [] : months,
    weekdays: weekLimited ? weekdays : [],
  };
  const gap = smallestGapMinutes(schedule);
  if (gap !== null && gap < MIN_GAP_MINUTES) {
    throw new ScheduleError(
      `That would run every ${gap} minute${gap === 1 ? "" : "s"}. Jobs run at most once every ${MIN_GAP_MINUTES} minutes so they do not starve your app.`
    );
  }
  return schedule;
}

/** Smallest time between two runs on a day the job runs; null when it runs once a day or less. */
function smallestGapMinutes(s: Schedule): number | null {
  const times: number[] = [];
  for (const h of s.hours) for (const m of s.minutes) times.push(h * 60 + m);
  if (times.length < 2) return null;
  times.sort((a, b) => a - b);
  let min = Infinity;
  for (let i = 1; i < times.length; i++) min = Math.min(min, times[i] - times[i - 1]);
  return min;
}

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/**
 * The OnCalendar value for a timer. Built only from numbers and fixed day
 * names, so it is safe to put in a unit file.
 */
export function toOnCalendar(s: Schedule): string {
  const dow = s.weekdays.length ? `${s.weekdays.map((d) => DAY_NAMES[d]).join(",")} ` : "";
  const month = s.months.length ? s.months.map((m) => String(m).padStart(2, "0")).join(",") : "*";
  const day = s.days.length ? s.days.map((d) => String(d).padStart(2, "0")).join(",") : "*";
  const hour = s.hours.map((h) => String(h).padStart(2, "0")).join(",");
  const minute = s.minutes.map((m) => String(m).padStart(2, "0")).join(",");
  return `${dow}*-${month}-${day} ${hour}:${minute}:00 UTC`;
}

const two = (n: number) => String(n).padStart(2, "0");

/** A short plain-language reading, or the expression itself when it is too unusual to put in words. */
export function describeSchedule(s: Schedule): string {
  const allHours = s.hours.length === 24;
  const onlyDaysOrAll = s.months.length === 0;
  if (s.days.length === 0 && s.weekdays.length === 0 && onlyDaysOrAll) {
    if (allHours && s.minutes.length === 60) return "Every minute";
    if (allHours && s.minutes.length === 1) return s.minutes[0] === 0 ? "Every hour" : `Every hour at :${two(s.minutes[0])}`;
    if (allHours) {
      const step = evenStep(s.minutes, 60);
      if (step) return `Every ${step} minutes`;
    }
    if (s.hours.length === 1 && s.minutes.length === 1) return `Every day at ${two(s.hours[0])}:${two(s.minutes[0])} UTC`;
    if (s.minutes.length === 1) {
      const step = evenStep(s.hours, 24);
      if (step) return `Every ${step} hours at :${two(s.minutes[0])}`;
    }
  }
  if (s.weekdays.length > 0 && s.days.length === 0 && s.months.length === 0 && s.hours.length === 1 && s.minutes.length === 1) {
    const days = s.weekdays.length === 7 ? "day" : s.weekdays.map((d) => DAY_NAMES[d]).join(", ");
    return `${days} at ${two(s.hours[0])}:${two(s.minutes[0])} UTC`;
  }
  if (s.days.length > 0 && s.months.length === 0 && s.hours.length === 1 && s.minutes.length === 1) {
    return `Day ${s.days.join(", ")} of each month at ${two(s.hours[0])}:${two(s.minutes[0])} UTC`;
  }
  return `${s.expression} (UTC)`;
}

/** n when the values are 0, n, 2n... all the way around a cycle of `size`, otherwise null. */
function evenStep(values: number[], size: number): number | null {
  if (values.length < 2 || values[0] !== 0) return null;
  const step = values[1] - values[0];
  if (step < 1 || size % step !== 0 || values.length !== size / step) return null;
  return values.every((v, i) => v === i * step) ? step : null;
}

/** The next time after `from` that the schedule fires, or null if it never does within about five years. */
export function nextRun(s: Schedule, from: Date): Date | null {
  const t = new Date(from.getTime());
  t.setUTCSeconds(0, 0);
  t.setUTCMinutes(t.getUTCMinutes() + 1);
  const limit = from.getTime() + 5 * 366 * 24 * 3600_000;
  while (t.getTime() <= limit) {
    const month = t.getUTCMonth() + 1;
    if (s.months.length && !s.months.includes(month)) {
      t.setUTCMonth(t.getUTCMonth() + 1, 1);
      t.setUTCHours(0, 0, 0, 0);
      continue;
    }
    const dayOk =
      (s.days.length === 0 || s.days.includes(t.getUTCDate())) &&
      (s.weekdays.length === 0 || s.weekdays.includes(t.getUTCDay()));
    if (!dayOk) {
      t.setUTCDate(t.getUTCDate() + 1);
      t.setUTCHours(0, 0, 0, 0);
      continue;
    }
    if (!s.hours.includes(t.getUTCHours())) {
      t.setUTCHours(t.getUTCHours() + 1, 0, 0, 0);
      continue;
    }
    if (!s.minutes.includes(t.getUTCMinutes())) {
      t.setUTCMinutes(t.getUTCMinutes() + 1, 0, 0);
      continue;
    }
    return t;
  }
  return null;
}
