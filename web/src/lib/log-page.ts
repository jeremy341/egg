import { lineLevels, type LogLevel } from "@/lib/log-filter";

/**
 * Paging backwards through the journal. The journal is read with `-o short-iso`,
 * so each line starts with a timestamp that is exact to the second. Several
 * lines can share a second, so a position is a second plus the number of lines
 * of that second that were already handed out: "everything up to second `at`,
 * not counting the last `skip` lines of that second".
 *
 * The cursor is a string the browser hands back as it got it: `<at>.<skip>`,
 * `at` in seconds since the epoch.
 */

export type LogCursor = { at: number; skip: number };

export function encodeLogCursor(c: LogCursor): string {
  return `${c.at}.${c.skip}`;
}

/** Null for anything that is not a cursor this module made. */
export function decodeLogCursor(raw: unknown): LogCursor | null {
  if (typeof raw !== "string") return null;
  const m = /^(\d{1,12})\.(\d{1,5})$/.exec(raw);
  if (!m) return null;
  const at = Number(m[1]);
  const skip = Number(m[2]);
  return Number.isSafeInteger(at) && at > 0 ? { at, skip } : null;
}

const STAMP = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:[.,]\d+)?(Z|[+-]\d{2}:?\d{2})?(?=\s)/;

/** Seconds since the epoch of the timestamp a line starts with, or null when it has none. */
export function lineSeconds(line: string): number | null {
  const m = STAMP.exec(line);
  if (!m) return null;
  const [, y, mo, d, h, mi, s, zone] = m;
  let ms = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s));
  if (zone && zone !== "Z") {
    const sign = zone[0] === "-" ? -1 : 1;
    const digits = zone.slice(1).replace(":", "");
    ms -= sign * (Number(digits.slice(0, 2)) * 60 + Number(digits.slice(2, 4))) * 60_000;
  }
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
}

/** A line without its own timestamp (the rest of a multi-line message) takes the one above it. */
function stamps(lines: string[]): (number | null)[] {
  let last: number | null = null;
  return lines.map((l) => {
    last = lineSeconds(l) ?? last;
    return last;
  });
}

/**
 * What a fresh read of the newest lines adds to lines already on screen: the
 * part of `fresh` after the longest run where the end of `shown` equals the start
 * of `fresh`. Null when they share no line (more arrived than one read holds), so
 * the caller cannot join them without leaving a gap.
 */
export function newerLines(shown: string[], fresh: string[]): string[] | null {
  if (fresh.length === 0) return [];
  for (let k = Math.min(shown.length, fresh.length); k >= 1; k--) {
    let same = true;
    for (let i = 0; i < k; i++) {
      if (shown[shown.length - k + i] !== fresh[i]) {
        same = false;
        break;
      }
    }
    if (same) return fresh.slice(k);
  }
  return null;
}

/**
 * Turns what the journal printed into one page of lines and the cursor for the
 * page before it.
 *
 * `raw` is the journal's output for a request of `asked` lines. With a cursor,
 * the lines after it are dropped first, then the page is filtered the way the
 * live view is (level, then search) and cut to the newest `lines`. `older` is
 * null when the journal has nothing before the first line read.
 */
export function pageLogLines(
  raw: string[],
  opts: { lines: number; asked: number; q: string; level: LogLevel; cursor: LogCursor | null }
): { lines: string[]; older: string | null } {
  const at = stamps(raw);
  const exhausted = raw.length < opts.asked;

  let end = raw.length;
  if (opts.cursor) {
    // `--until` reaches into the second after the cursor; those lines are newer.
    while (end > 0 && at[end - 1] !== null && (at[end - 1] as number) > opts.cursor.at) end--;
    let drop = opts.cursor.skip;
    while (drop > 0 && end > 0 && at[end - 1] === opts.cursor.at) {
      end--;
      drop--;
    }
  }
  const chunk = raw.slice(0, end);

  let keep = chunk.map((_, i) => i);
  if (opts.level !== "all") {
    const levels = lineLevels(chunk);
    keep = keep.filter((i) => levels[i] !== "info");
  }
  if (opts.q) keep = keep.filter((i) => chunk[i].toLowerCase().includes(opts.q));
  const cut = keep.length > opts.lines;
  if (cut) keep = keep.slice(-opts.lines);
  const lines = keep.map((i) => chunk[i]);

  // Where the next page starts: just before the first line read, or, when the
  // page was cut to size, just before the first line kept.
  let older: string | null = null;
  if (cut || !exhausted) {
    let start = cut ? keep[0] : 0;
    while (start < chunk.length && at[start] === null) start++;
    if (start < chunk.length) {
      const second = at[start] as number;
      let skip = 0;
      for (let i = start; i < chunk.length; i++) if (at[i] === second) skip++;
      if (opts.cursor && second === opts.cursor.at) skip += opts.cursor.skip;
      older = encodeLogCursor({ at: second, skip });
    }
  }
  return { lines, older };
}
