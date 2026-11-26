import { asc, gte, lt, sql } from "drizzle-orm";
import { config } from "@/server/config";
import { getDb, schema } from "@/server/db";
import { FAILURES_BEFORE_DOWN, nextMonitorState } from "@/server/monitor";
import {
  OFFICIAL_URL,
  STATUS_USER_AGENT,
  getOfficialStatus,
  type OfficialStatus,
} from "@/server/nest-official";
import { dailyStrip, type Incident, type StripDay } from "@/server/status-page";

/**
 * A public page on whether Nest answers, as seen from this Egg server.
 *
 * Once a minute the worker asks nest.hackclub.com and hackclub.app for their
 * front page and runs one query against Egg's own database. A check fails on a
 * timeout, a 5xx or no reply. Two failures in a row mark a target down, the same
 * rule the project alerts use, and a reply slower than two seconds is slow. This
 * shows whether Egg can reach Nest. It does not say every Nest container runs,
 * and it is not Hack Club's official status.
 */

export type TargetId = "nest-site" | "nest-app" | "egg";

export const TARGETS: readonly { id: TargetId; label: string; url: string | null }[] = [
  { id: "nest-site", label: "Nest website", url: "https://nest.hackclub.com" },
  { id: "nest-app", label: "Nest sign-in and app host", url: "https://hackclub.app" },
  { id: "egg", label: "Egg", url: null },
];

export const PROBE_TIMEOUT_MS = 10_000;
/** A reply slower than this is "slow". */
export const SLOW_MS = 2_000;
/** Probes are kept this long, then deleted by the job that writes them. */
export const PROBE_KEEP_MS = 90 * 86_400_000;
export const WINDOW_DAYS = 30;
/** The newest check is called stale, and the state unknown, after this long. */
export const STALE_MS = 5 * 60_000;
/** Between two checks, a longer gap than this is a pause in checking and not a stretch of downtime. */
const GAP_MS = 15 * 60_000;
const DAY_MS = 86_400_000;

// ------------------------------------------------------------------ probing

export type ProbeResult = { ok: boolean; httpStatus: number | null; latencyMs: number | null };

/** One GET. Fails on a timeout, a 5xx or no reply; anything below 500 counts as an answer. */
export async function probeUrl(
  url: string,
  options: { fetch?: typeof fetch; clock?: () => number; timeoutMs?: number } = {}
): Promise<ProbeResult> {
  const clock = options.clock ?? (() => performance.now());
  const started = clock();
  try {
    const res = await (options.fetch ?? fetch)(url, {
      method: "GET",
      headers: { "user-agent": STATUS_USER_AGENT },
      signal: AbortSignal.timeout(options.timeoutMs ?? PROBE_TIMEOUT_MS),
      cache: "no-store",
    });
    const latencyMs = Math.max(0, Math.round(clock() - started));
    // Only the first reply matters; do not download the page.
    void res.body?.cancel().catch(() => undefined);
    return { ok: res.status < 500, httpStatus: res.status, latencyMs };
  } catch {
    return { ok: false, httpStatus: null, latencyMs: null };
  }
}

/** Egg itself: the check must answer, and must answer in time. */
export async function probeEgg(
  check: () => Promise<unknown>,
  options: { clock?: () => number; timeoutMs?: number } = {}
): Promise<ProbeResult> {
  const clock = options.clock ?? (() => performance.now());
  const started = clock();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      check(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("timeout")), options.timeoutMs ?? PROBE_TIMEOUT_MS);
      }),
    ]);
    return { ok: true, httpStatus: null, latencyMs: Math.max(0, Math.round(clock() - started)) };
  } catch {
    return { ok: false, httpStatus: null, latencyMs: null };
  } finally {
    clearTimeout(timer);
  }
}

export type TargetState = "up" | "slow" | "down" | "unknown";

type Sample = { at: Date; ok: boolean; httpStatus: number | null; latencyMs: number | null };

const isSlow = (s: { latencyMs: number | null }) => s.latencyMs !== null && s.latencyMs > SLOW_MS;

/**
 * Pure: where a target stands, from its newest checks, newest first. Down after
 * two failures in a row. One failure alone changes nothing: the target keeps the
 * state of its last good check. With no good check to go on, it is unknown.
 */
export function targetState(
  newestFirst: Pick<Sample, "ok" | "latencyMs">[],
  failuresBeforeDown = FAILURES_BEFORE_DOWN
): TargetState {
  const recent = newestFirst.slice(0, failuresBeforeDown);
  if (recent.length >= failuresBeforeDown && recent.every((s) => !s.ok)) return "down";
  const good = recent.find((s) => s.ok);
  if (!good) return "unknown";
  return isSlow(good) ? "slow" : "up";
}

/**
 * Pure: the down periods in a run of checks, oldest first, by the same rule as
 * the project alerts. A pause in checking ends an open period at the last check
 * before it, so a stopped worker is never counted as downtime.
 */
export function incidentsFromProbes(samples: Pick<Sample, "at" | "ok">[], now: Date): Incident[] {
  const out: Incident[] = [];
  let state: { state: "unknown" | "up" | "down"; failures: number } = { state: "unknown", failures: 0 };
  let open: Incident | null = null;
  let prev: Date | null = null;
  for (const s of samples) {
    if (prev && s.at.getTime() - prev.getTime() > GAP_MS) {
      if (open) open.to = prev;
      open = null;
      state = { state: "unknown", failures: 0 };
    }
    const next = nextMonitorState(state, s.ok);
    state = { state: next.state, failures: next.failures };
    if (next.change === "down") {
      open = { from: s.at, to: null };
      out.push(open);
    } else if (next.change === "up" && open) {
      open.to = s.at;
      open = null;
    }
    prev = s.at;
  }
  if (open && prev && now.getTime() - prev.getTime() > GAP_MS) open.to = prev;
  return out;
}

/**
 * Pure: one entry per UTC day with the same up, partial and down rules as the
 * project status page. A day with no checks at all is "none".
 */
export function probeStrip(samples: Pick<Sample, "at" | "ok">[], now: Date, days = WINDOW_DAYS): StripDay[] {
  if (samples.length === 0) return dailyStrip([], now, days, false);
  const checked = new Set(samples.map((s) => s.at.toISOString().slice(0, 10)));
  return dailyStrip(incidentsFromProbes(samples, now), now, days).map((d) =>
    checked.has(d.day) ? d : { day: d.day, state: "none", downMinutes: 0 }
  );
}

/** Pure: the middle value, or null with nothing to go on. */
export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

// ---------------------------------------------------------------- the job

/** Delete probes older than 90 days. Run by the same job that writes them. */
export async function pruneStatusProbes(now = new Date()) {
  const db = await getDb();
  await db.delete(schema.statusProbes).where(lt(schema.statusProbes.checkedAt, new Date(now.getTime() - PROBE_KEEP_MS)));
}

async function eggDatabaseAnswers() {
  const db = await getDb();
  await db.get(sql`select 1`);
}

export type ProbeDeps = { fetch?: typeof fetch; eggCheck?: () => Promise<unknown>; clock?: () => number };

/** Check every target once, store the results, and prune. Called by the worker every minute. */
export async function runStatusProbes(now = new Date(), deps: ProbeDeps = {}) {
  const results = await Promise.all(
    TARGETS.map(async (t) => ({
      target: t.id,
      result: t.url
        ? await probeUrl(t.url, { fetch: deps.fetch, clock: deps.clock })
        : await probeEgg(deps.eggCheck ?? eggDatabaseAnswers, { clock: deps.clock }),
    }))
  );
  const db = await getDb();
  await db.insert(schema.statusProbes).values(
    results.map(({ target, result }) => ({
      target,
      checkedAt: now,
      ok: result.ok,
      httpStatus: result.httpStatus,
      latencyMs: result.latencyMs,
    }))
  );
  await pruneStatusProbes(now);
}

// ------------------------------------------------------------ the public read

export type TargetStatus = {
  id: TargetId;
  label: string;
  url: string | null;
  state: TargetState;
  /** From the newest check. Null when nothing answered, or for Egg itself. */
  httpStatus: number | null;
  latencyMs: number | null;
  checkedAt: string | null;
  median24hMs: number | null;
  median30dMs: number | null;
  days: StripDay[];
};

export type OverallState = "ok" | "degraded" | "down" | "unknown";

export type NestStatus = {
  overall: { state: OverallState; text: string };
  targets: TargetStatus[];
  /** Hack Club's own summary, read from its page. Never merged with the checks above. */
  official: OfficialStatus & { url: string };
  /** The host of the Egg server that ran the checks. */
  checkedFrom: string;
  lastCheckAt: string | null;
  windowDays: number;
  intervalSeconds: number;
};

export const OVERALL_TEXT: Record<OverallState, string> = {
  ok: "Nest and Egg are working",
  degraded: "Nest is slow or partly down",
  down: "Nest appears down from Egg's checks",
  unknown: "No recent checks yet",
};

/** Pure: the one line at the top, from the three targets' states. */
export function overallState(states: Record<TargetId, TargetState>): OverallState {
  const nest = [states["nest-site"], states["nest-app"]];
  if (nest.every((s) => s === "unknown")) return "unknown";
  if (nest.every((s) => s === "down")) return "down";
  if (nest.some((s) => s === "down" || s === "slow")) return "degraded";
  if (states.egg === "down" || states.egg === "slow") return "degraded";
  return "ok";
}

export async function buildNestStatus(
  now = new Date(),
  deps: { official?: () => Promise<OfficialStatus> } = {}
): Promise<NestStatus> {
  const db = await getDb();
  // One extra day so a down period that began before the window still pairs up.
  const since = new Date(now.getTime() - (WINDOW_DAYS + 1) * DAY_MS);
  const rows = await db
    .select({
      target: schema.statusProbes.target,
      at: schema.statusProbes.checkedAt,
      ok: schema.statusProbes.ok,
      httpStatus: schema.statusProbes.httpStatus,
      latencyMs: schema.statusProbes.latencyMs,
    })
    .from(schema.statusProbes)
    .where(gte(schema.statusProbes.checkedAt, since))
    .orderBy(asc(schema.statusProbes.checkedAt), asc(schema.statusProbes.id));

  const day24 = now.getTime() - DAY_MS;
  const windowStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - (WINDOW_DAYS - 1) * DAY_MS;

  const targets: TargetStatus[] = TARGETS.map((t) => {
    const samples: Sample[] = rows.filter((r) => r.target === t.id);
    const last = samples.at(-1) ?? null;
    const fresh = last !== null && now.getTime() - last.at.getTime() <= STALE_MS;
    const state: TargetState = fresh ? targetState([...samples].reverse().slice(0, FAILURES_BEFORE_DOWN)) : "unknown";
    const times = (from: number) =>
      samples
        .filter((s) => s.ok && s.latencyMs !== null && s.at.getTime() >= from)
        .map((s) => s.latencyMs as number);
    return {
      id: t.id,
      label: t.label,
      url: t.url,
      state,
      httpStatus: last?.httpStatus ?? null,
      latencyMs: last?.latencyMs ?? null,
      checkedAt: last ? last.at.toISOString() : null,
      median24hMs: median(times(day24)),
      median30dMs: median(times(windowStart)),
      days: probeStrip(samples, now, WINDOW_DAYS),
    };
  });

  const states = Object.fromEntries(targets.map((t) => [t.id, t.state])) as Record<TargetId, TargetState>;
  const overall = overallState(states);
  const lastCheckAt = targets.map((t) => t.checkedAt).filter((v): v is string => v !== null).sort().at(-1) ?? null;
  const official = await (deps.official ?? (() => getOfficialStatus({ now })))();

  return {
    overall: { state: overall, text: OVERALL_TEXT[overall] },
    targets,
    official: { ...official, url: OFFICIAL_URL },
    checkedFrom: new URL(config().APP_URL).host,
    lastCheckAt,
    windowDays: WINDOW_DAYS,
    intervalSeconds: 60,
  };
}
