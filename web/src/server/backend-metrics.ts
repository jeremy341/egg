import { AsyncLocalStorage } from "node:async_hooks";
import { monitorEventLoopDelay, performance } from "node:perf_hooks";
import { rateLimiter } from "@/server/rate-limit-core";

type RequestSample = { queries: number };
const context = new AsyncLocalStorage<RequestSample>();
const routes = new Map<string, { samples: number[]; requests: number; queries: number; errors: number }>();
let histogram: ReturnType<typeof monitorEventLoopDelay> | undefined;
let startedAt: number | undefined;
const enabled = () => process.env.EGG_BACKEND_METRICS === "1";

// Requests the proxy saw and how many it refused, per whole minute (the current minute and the one before).
const MINUTE_MS = 60_000;
type MinuteCount = { requests: number; refused: number };
const minutes: { slot: number; current: MinuteCount; previous: MinuteCount } = {
  slot: -1, current: { requests: 0, refused: 0 }, previous: { requests: 0, refused: 0 },
};
const none = (): MinuteCount => ({ requests: 0, refused: 0 });

/** Counts one request the proxy saw, and whether it was refused with a 429. Counted only when EGG_BACKEND_METRICS=1. */
export function recordIngress(refused: boolean) {
  if (!enabled()) return;
  const slot = Math.floor(Date.now() / MINUTE_MS);
  if (slot !== minutes.slot) {
    minutes.previous = slot === minutes.slot + 1 ? minutes.current : none();
    minutes.current = none();
    minutes.slot = slot;
  }
  minutes.current.requests++;
  if (refused) minutes.current.refused++;
}

function ingressSnapshot() {
  const slot = Math.floor(Date.now() / MINUTE_MS);
  const thisMinute = minutes.slot === slot ? minutes.current : none();
  const lastMinute = minutes.slot === slot ? minutes.previous : minutes.slot === slot - 1 ? minutes.current : none();
  return {
    requestsThisMinute: thisMinute.requests, refusedThisMinute: thisMinute.refused,
    requestsLastMinute: lastMinute.requests, refusedLastMinute: lastMinute.refused,
    // Addresses banned for repeated refusals right now. Always reported, whether or not counting is on.
    activeBans: rateLimiter().activeBans(),
  };
}

/** Counts statements only: SQL text, parameters and identities never enter diagnostics. */
export function recordBackendQuery() { if (enabled()) { const active = context.getStore(); if (active) active.queries++; } }

export async function measureBackendRequest<T>(pathname: string, work: () => Promise<T>): Promise<T> {
  if (!enabled()) return work();
  if (!histogram) { histogram = monitorEventLoopDelay({ resolution: 50 }); histogram.enable(); startedAt = Date.now(); }
  // Only a route family is retained, never a project ID, slug, query string or token.
  const family = pathname.split("/").slice(0, 3).map((p) => /^[a-z-]{0,32}$/.test(p) ? p : "resource").join("/");
  const key = routes.has(family) || routes.size < 32 ? family : "other";
  const row = routes.get(key) ?? { samples: [], requests: 0, queries: 0, errors: 0 };
  routes.set(key, row);
  const sample = { queries: 0 };
  const start = performance.now();
  try {
    const result = await context.run(sample, work);
    if (result instanceof Response && result.status >= 500) row.errors++;
    return result;
  }
  catch (err) { row.errors++; throw err; }
  finally {
    row.requests++; row.queries += sample.queries;
    row.samples.push(performance.now() - start);
    if (row.samples.length > 256) row.samples.shift();
  }
}

export function backendMetricsSnapshot() {
  const memory = process.memoryUsage();
  return {
    enabled: enabled(), processId: process.pid, uptimeSeconds: Math.floor(process.uptime()),
    measuredSince: startedAt ? new Date(startedAt).toISOString() : null,
    memory: { rssBytes: memory.rss, heapUsedBytes: memory.heapUsed, externalBytes: memory.external },
    eventLoopP95Ms: histogram && histogram.count > 0 ? histogram.percentile(95) / 1e6 : null,
    routes: [...routes].map(([family, r]) => {
      const sorted = [...r.samples].sort((a, b) => a - b);
      const percentile = (p: number) => sorted.length ? sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1)] : null;
      return { family, requests: r.requests, queries: r.queries, errors: r.errors, sampleSize: sorted.length,
        p50Ms: percentile(.5), p95Ms: percentile(.95) };
    }),
    ingress: ingressSnapshot(),
    scope: "This process only; request timings end when response construction completes, not when an SSE connection closes.",
  };
}
