import { and, asc, count, eq } from "drizzle-orm";
import { z } from "zod";
import { audit } from "@/server/audit";
import { newId } from "@/server/crypto";
import { getDb, schema, type Db } from "@/server/db";
import { ALERT_RULE_METRICS, type AlertRuleMetric, type AlertRuleStatus } from "@/server/db/schema";
import { HttpError } from "@/server/http";
import { assertOwned } from "@/server/projects";

/**
 * Threshold rules on one app's metrics. The state machine is pure and tested on
 * its own; the monitor pass feeds it one value per check.
 */

export const RULE_LIMIT_PER_APP = 25;
/** A rule with no value for this long is shown as "No data" (the monitor checks about every 5 minutes). */
export const RULE_STALE_MS = 15 * 60_000;

export const RULE_METRIC_LABEL: Record<AlertRuleMetric, string> = {
  cpu_percent: "CPU share of one core (%)",
  memory_mb: "Memory (MB)",
  latency_ms: "Health check time (ms)",
};

export type DisplayStatus = AlertRuleStatus | "off";

export const DISPLAY_LABEL: Record<DisplayStatus, string> = {
  ok: "OK",
  over: "Over threshold",
  firing: "Firing",
  recovering: "Recovering",
  no_data: "No data",
  off: "Off",
};

export type RuleInput = {
  comparison: "above" | "below";
  threshold: number;
  durationMinutes: number;
};

/** The fields the state machine reads and writes. */
export type RuleState = {
  status: AlertRuleStatus;
  breachSince: Date | null;
  recoverSince: Date | null;
};

export const INITIAL_RULE_STATE: RuleState = { status: "ok", breachSince: null, recoverSince: null };

export function isBreached(value: number, rule: Pick<RuleInput, "comparison" | "threshold">): boolean {
  return rule.comparison === "above" ? value > rule.threshold : value < rule.threshold;
}

/**
 * Pure: the next state given the last one and this check's value (null when
 * there was no reading).
 *
 * - No reading: "no_data". The breach timer is kept, so a metric that was
 *   already over the line does not have to start its wait again.
 * - Over the line: "over" until it has stayed there for the rule's duration,
 *   then "firing". A firing or recovering rule that goes over again fires at once.
 * - Back under the line: a firing rule becomes "recovering" and stays so until
 *   it has been under for the duration, then "ok".
 */
export function nextRuleState(prev: RuleState, value: number | null, rule: RuleInput, now: Date): RuleState {
  if (value === null) return { ...prev, status: "no_data" };
  const durationMs = rule.durationMinutes * 60_000;
  if (isBreached(value, rule)) {
    const breachSince = prev.breachSince ?? now;
    const wasActive = prev.status === "firing" || prev.status === "recovering";
    const elapsed = now.getTime() - breachSince.getTime();
    return {
      status: wasActive || elapsed >= durationMs ? "firing" : "over",
      breachSince,
      recoverSince: null,
    };
  }
  if (prev.status === "firing") {
    return { status: "recovering", breachSince: null, recoverSince: now };
  }
  if (prev.status === "recovering") {
    const since = prev.recoverSince ?? now;
    const done = now.getTime() - since.getTime() >= durationMs;
    return done
      ? { status: "ok", breachSince: null, recoverSince: null }
      : { status: "recovering", breachSince: null, recoverSince: since };
  }
  return { status: "ok", breachSince: null, recoverSince: null };
}

/** Pure: which transition, if any, a change of state is worth telling someone about. */
export function transitionOf(prev: AlertRuleStatus, next: AlertRuleStatus): "fired" | "resolved" | null {
  if (next === "firing" && prev !== "firing") return "fired";
  if (next === "ok" && (prev === "firing" || prev === "recovering")) return "resolved";
  return null;
}

/** Pure: the status a person sees. A paused rule is off; one without a recent reading has no data. */
export function displayStatus(
  rule: { paused: boolean; status: AlertRuleStatus; evaluatedAt: Date | null },
  now: Date
): DisplayStatus {
  if (rule.paused) return "off";
  if (!rule.evaluatedAt || now.getTime() - rule.evaluatedAt.getTime() > RULE_STALE_MS) return "no_data";
  return rule.status;
}

/** Pure: the value a metric has in one check, or null when it was not read. */
export function metricValue(
  metric: AlertRuleMetric,
  reading: { cpuPercent: number | null; memMb: number | null; healthMs: number | null }
): number | null {
  switch (metric) {
    case "cpu_percent":
      return reading.cpuPercent;
    case "memory_mb":
      return reading.memMb;
    case "latency_ms":
      return reading.healthMs;
  }
}

export const alertRuleInput = z.object({
  metric: z.enum(ALERT_RULE_METRICS),
  comparison: z.enum(["above", "below"]),
  threshold: z.number().finite().min(0).max(1_000_000),
  durationMinutes: z.number().int().min(0).max(24 * 60),
});

export type RuleView = {
  id: string;
  metric: AlertRuleMetric;
  metricLabel: string;
  comparison: "above" | "below";
  threshold: number;
  durationMinutes: number;
  paused: boolean;
  status: DisplayStatus;
  statusLabel: string;
  lastValue: number | null;
  evaluatedAt: string | null;
};

type RuleRow = typeof schema.alertRules.$inferSelect;

export function ruleView(row: RuleRow, now = new Date()): RuleView {
  const status = displayStatus(row, now);
  return {
    id: row.id,
    metric: row.metric,
    metricLabel: RULE_METRIC_LABEL[row.metric],
    comparison: row.comparison,
    threshold: row.threshold,
    durationMinutes: row.durationMinutes,
    paused: row.paused,
    status,
    statusLabel: DISPLAY_LABEL[status],
    lastValue: row.lastValue,
    evaluatedAt: row.evaluatedAt ? row.evaluatedAt.toISOString() : null,
  };
}

export async function listRules(userId: string, projectId: string, now = new Date()): Promise<RuleView[]> {
  await assertOwned(userId, projectId);
  const db = await getDb();
  const rows = await db
    .select()
    .from(schema.alertRules)
    .where(eq(schema.alertRules.projectId, projectId))
    .orderBy(asc(schema.alertRules.createdAt));
  return rows.map((r) => ruleView(r, now));
}

export async function createRule(userId: string, projectId: string, raw: unknown, now = new Date()): Promise<RuleView> {
  const input = alertRuleInput.parse(raw);
  await assertOwned(userId, projectId);
  const db = await getDb();
  const [{ n }] = await db
    .select({ n: count() })
    .from(schema.alertRules)
    .where(eq(schema.alertRules.projectId, projectId));
  if (n >= RULE_LIMIT_PER_APP) {
    throw new HttpError(409, `An app can have at most ${RULE_LIMIT_PER_APP} alert rules. Delete one to add another.`, "limit_reached");
  }
  const id = newId();
  await db.insert(schema.alertRules).values({
    id,
    projectId,
    ...input,
    paused: false,
    status: "ok",
    createdAt: now,
    updatedAt: now,
  });
  await audit(userId, "alert_rule.create", projectId, { metric: input.metric, comparison: input.comparison });
  return ruleView(await ownedRule(db, projectId, id), now);
}

async function ownedRule(db: Db, projectId: string, ruleId: string): Promise<RuleRow> {
  const row = await db
    .select()
    .from(schema.alertRules)
    .where(and(eq(schema.alertRules.id, ruleId), eq(schema.alertRules.projectId, projectId)))
    .get();
  if (!row) throw new HttpError(404, "Alert rule not found", "not_found");
  return row;
}

/** Pause or resume a rule. Resuming starts from a clean state, so an old breach does not fire at once. */
export async function setRulePaused(userId: string, projectId: string, ruleId: string, paused: boolean, now = new Date()) {
  await assertOwned(userId, projectId);
  const db = await getDb();
  await ownedRule(db, projectId, ruleId);
  await db
    .update(schema.alertRules)
    .set(
      paused
        ? { paused: true, updatedAt: now }
        : { paused: false, status: "ok", breachSince: null, recoverSince: null, evaluatedAt: null, updatedAt: now }
    )
    .where(eq(schema.alertRules.id, ruleId));
  return ruleView(await ownedRule(db, projectId, ruleId), now);
}

export async function deleteRule(userId: string, projectId: string, ruleId: string) {
  await assertOwned(userId, projectId);
  const db = await getDb();
  await ownedRule(db, projectId, ruleId);
  await db.delete(schema.alertRules).where(eq(schema.alertRules.id, ruleId));
}

/**
 * Run every active rule of one app against this check. Called by the monitor
 * pass with the values it read (empty when the app could not be read, which
 * makes every rule "no data" rather than leaving it stale).
 */
export async function evaluateRules(
  projectId: string,
  reading: { cpuPercent: number | null; memMb: number | null; healthMs: number | null },
  now: Date
): Promise<{ fired: string[]; resolved: string[] }> {
  const db = await getDb();
  const rows = await db
    .select()
    .from(schema.alertRules)
    .where(and(eq(schema.alertRules.projectId, projectId), eq(schema.alertRules.paused, false)));
  const fired: string[] = [];
  const resolved: string[] = [];
  for (const rule of rows) {
    const value = metricValue(rule.metric, reading);
    const next = nextRuleState(
      { status: rule.status, breachSince: rule.breachSince, recoverSince: rule.recoverSince },
      value,
      rule,
      now
    );
    await db
      .update(schema.alertRules)
      .set({ ...next, lastValue: value, evaluatedAt: now, updatedAt: now })
      .where(eq(schema.alertRules.id, rule.id));
    const t = transitionOf(rule.status, next.status);
    if (t === "fired") fired.push(rule.id);
    if (t === "resolved") resolved.push(rule.id);
  }
  return { fired, resolved };
}
