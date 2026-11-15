/**
 * Pure rules for the values the analytics script sends. The collector runs every
 * value through one of these before it is stored, so a copy of the script that
 * was edited by hand cannot store more than the script is meant to send.
 */

/** "/a/b?x=1#y" becomes "/a/b". Anything that is not a path becomes "/". */
export function cleanPath(raw: string): string {
  let p = raw.trim();
  p = p.split("#")[0].split("?")[0];
  if (!p.startsWith("/")) return "/";
  p = p.slice(0, 200);
  return p.length > 1 ? p.replace(/\/+$/, "") || "/" : p;
}

const HOST = /^[a-z0-9]([a-z0-9.-]{0,98}[a-z0-9])?$/i;

/**
 * The host of a referrer, or null when there is none or it is not a web address.
 * The script sends the host alone; a full address from an older copy of the script
 * is reduced to its host here. The host is kept as it is, so `www.` stays.
 */
export function cleanReferrer(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const text = raw.trim();
  if (HOST.test(text)) return text.toLowerCase();
  try {
    const u = new URL(text);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.hostname.slice(0, 100) || null;
  } catch {
    return null;
  }
}

export const UTM_MAX = 80;
export const UTM_KEYS = ["source", "medium", "campaign"] as const;
export type Utm = { source: string | null; medium: string | null; campaign: string | null };

const CONTROL = /[\x00-\x1f\x7f-\x9f]/g;
const HAS_CONTROL = /[\x00-\x1f\x7f-\x9f]/;

function utmValue(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const t = Array.from(raw.replace(CONTROL, " ").replace(/\s+/g, " ").trim())
    .slice(0, UTM_MAX)
    .join("")
    .trim();
  return t || null;
}

/**
 * The three campaign values a page view may carry, each trimmed and cut to 80
 * characters. Only `source`, `medium` and `campaign` are read, whatever else the
 * object holds. A missing or empty value is null.
 */
export function cleanUtm(raw: { source?: unknown; medium?: unknown; campaign?: unknown } | null | undefined): Utm {
  return { source: utmValue(raw?.source), medium: utmValue(raw?.medium), campaign: utmValue(raw?.campaign) };
}

/** A data-egg-track name or a data-egg-value: short, plain, and safe to put inside a script. */
export const TRACK_NAME = /^[A-Za-z0-9][A-Za-z0-9 _.:-]{0,39}$/;
/** The value of an event follows the same plain-text rule as its name. */
export const TRACK_VALUE = TRACK_NAME;

/** The value of a custom event, or null when it is missing or breaks the rule. */
export function cleanEventValue(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const t = raw.trim();
  return TRACK_VALUE.test(t) ? t : null;
}

/** The name of a custom event, or null when it breaks the rule. */
export function cleanEventName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const t = raw.trim();
  return TRACK_NAME.test(t) ? t : null;
}

// ------------------------------------------------------------ web vitals

export const VITALS = ["lcp", "cls", "inp", "fcp", "ttfb"] as const;
export type Vital = (typeof VITALS)[number];

/** Google's published thresholds: good up to the first number, poor above the second. */
export const VITAL_THRESHOLDS: Record<Vital, readonly [number, number]> = {
  lcp: [2500, 4000],
  cls: [0.1, 0.25],
  inp: [200, 500],
  fcp: [1800, 3000],
  ttfb: [800, 1800],
};

export type VitalRating = "good" | "needs-work" | "poor";

export const VITAL_RATING_LABELS: Record<VitalRating, string> = {
  good: "Good",
  "needs-work": "Needs work",
  poor: "Poor",
};

/** A value at or under the first threshold is good, over the second is poor, between is needs work. */
export function rateVital(metric: Vital, value: number): VitalRating {
  const [good, poor] = VITAL_THRESHOLDS[metric];
  if (value <= good) return "good";
  if (value > poor) return "poor";
  return "needs-work";
}

export const VITAL_NAMES: Record<Vital, string> = {
  lcp: "Largest Contentful Paint",
  cls: "Cumulative Layout Shift",
  inp: "Interaction to Next Paint",
  fcp: "First Contentful Paint",
  ttfb: "Time to First Byte",
};

/** The unit a metric is measured in. Layout shift is a score and has none. */
export const VITAL_UNITS: Record<Vital, "ms" | "score"> = { lcp: "ms", cls: "score", inp: "ms", fcp: "ms", ttfb: "ms" };

/** A measurement with its unit: "640 ms" under a second, "2.41 s" above, and a score as "0.08". */
export function formatVital(metric: Vital, value: number): string {
  if (metric === "cls") return String(Math.round(value * 1000) / 1000);
  if (value < 1000) return `${Math.round(value)} ms`;
  return `${(value / 1000).toFixed(2)} s`;
}


const MAX_MS = 600_000;

/**
 * One metric as it is stored: milliseconds as a whole number, layout shift to
 * three decimals. Null for anything that is not a finite, non-negative number
 * in a sane range.
 */
export function cleanVital(metric: Vital, raw: unknown): number | null {
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw < 0) return null;
  if (metric === "cls") return raw > 100 ? null : Math.round(raw * 1000) / 1000;
  return raw > MAX_MS ? null : Math.round(raw);
}

/** Median of a list (the mean of the two middle values for an even count), or null when empty. */
export function median(values: readonly number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Nearest-rank percentile: the smallest value with at least p percent of the values at or below it. */
export function percentile(values: readonly number[], p: number): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const rank = Math.min(s.length, Math.max(1, Math.ceil((p / 100) * s.length)));
  return s[rank - 1];
}

// ------------------------------------------------------------ errors

export const ERROR_MESSAGE_MAX = 200;
export const ERROR_FILE_MAX = 100;
/** The script sends at most this many errors for one page view. */
export const ERRORS_PER_PAGE_VIEW = 5;

const EMAIL_G = /[^\s@]+@[^\s@]+\.[^\s@]+/g;
const URL_IN_TEXT = /\bhttps?:\/\/[^\s"')]+/gi;

export type CleanError = { message: string; file: string | null; line: number | null };

/**
 * An error report as it is stored: the message with white space collapsed, web
 * addresses cut back to their path (no query, no fragment), email addresses
 * replaced, and at most 200 characters; the script file's name without its
 * address; the line number. Null when there is no message.
 */
export function cleanError(raw: { message?: unknown; file?: unknown; line?: unknown }): CleanError | null {
  if (typeof raw.message !== "string") return null;
  const message = Array.from(
    raw.message
      .replace(CONTROL, " ")
      .replace(URL_IN_TEXT, (u) => u.split(/[?#]/)[0])
      .replace(EMAIL_G, "[email]")
      .replace(/\s+/g, " ")
      .trim()
  )
    .slice(0, ERROR_MESSAGE_MAX)
    .join("")
    .trim();
  if (!message) return null;
  let file: string | null = null;
  if (typeof raw.file === "string") {
    const name = raw.file.split(/[?#]/)[0].split("/").pop()?.trim().slice(0, ERROR_FILE_MAX) ?? "";
    file = name && !HAS_CONTROL.test(name) ? name : null;
  }
  const line =
    typeof raw.line === "number" && Number.isInteger(raw.line) && raw.line > 0 && raw.line < 10_000_000 ? raw.line : null;
  return { message, file, line };
}
