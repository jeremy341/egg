/**
 * Hack Club's own Nest status, read from the public page at status.hackclub.app.
 * The page writes its overall line into its HTML (`statusSummary:"Partial System
 * Outage"` next to a `statusClass`). Its JSON API needs an authorisation header,
 * so Egg reads the page instead. If the line cannot be read, the answer is
 * "unavailable". Nothing here guesses, and the result is never merged with
 * Egg's own checks.
 */

export const OFFICIAL_URL = "https://status.hackclub.app";
export const OFFICIAL_HOST = "status.hackclub.app";
/** The page is read at most this often, however many people look. */
export const OFFICIAL_MIN_AGE_MS = 60_000;
export const OFFICIAL_TIMEOUT_MS = 10_000;
export const STATUS_USER_AGENT = "Egg-status-check";
const MAX_BYTES = 2_000_000;

export type OfficialStatus =
  | { available: true; summary: string; statusClass: string | null; readAt: string }
  | { available: false; readAt: string };

/** A quoted JS or JSON string value for a key, with or without quotes around the key. */
function stringValue(html: string, key: string): string | null {
  const m = new RegExp(`["']?${key}["']?\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`).exec(html);
  if (!m) return null;
  try {
    return JSON.parse(`"${m[1]}"`) as string;
  } catch {
    return null;
  }
}

/**
 * Pull the overall summary and its colour class out of the page's HTML. Returns
 * null when the summary is missing or does not look like a short plain line, so
 * a changed layout reads as "unavailable" and never as a guess.
 */
export function parseOfficialStatus(html: string): { summary: string; statusClass: string | null } | null {
  const summary = stringValue(html, "statusSummary")?.trim();
  if (!summary || summary.length > 80 || /[<>\u0000-\u001f]/.test(summary)) return null;
  const rawClass = stringValue(html, "statusClass")?.trim();
  const statusClass = rawClass && /^[A-Za-z0-9_ -]{1,40}$/.test(rawClass) ? rawClass : null;
  return { summary, statusClass };
}

/** One read of the page. Never throws: any failure is "unavailable". */
export async function readOfficialStatus(
  options: { fetch?: typeof fetch; now?: Date; timeoutMs?: number } = {}
): Promise<OfficialStatus> {
  const readAt = (options.now ?? new Date()).toISOString();
  const unavailable: OfficialStatus = { available: false, readAt };
  try {
    const res = await (options.fetch ?? fetch)(OFFICIAL_URL, {
      method: "GET",
      headers: { "user-agent": STATUS_USER_AGENT, accept: "text/html" },
      signal: AbortSignal.timeout(options.timeoutMs ?? OFFICIAL_TIMEOUT_MS),
      cache: "no-store",
    });
    if (!res.ok) return unavailable;
    const length = Number(res.headers.get("content-length") ?? 0);
    if (length > MAX_BYTES) return unavailable;
    const parsed = parseOfficialStatus((await res.text()).slice(0, MAX_BYTES));
    return parsed ? { available: true, ...parsed, readAt } : unavailable;
  } catch {
    return unavailable;
  }
}

let kept: { at: number; value: OfficialStatus } | null = null;
let inflight: Promise<OfficialStatus> | null = null;

/**
 * The official status, read at most once a minute per process. A failed read is
 * kept for the same minute, so a page that is down is not asked again at once.
 */
export function getOfficialStatus(
  options: { fetch?: typeof fetch; now?: Date } = {}
): Promise<OfficialStatus> {
  const nowMs = (options.now ?? new Date()).getTime();
  if (kept && nowMs - kept.at < OFFICIAL_MIN_AGE_MS && nowMs >= kept.at) return Promise.resolve(kept.value);
  if (inflight) return inflight;
  inflight = readOfficialStatus(options)
    .then((value) => {
      kept = { at: nowMs, value };
      return value;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

export function resetOfficialStatusForTests() {
  kept = null;
  inflight = null;
}
