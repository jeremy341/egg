import { and, desc, eq, inArray, isNull, lt, or } from "drizzle-orm";
import { z } from "zod";
import { audit } from "@/server/audit";
import { newId, open, seal } from "@/server/crypto";
import { getDb, schema, type Db } from "@/server/db";
import { HttpError, notFound } from "@/server/http";
import {
  parseWebhookUrl,
  safePost,
  WebhookSendError,
  type Lookup,
  type Transport,
} from "@/server/webhook-net";
import { newWebhookSecret, signWebhook, SIGNATURE_HEADER } from "@/server/webhook-sign";

/**
 * Outbound webhooks: the owner gives an https address and this app tells it
 * when a deployment starts, succeeds or fails.
 *
 * - The secret is random, shown once (create and rotate), and kept sealed.
 * - Every request is signed (see webhook-sign.ts) and sent through the SSRF
 *   checks in webhook-net.ts.
 * - The payload is built from a short allowlist of fields. It never carries
 *   environment values, logs, commit messages, errors or URLs.
 * - Up to 3 attempts with a pause between them. Each delivery is recorded with
 *   a short error code only, and removed after 30 days.
 * - Sending never throws into a deployment (`dispatchDeploymentEvent`).
 */

export const EVENTS = schema.WEBHOOK_EVENTS;
export type WebhookEventName = (typeof EVENTS)[number];

export const MAX_WEBHOOKS_PER_USER = 10;
export const MAX_ATTEMPTS = 3;
/** Pause before attempt 2 and attempt 3. */
export const BACKOFF_MS = [2_000, 10_000] as const;
export const DELIVERY_RETENTION_MS = 30 * 86_400_000;
/** A delivery still "pending" after this long was cut off (for example by a restart). */
const STALE_PENDING_MS = 10 * 60_000;

const context = (webhookId: string) => `webhook:${webhookId}`;

// ------------------------------------------------------------------ input

const urlField = z
  .string()
  .max(500)
  .transform((v, ctx) => {
    try {
      return parseWebhookUrl(v).toString();
    } catch (err) {
      ctx.addIssue({ code: "custom", message: err instanceof HttpError ? err.message : "That is not a valid URL." });
      return z.NEVER;
    }
  });

const eventsField = z
  .array(z.enum(EVENTS))
  .min(1, "Pick at least one event.")
  .max(EVENTS.length)
  .transform((e) => [...new Set(e)]);

export const createWebhookInput = z
  .object({
    url: urlField,
    events: eventsField.optional(),
    /** Limit to one of your projects. Left out, the webhook covers all of them. */
    projectId: z.string().min(1).max(100).optional(),
  })
  .strict();

export const updateWebhookInput = z
  .object({
    url: urlField.optional(),
    events: eventsField.optional(),
    active: z.boolean().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: "Send at least one field to change." });

export type CreateWebhookInput = z.input<typeof createWebhookInput>;
export type UpdateWebhookInput = z.input<typeof updateWebhookInput>;

// ------------------------------------------------------------------ views

type WebhookRow = typeof schema.webhooks.$inferSelect;
type DeliveryRow = typeof schema.webhookDeliveries.$inferSelect;

export type WebhookView = {
  id: string;
  url: string;
  host: string;
  projectId: string | null;
  events: WebhookEventName[];
  active: boolean;
  createdAt: string;
  updatedAt: string;
  secretRotatedAt: string | null;
};

export type DeliveryView = {
  id: string;
  webhookId: string;
  event: string;
  deploymentId: string | null;
  status: "pending" | "success" | "failed";
  attempts: number;
  lastErrorCode: string | null;
  createdAt: string;
  finishedAt: string | null;
};

function parseEvents(raw: string): WebhookEventName[] {
  try {
    const v = JSON.parse(raw) as unknown;
    if (Array.isArray(v)) return v.filter((e): e is WebhookEventName => (EVENTS as readonly unknown[]).includes(e));
  } catch {
    // fall through
  }
  return [];
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

/** The public shape of a webhook. The sealed secret never leaves this module. */
export function toView(r: WebhookRow): WebhookView {
  return {
    id: r.id,
    url: r.url,
    host: hostOf(r.url),
    projectId: r.projectId,
    events: parseEvents(r.events),
    active: r.active,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    secretRotatedAt: r.secretRotatedAt ? r.secretRotatedAt.toISOString() : null,
  };
}

function toDeliveryView(r: DeliveryRow): DeliveryView {
  return {
    id: r.id,
    webhookId: r.webhookId,
    event: r.event,
    deploymentId: r.deploymentId,
    status: r.status,
    attempts: r.attempts,
    lastErrorCode: r.lastErrorCode,
    createdAt: r.createdAt.toISOString(),
    finishedAt: r.finishedAt ? r.finishedAt.toISOString() : null,
  };
}

// ------------------------------------------------------------------ owner actions

async function ownedRow(userId: string, webhookId: string): Promise<WebhookRow> {
  const db = await getDb();
  const row = await db
    .select()
    .from(schema.webhooks)
    .where(and(eq(schema.webhooks.id, webhookId), eq(schema.webhooks.userId, userId)))
    .get();
  if (!row) throw notFound("Webhook not found");
  return row;
}

export async function listWebhooks(userId: string): Promise<WebhookView[]> {
  const db = await getDb();
  const rows = await db
    .select()
    .from(schema.webhooks)
    .where(eq(schema.webhooks.userId, userId))
    .orderBy(desc(schema.webhooks.createdAt));
  return rows.map(toView);
}

export async function getWebhook(userId: string, webhookId: string): Promise<WebhookView> {
  return toView(await ownedRow(userId, webhookId));
}

/** Create a webhook. The secret is in the result once and cannot be read again. */
export async function createWebhook(
  userId: string,
  raw: unknown
): Promise<{ webhook: WebhookView; secret: string }> {
  const input = createWebhookInput.parse(raw);
  const db = await getDb();

  if (input.projectId) {
    const project = await db
      .select({ id: schema.projects.id })
      .from(schema.projects)
      .where(and(eq(schema.projects.id, input.projectId), eq(schema.projects.userId, userId)))
      .get();
    if (!project) throw notFound("Project not found");
  }
  const id = newId();
  const secret = newWebhookSecret();
  const now = new Date();
  // Count and insert in one write transaction (BEGIN IMMEDIATE on libsql): two
  // concurrent creates cannot both read a below-cap count and both insert.
  await db.transaction(async (tx) => {
    const existing = await tx
      .select({ id: schema.webhooks.id })
      .from(schema.webhooks)
      .where(eq(schema.webhooks.userId, userId));
    if (existing.length >= MAX_WEBHOOKS_PER_USER) {
      throw new HttpError(409, `You can have up to ${MAX_WEBHOOKS_PER_USER} webhooks. Delete one first.`, "limit");
    }
    await tx.insert(schema.webhooks).values({
      id,
      userId,
      projectId: input.projectId ?? null,
      url: input.url,
      secretEnc: seal(secret, context(id)),
      events: JSON.stringify(input.events ?? EVENTS),
      active: true,
      createdAt: now,
      updatedAt: now,
    });
  });
  await audit(userId, "webhook.create", id, { host: hostOf(input.url) });
  return { webhook: await getWebhook(userId, id), secret };
}

export async function updateWebhook(userId: string, webhookId: string, raw: unknown): Promise<WebhookView> {
  const input = updateWebhookInput.parse(raw);
  await ownedRow(userId, webhookId);
  const db = await getDb();
  const set: Partial<typeof schema.webhooks.$inferInsert> = { updatedAt: new Date() };
  if (input.url !== undefined) set.url = input.url;
  if (input.events !== undefined) set.events = JSON.stringify(input.events);
  if (input.active !== undefined) set.active = input.active;
  await db
    .update(schema.webhooks)
    .set(set)
    .where(and(eq(schema.webhooks.id, webhookId), eq(schema.webhooks.userId, userId)));
  await audit(userId, "webhook.update", webhookId, { fields: Object.keys(input).join(", ") });
  return getWebhook(userId, webhookId);
}

export async function deleteWebhook(userId: string, webhookId: string): Promise<void> {
  await ownedRow(userId, webhookId);
  const db = await getDb();
  await db
    .delete(schema.webhooks)
    .where(and(eq(schema.webhooks.id, webhookId), eq(schema.webhooks.userId, userId)));
  await audit(userId, "webhook.delete", webhookId);
}

/** Replace the secret. The old one stops working at once; the new one is shown once. */
export async function rotateWebhookSecret(
  userId: string,
  webhookId: string
): Promise<{ webhook: WebhookView; secret: string }> {
  await ownedRow(userId, webhookId);
  const db = await getDb();
  const secret = newWebhookSecret();
  const now = new Date();
  // The rotation and its audit line land together or not at all.
  await db.transaction(async (tx) => {
    await tx
      .update(schema.webhooks)
      .set({ secretEnc: seal(secret, context(webhookId)), secretRotatedAt: now, updatedAt: now })
      .where(and(eq(schema.webhooks.id, webhookId), eq(schema.webhooks.userId, userId)));
    await tx.insert(schema.auditLog).values({ userId, action: "webhook.rotate", target: webhookId, at: new Date() });
  });
  return { webhook: await getWebhook(userId, webhookId), secret };
}

export async function listDeliveries(userId: string, webhookId: string, limit = 20): Promise<DeliveryView[]> {
  await ownedRow(userId, webhookId);
  const db = await getDb();
  const rows = await db
    .select()
    .from(schema.webhookDeliveries)
    .where(eq(schema.webhookDeliveries.webhookId, webhookId))
    .orderBy(desc(schema.webhookDeliveries.createdAt))
    .limit(Math.min(Math.max(limit, 1), 100));
  return rows.map(toDeliveryView);
}

// ------------------------------------------------------------------ payload

export type WebhookPayload = {
  event: string;
  project: { id: string; slug: string };
  deployment: { id: string; branch: string; commit: string | null; state: string };
  time: string;
  /** Present and true only on a test message. */
  test?: true;
};

/**
 * The only place a payload is made. Fields are picked one by one from the
 * deployment and project rows, so a new column can never leak by accident.
 */
export function buildPayload(
  event: string,
  project: { id: string; slug: string },
  dep: { id: string; branch: string; commitSha: string | null; state: string },
  at: Date
): WebhookPayload {
  return {
    event,
    project: { id: project.id, slug: project.slug },
    deployment: {
      id: dep.id,
      branch: dep.branch,
      commit: dep.commitSha ? dep.commitSha.slice(0, 7) : null,
      state: dep.state,
    },
    time: at.toISOString(),
  };
}

// ------------------------------------------------------------------ sending

export type SendDeps = {
  lookup?: Lookup;
  transport?: Transport;
  /** Pause between attempts. Tests pass a no-op. */
  sleep?: (ms: number) => Promise<void>;
  now?: () => Date;
};

const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function errorCode(err: unknown): { code: string; retryable: boolean } {
  if (err instanceof WebhookSendError) return { code: err.code, retryable: err.retryable };
  return { code: "internal", retryable: false };
}

/** Send one payload to one webhook with up to 3 attempts, recording the delivery. */
async function deliver(
  row: WebhookRow,
  payload: WebhookPayload,
  deploymentId: string | null,
  deps: SendDeps,
  maxAttempts: number
): Promise<DeliveryView> {
  const db = await getDb();
  const now = deps.now ?? (() => new Date());
  const sleep = deps.sleep ?? realSleep;
  const deliveryId = newId();
  // Capture the timestamps once: the row we store and the view we return must
  // agree. Calling now() again when building the response could hand the caller
  // timestamps that differ from what was actually recorded.
  const createdAt = now();
  await db.insert(schema.webhookDeliveries).values({
    id: deliveryId,
    webhookId: row.id,
    event: payload.event,
    deploymentId,
    status: "pending",
    attempts: 0,
    createdAt,
  });

  const body = JSON.stringify(payload);
  let status: "success" | "failed" = "failed";
  let lastError: string | null = null;
  let attempts = 0;

  try {
    const url = parseWebhookUrl(row.url);
    const secret = open(row.secretEnc, context(row.id));
    while (attempts < maxAttempts) {
      if (attempts > 0) await sleep(BACKOFF_MS[Math.min(attempts - 1, BACKOFF_MS.length - 1)]);
      attempts += 1;
      const timestamp = Math.floor(now().getTime() / 1000);
      try {
        await safePost(
          url,
          {
            "Content-Type": "application/json",
            "User-Agent": "Egg-Webhooks/1",
            "X-Egg-Event": payload.event,
            "X-Egg-Delivery": deliveryId,
            [SIGNATURE_HEADER]: signWebhook(secret, body, timestamp),
          },
          body,
          { lookup: deps.lookup, transport: deps.transport }
        );
        status = "success";
        lastError = null;
        break;
      } catch (err) {
        const { code, retryable } = errorCode(err);
        lastError = code;
        if (!retryable) break;
      }
      await db
        .update(schema.webhookDeliveries)
        .set({ attempts, lastErrorCode: lastError })
        .where(eq(schema.webhookDeliveries.id, deliveryId));
    }
  } catch (err) {
    // A bad stored URL, or a secret that cannot be opened.
    lastError = err instanceof HttpError ? "invalid_url" : "secret_unreadable";
  }

  const finishedAt = now();
  await db
    .update(schema.webhookDeliveries)
    .set({ status, attempts, lastErrorCode: lastError, finishedAt })
    .where(eq(schema.webhookDeliveries.id, deliveryId));
  return {
    id: deliveryId,
    webhookId: row.id,
    event: payload.event,
    deploymentId,
    status,
    attempts,
    lastErrorCode: lastError,
    createdAt: createdAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
  };
}

/**
 * Send a sample message so the owner can check their receiver and signature
 * code. One attempt, no retries, and the sample values are plainly fake.
 */
export async function sendTestWebhook(userId: string, webhookId: string, deps: SendDeps = {}): Promise<DeliveryView> {
  const row = await ownedRow(userId, webhookId);
  const at = (deps.now ?? (() => new Date()))();
  const payload: WebhookPayload = {
    ...buildPayload(
      "webhook.test",
      { id: "test-project", slug: "test-project" },
      { id: "test-deployment", branch: "main", commitSha: "0000000000", state: "ready" },
      at
    ),
    test: true,
  };
  const result = await deliver(row, payload, null, deps, 1);
  await audit(userId, "webhook.test", webhookId, { result: result.status, code: result.lastErrorCode });
  return result;
}

// ------------------------------------------------------------------ dispatch

/** The deployment states that produce an event. Canceled and queued do not. */
export const EVENT_FOR_STATE: Record<string, WebhookEventName | undefined> = {
  building: "deployment.started",
  ready: "deployment.succeeded",
  error: "deployment.failed",
};

/**
 * Retention runs at most once an hour, and never twice at the same time. The
 * timestamp advances only after a successful prune, so a failure does not
 * suppress pruning for the next hour. Taking the operation as an argument keeps
 * the scheduling testable without a live database.
 */
export function createPruneScheduler(prune: (at: Date) => Promise<void>) {
  let lastPrune = 0;
  let inFlight: Promise<void> | null = null;
  return (at: Date): Promise<void> => {
    const nowMs = at.getTime();
    if (nowMs - lastPrune <= 3_600_000) return Promise.resolve();
    if (inFlight) return inFlight;
    inFlight = (async () => {
      try {
        await prune(at);
        lastPrune = nowMs;
      } finally {
        inFlight = null;
      }
    })();
    return inFlight;
  };
}
const maybePrune = createPruneScheduler(pruneDeliveries);

/**
 * Deployments are being deleted: the deliveries stay until retention removes
 * them, but the link must not outlive them. Takes the caller's transaction so
 * the deployments and their delivery rows change together.
 */
export async function forgetDeliveriesForDeployments(db: Pick<Db, "update">, deploymentIds: string[]): Promise<void> {
  if (deploymentIds.length === 0) return;
  await db
    .update(schema.webhookDeliveries)
    .set({ deploymentId: null })
    .where(inArray(schema.webhookDeliveries.deploymentId, deploymentIds));
}

/** Delete deliveries older than 30 days and close ones that were cut off. */
export async function pruneDeliveries(now = new Date()): Promise<void> {
  const db = await getDb();
  await db
    .delete(schema.webhookDeliveries)
    .where(lt(schema.webhookDeliveries.createdAt, new Date(now.getTime() - DELIVERY_RETENTION_MS)));
  await db
    .update(schema.webhookDeliveries)
    .set({ status: "failed", lastErrorCode: "interrupted", finishedAt: now })
    .where(
      and(
        eq(schema.webhookDeliveries.status, "pending"),
        lt(schema.webhookDeliveries.createdAt, new Date(now.getTime() - STALE_PENDING_MS))
      )
    );
}

/**
 * Tell the owner's webhooks about a deployment state change. Call it without
 * awaiting (`void dispatchDeploymentEvent(id)`): it resolves after the last
 * attempt, and it NEVER rejects, so a broken receiver or a missing table cannot
 * touch a deployment.
 */
export async function dispatchDeploymentEvent(
  deploymentId: string,
  deps: SendDeps & { state?: string; event?: WebhookEventName } = {}
): Promise<void> {
  try {
    const db = await getDb();
    const dep = await db.select().from(schema.deployments).where(eq(schema.deployments.id, deploymentId)).get();
    if (!dep) return;
    const state = deps.state ?? dep.state;
    const event = deps.event ?? EVENT_FOR_STATE[state];
    if (!event) return;
    const project = await db.select().from(schema.projects).where(eq(schema.projects.id, dep.projectId)).get();
    if (!project) return;

    const rows = await db
      .select()
      .from(schema.webhooks)
      .where(
        and(
          eq(schema.webhooks.userId, project.userId),
          eq(schema.webhooks.active, true),
          or(eq(schema.webhooks.projectId, project.id), isNull(schema.webhooks.projectId))
        )
      );
    const targets = rows.filter((r) => parseEvents(r.events).includes(event));
    if (targets.length === 0) return;

    const at = (deps.now ?? (() => new Date()))();
    const payload = buildPayload(event, project, { ...dep, state }, at);
    await Promise.allSettled(targets.map((r) => deliver(r, payload, dep.id, deps, MAX_ATTEMPTS)));

    await maybePrune(at);
  } catch (err) {
    console.warn("webhook dispatch failed", err instanceof Error ? err.message : err);
  }
}
