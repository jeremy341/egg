import { randomUUID } from "node:crypto";
import { and, eq, inArray, isNull, lt, sql } from "drizzle-orm";
import { audit } from "@/server/audit";
import { config } from "@/server/config";
import { newId } from "@/server/crypto";
import { getDb, schema } from "@/server/db";
import { DEFAULT_UNIT_DIR, unitName } from "@/server/deploy/layout";
import { cleanupOwnedProject } from "@/server/deploy/remote";
import { jobUnitNames } from "@/server/scheduled-jobs";
import { HttpError, notFound } from "@/server/http";
import { terminals } from "@/server/terminal";
import { connectToServer, getServerForUser, type ServerRow } from "@/server/servers";
import { parseProbe, PROBE_SCRIPT } from "@/server/ssh/probe";
import type { NestSession } from "@/server/ssh/connection";
import { cleanupBlockingStates } from "@/server/cleanup-guards";

export const CLEANUP_DRAIN_MS = 5 * 60_000;
const CLEANUP_LEASE_MS = 2 * 60_000;
const REMOTE_SESSION_STALE_MS = 15 * 60_000;
const CLEANUP_POLL_MS = 5_000;

export type CleanupItemStatus = {
  id: string;
  projectId: string;
  projectName: string;
  projectSlug: string;
  serverLabel: string;
  state: "pending" | "running" | "failed" | "done";
  step: string;
  error: string | null;
  warnings: string[];
};

export type CleanupStatus = {
  id: string;
  scope: "account" | "project";
  state: "draining" | "running" | "failed" | "done";
  step: string;
  requestedAt: Date;
  notBefore: Date;
  error: string | null;
  items: CleanupItemStatus[];
  recoveryRequired: boolean;
  canCancel: boolean;
};

async function cancelQueued(tx: Parameters<Parameters<Awaited<ReturnType<typeof getDb>>["transaction"]>[0]>[0], projectIds: string[]) {
  if (projectIds.length === 0) return;
  const queued = await tx
    .select({ id: schema.deployments.id })
    .from(schema.deployments)
    .where(and(inArray(schema.deployments.projectId, projectIds), eq(schema.deployments.state, "queued")));
  const ids = queued.map((x) => x.id);
  if (ids.length === 0) return;
  await tx.update(schema.jobs)
    .set({ state: "failed", error: "Canceled for cleanup" })
    .where(and(inArray(schema.jobs.deploymentId, ids), eq(schema.jobs.state, "queued")));
  await tx.update(schema.deployments)
    .set({ state: "canceled", error: "Canceled for cleanup", finishedAt: new Date() })
    .where(and(inArray(schema.deployments.id, ids), eq(schema.deployments.state, "queued")));
}

async function userCleanupExists(tx: Parameters<Parameters<Awaited<ReturnType<typeof getDb>>["transaction"]>[0]>[0], userId: string) {
  return Boolean(await tx.select({ id: schema.cleanupJobs.id })
    .from(schema.cleanupJobs)
    .where(and(eq(schema.cleanupJobs.userId, userId), inArray(schema.cleanupJobs.state, cleanupBlockingStates)))
    .get());
}

function createJobRow(userId: string, scope: "account" | "project", projectId: string | null, now: Date) {
  return {
    id: newId(),
    userId,
    scope,
    projectId,
    state: "draining" as const,
    requestedAt: now,
    notBefore: new Date(now.getTime() + CLEANUP_DRAIN_MS),
    step: "draining",
    updatedAt: now,
  };
}

function itemRows(jobId: string, projects: Array<{ id: string; serverId: string; name: string; slug: string; serverLabel: string }>, now: Date) {
  return projects.map((p) => ({
    id: newId(),
    cleanupJobId: jobId,
    projectId: p.id,
    serverId: p.serverId,
    projectName: p.name,
    projectSlug: p.slug,
    serverLabel: p.serverLabel,
    state: "pending" as const,
    step: "pending",
    updatedAt: now,
  }));
}

export async function requestProjectCleanup(userId: string, projectId: string) {
  const db = await getDb();
  const project = await db.select().from(schema.projects)
    .where(and(eq(schema.projects.id, projectId), eq(schema.projects.userId, userId))).get();
  if (!project) throw notFound("Project not found");
  const server = await getServerForUser(userId, project.serverId);
  if (server.status === "disconnected") throw new HttpError(409, "Reconnect this server before scheduling remote cleanup.", "disconnected");
  const now = new Date();
  const job = createJobRow(userId, "project", projectId, now);
  try {
    await db.transaction(async (tx) => {
      const adoption = await tx.select({ id: schema.adoptionPlans.id }).from(schema.adoptionPlans)
        .innerJoin(schema.projects, eq(schema.projects.id, schema.adoptionPlans.projectId))
        .where(and(eq(schema.projects.serverId, project.serverId), eq(schema.adoptionPlans.state, "executing"))).get();
      if (adoption) throw new HttpError(409, "An app cutover on this server needs to finish before cleanup.", "adoption_in_progress");
      if (await userCleanupExists(tx, userId)) {
        throw new HttpError(409, "Another cleanup is already in progress for this account.", "cleanup_in_progress");
      }
      await cancelQueued(tx, [project.id]);
      await tx.insert(schema.cleanupJobs).values(job);
      await tx.insert(schema.cleanupItems).values(itemRows(job.id, [{
        id: project.id,
        serverId: project.serverId,
        name: project.name,
        slug: project.slug,
        serverLabel: `${server.nestUsername}.hackclub.app`,
      }], now));
    });
  } catch (err) {
    if (err instanceof HttpError) throw err;
    if (isUnique(err)) throw new HttpError(409, "Cleanup is already in progress for this account.", "cleanup_in_progress");
    throw err;
  }
  await audit(userId, "project.cleanup_request", project.id, { name: project.name });
  return getCleanupStatus(userId, job.id);
}

export async function requestAccountCleanup(userId: string, userName: string, typedName: unknown) {
  if (typeof typedName !== "string" || typedName.trim() !== userName.trim()) {
    throw new HttpError(400, "Type your name exactly to confirm.", "validation");
  }
  const db = await getDb();
  const now = new Date();
  const job = createJobRow(userId, "account", null, now);
  await db.transaction(async (tx) => {
    const adoption = await tx.select({ id: schema.adoptionPlans.id }).from(schema.adoptionPlans)
      .where(and(eq(schema.adoptionPlans.userId, userId), eq(schema.adoptionPlans.state, "executing"))).get();
    if (adoption) throw new HttpError(409, "An app cutover needs to finish before cleanup.", "adoption_in_progress");
    if (await userCleanupExists(tx, userId)) {
      throw new HttpError(409, "Cleanup is already in progress for this account.", "cleanup_in_progress");
    }
    const projects = await tx.select({
      id: schema.projects.id,
      serverId: schema.projects.serverId,
      name: schema.projects.name,
      slug: schema.projects.slug,
      nestUsername: schema.servers.nestUsername,
      serverStatus: schema.servers.status,
    }).from(schema.projects).innerJoin(schema.servers, eq(schema.servers.id, schema.projects.serverId))
      .where(eq(schema.projects.userId, userId));
    if (projects.some((p) => p.serverStatus === "disconnected")) throw new HttpError(409, "Reconnect disconnected servers before scheduling remote cleanup.", "disconnected");
    await cancelQueued(tx, projects.map((p) => p.id));
    await tx.insert(schema.cleanupJobs).values(job);
    if (projects.length > 0) {
      await tx.insert(schema.cleanupItems).values(itemRows(job.id, projects.map((p) => ({
        id: p.id,
        serverId: p.serverId,
        name: p.name,
        slug: p.slug,
        serverLabel: `${p.nestUsername}.hackclub.app`,
      })), now));
    }
  });
  // Sessions and credentials deliberately remain until all remote steps finish.
  await audit(userId, "account.cleanup_request");
  return getCleanupStatus(userId, job.id);
}

export async function getCleanupStatus(userId: string, cleanupId: string): Promise<CleanupStatus> {
  const db = await getDb();
  const job = await db.select().from(schema.cleanupJobs)
    .where(and(eq(schema.cleanupJobs.id, cleanupId), eq(schema.cleanupJobs.userId, userId))).get();
  if (!job) throw notFound("Cleanup request not found");
  const items = await db.select().from(schema.cleanupItems)
    .where(eq(schema.cleanupItems.cleanupJobId, job.id));
  return {
    id: job.id,
    scope: job.scope,
    state: job.state,
    step: job.step,
    requestedAt: job.requestedAt,
    notBefore: job.notBefore,
    error: job.error,
    recoveryRequired: job.state === "running" && !!job.leaseUntil && job.leaseUntil.getTime() < Date.now(),
    canCancel: job.state === "draining" && job.attempts === 0,
    items: items.map((item) => ({
      id: item.id,
      projectId: item.projectId,
      projectName: item.projectName,
      projectSlug: item.projectSlug,
      serverLabel: item.serverLabel,
      state: item.state,
      step: item.step,
      error: item.error,
      warnings: parseWarnings(item.warnings),
    })),
  };
}

export async function getActiveAccountCleanup(userId: string) {
  const db = await getDb();
  const job = await db.select({ id: schema.cleanupJobs.id }).from(schema.cleanupJobs)
    .where(and(eq(schema.cleanupJobs.userId, userId), eq(schema.cleanupJobs.scope, "account"), inArray(schema.cleanupJobs.state, cleanupBlockingStates)))
    .get();
  return job ? getCleanupStatus(userId, job.id) : null;
}

export async function getActiveProjectCleanup(userId: string, projectId: string) {
  const db = await getDb();
  const row = await db.select({ id: schema.cleanupJobs.id }).from(schema.cleanupJobs)
    .innerJoin(schema.cleanupItems, eq(schema.cleanupItems.cleanupJobId, schema.cleanupJobs.id))
    .where(and(eq(schema.cleanupJobs.userId, userId), eq(schema.cleanupItems.projectId, projectId), inArray(schema.cleanupJobs.state, cleanupBlockingStates)))
    .get();
  return row ? getCleanupStatus(userId, row.id) : null;
}

export async function retryCleanup(userId: string, cleanupId: string, confirmIdle = false) {
  const db = await getDb();
  const job = await db.select().from(schema.cleanupJobs)
    .where(and(eq(schema.cleanupJobs.id, cleanupId), eq(schema.cleanupJobs.userId, userId))).get();
  if (!job) throw notFound("Cleanup request not found");
  const expired = job.state === "running" && !!job.leaseUntil && job.leaseUntil.getTime() < Date.now();
  if (job.state !== "failed" && !expired) throw new HttpError(409, "Only a failed or interrupted cleanup can be retried.", "conflict");
  if (expired && !confirmIdle) throw new HttpError(409, "The prior cleanup worker did not confirm completion. Verify that it and its remote commands have stopped before confirming retry.", "cleanup_remote_session");
  const staleCutoff = new Date(Date.now() - REMOTE_SESSION_STALE_MS);
  const targetServers = job.scope === "account"
    ? await db.select({ id: schema.servers.id }).from(schema.servers).where(eq(schema.servers.userId, userId))
    : await db.select({ serverId: schema.cleanupItems.serverId }).from(schema.cleanupItems).where(eq(schema.cleanupItems.cleanupJobId, job.id));
  const serverIds = [...new Set(targetServers.map((s) => "id" in s ? s.id : s.serverId))];
  const staleOps = serverIds.length
    ? await db.select({ id: schema.cleanupOperations.id }).from(schema.cleanupOperations)
      .where(and(inArray(schema.cleanupOperations.serverId, serverIds), lt(schema.cleanupOperations.openedAt, staleCutoff)))
    : [];
  if (staleOps.length > 0 && !confirmIdle) {
    throw new HttpError(409, "An SSH session did not confirm that it closed. Check that no Egg terminal or remote action is still running, then retry with that confirmation.", "cleanup_remote_session");
  }
  await db.transaction(async (tx) => {
    if (staleOps.length > 0) {
      await tx.delete(schema.cleanupOperations).where(inArray(schema.cleanupOperations.id, staleOps.map((o) => o.id)));
    }
    await tx.update(schema.cleanupItems).set({ state: "pending", step: "pending", error: null })
      .where(and(eq(schema.cleanupItems.cleanupJobId, job.id), inArray(schema.cleanupItems.state, ["failed", "running"])));
    await tx.update(schema.cleanupJobs).set({
      state: "draining",
      step: "draining",
      error: null,
      notBefore: new Date(Date.now() + CLEANUP_DRAIN_MS),
      leaseOwner: null,
      leaseUntil: null,
      updatedAt: new Date(),
    }).where(eq(schema.cleanupJobs.id, job.id));
  });
  return getCleanupStatus(userId, job.id);
}

/** A drain can be canceled only before the executor has started any remote step. */
export async function cancelCleanup(userId: string, cleanupId: string) {
  const db = await getDb();
  const gone = await db.delete(schema.cleanupJobs).where(and(
    eq(schema.cleanupJobs.id, cleanupId), eq(schema.cleanupJobs.userId, userId),
    eq(schema.cleanupJobs.state, "draining"), eq(schema.cleanupJobs.attempts, 0)
  )).returning({ id: schema.cleanupJobs.id });
  if (!gone.length) throw new HttpError(409, "Cleanup has started and cannot be canceled safely.", "conflict");
}

function isUnique(err: unknown) {
  return err instanceof Error && /UNIQUE constraint failed/.test(err.message);
}

function parseWarnings(raw: string | null): string[] {
  try { return raw ? JSON.parse(raw) as string[] : []; } catch { return []; }
}

export type CleanupDeps = {
  connect: (server: ServerRow) => Promise<NestSession>;
  closeTerminals: (userId: string, serverId?: string) => Promise<void>;
  unitDir: string;
};

export function defaultCleanupDeps(): CleanupDeps {
  return {
    connect: (server) => connectToServer(server, { allowDuringCleanup: true, cleanupExecutor: true }),
    closeTerminals: async (userId, serverId) => {
      await terminals().closeAllForUser(userId, "disabled", serverId ? { serverId } : {});
    },
    unitDir: config().UNIT_DIR || DEFAULT_UNIT_DIR,
  };
}

async function activeJobsForProject(projectId: string) {
  const db = await getDb();
  return db.select({ id: schema.jobs.id }).from(schema.jobs)
    .innerJoin(schema.deployments, eq(schema.deployments.id, schema.jobs.deploymentId))
    .where(and(eq(schema.deployments.projectId, projectId), eq(schema.jobs.state, "running"))).get();
}

async function activeRemoteOps(serverId: string) {
  const db = await getDb();
  return db.select().from(schema.cleanupOperations).where(eq(schema.cleanupOperations.serverId, serverId));
}

async function setJobWait(jobId: string, owner: string, step: string, now: Date) {
  const db = await getDb();
  await db.update(schema.cleanupJobs).set({
    state: "draining", step, notBefore: new Date(now.getTime() + CLEANUP_POLL_MS),
    leaseOwner: null, leaseUntil: null, updatedAt: now,
  }).where(and(eq(schema.cleanupJobs.id, jobId), eq(schema.cleanupJobs.leaseOwner, owner)));
}

async function waitForRemoteOperations(userId: string, serverId: string, deps: CleanupDeps, now: Date): Promise<"ready" | "wait" | "stale"> {
  await deps.closeTerminals(userId, serverId);
  const ops = await activeRemoteOps(serverId);
  if (ops.length === 0) return "ready";
  return ops.some((op) => now.getTime() - op.openedAt.getTime() >= REMOTE_SESSION_STALE_MS) ? "stale" : "wait";
}

async function cleanItem(userId: string, itemId: string, deps: CleanupDeps, now: Date) {
  const db = await getDb();
  const item = await db.select().from(schema.cleanupItems).where(eq(schema.cleanupItems.id, itemId)).get();
  if (!item) throw new Error("Cleanup target no longer exists.");
  const adoption = await db.select({ id: schema.adoptionPlans.id }).from(schema.adoptionPlans)
    .innerJoin(schema.projects, eq(schema.projects.id, schema.adoptionPlans.projectId))
    .where(and(eq(schema.projects.serverId, item.serverId), eq(schema.adoptionPlans.state, "executing"))).get();
  if (adoption) return { wait: true, step: "waiting_for_adoption" as const };
  const running = await activeJobsForProject(item.projectId);
  if (running) return { wait: true, step: "waiting_for_deployments" as const };
  const remoteOps = await waitForRemoteOperations(userId, item.serverId, deps, now);
  if (remoteOps === "wait") return { wait: true, step: "waiting_for_remote_sessions" as const };
  if (remoteOps === "stale") throw new Error("An SSH session did not confirm that it closed. Check that no Egg terminal or remote action is still running, then retry with that confirmation.");

  const project = await db.select().from(schema.projects).where(and(eq(schema.projects.id, item.projectId), eq(schema.projects.userId, userId))).get();
  const server = await db.select().from(schema.servers).where(and(eq(schema.servers.id, item.serverId), eq(schema.servers.userId, userId))).get();
  if (!project || !server) throw new Error("The project or server record is missing, so Egg cannot verify the remote resources it owns.");

  const session = await deps.connect(server);
  try {
    const probeResult = await session.script(PROBE_SCRIPT, { timeoutMs: 30_000 });
    if (probeResult.code !== 0 || !/^home=\/[^\r\n]+$/m.test(probeResult.stdout) || !/^uid=\d+$/m.test(probeResult.stdout)) {
      throw new Error("Could not verify the remote home directory; resources were kept.");
    }
    const probe = parseProbe(probeResult.stdout);
    const previews = await db.select().from(schema.deployments).where(
      and(eq(schema.deployments.projectId, project.id), eq(schema.deployments.env, "preview"), eq(schema.deployments.cleanedUp, false))
    );
    const warnings: string[] = [];
    const res = await session.script(cleanupOwnedProject({
      home: probe.home,
      slug: project.slug,
      units: [
        unitName(project.slug),
        ...previews.map((p) => unitName(project.slug, { releaseId: p.releaseId })),
        ...(await jobUnitNames(project.id, project.slug)),
      ],
      unitDir: deps.unitDir,
      docker: project.deploymentMode !== "native",
    }), { timeoutMs: 120_000 });
    if (res.code !== 0) throw new Error(res.stderr.trim().slice(0, 300) || "Could not remove the Egg-managed project resources from the Nest server.");
    warnings.push(...extractWarnings(`${res.stdout}\n${res.stderr}`));
    await db.update(schema.deployments).set({ cleanedUp: true }).where(eq(schema.deployments.projectId, project.id));
    await db.update(schema.cleanupItems).set({ state: "done", step: "remote_complete", error: null, warnings: JSON.stringify([...new Set(warnings)]), updatedAt: now }).where(eq(schema.cleanupItems.id, item.id));
    return { wait: false as const, warnings };
  } finally {
    session.close();
  }
}

function extractWarnings(output: string) {
  return output.split(/\r?\n/).filter((line) => line.startsWith("EGG_CLEANUP_WARNING:"))
    .map((line) => line.slice("EGG_CLEANUP_WARNING:".length).trim()).filter(Boolean);
}

async function claimCleanup(workerId: string, now: Date) {
  const db = await getDb();
  const leaseUntil = new Date(now.getTime() + CLEANUP_LEASE_MS);
  const claimed = await db.update(schema.cleanupJobs).set({
    state: "running", step: "starting", leaseOwner: workerId, leaseUntil,
    attempts: sql`${schema.cleanupJobs.attempts} + 1`, updatedAt: now,
  }).where(and(
    eq(schema.cleanupJobs.state, "draining"),
    lt(schema.cleanupJobs.notBefore, new Date(now.getTime() + 1)),
    isNull(schema.cleanupJobs.leaseOwner),
    sql`${schema.cleanupJobs.id} = (SELECT id FROM cleanup_jobs WHERE state = 'draining' AND not_before <= ${now.getTime()} AND lease_owner IS NULL ORDER BY requested_at, id LIMIT 1)`
  )).returning();
  return claimed[0] ?? null;
}

async function finalizeProject(userId: string, jobId: string, projectId: string) {
  const db = await getDb();
  await db.transaction(async (tx) => {
    const job = await tx.select().from(schema.cleanupJobs)
      .where(and(eq(schema.cleanupJobs.id, jobId), eq(schema.cleanupJobs.userId, userId), eq(schema.cleanupJobs.scope, "project"))).get();
    const item = await tx.select().from(schema.cleanupItems)
      .where(and(eq(schema.cleanupItems.cleanupJobId, jobId), eq(schema.cleanupItems.projectId, projectId))).get();
    if (!job || !item || item.state !== "done") throw new Error("Remote cleanup is not complete; project records were kept.");
    await tx.delete(schema.projects).where(and(eq(schema.projects.id, projectId), eq(schema.projects.userId, userId)));
    await tx.update(schema.cleanupJobs).set({ state: "done", step: "complete", finishedAt: new Date(), leaseOwner: null, leaseUntil: null, updatedAt: new Date() }).where(eq(schema.cleanupJobs.id, jobId));
  });
  await audit(userId, "project.delete", null, { projectId, remoteCleanup: "complete" });
}

async function finalizeAccount(userId: string) {
  const db = await getDb();
  const servers = await db.select({ id: schema.servers.id }).from(schema.servers).where(eq(schema.servers.userId, userId));
  const serverIds = servers.map((s) => s.id);
  if (serverIds.length > 0) {
    const ops = await db.select({ id: schema.cleanupOperations.id }).from(schema.cleanupOperations).where(inArray(schema.cleanupOperations.serverId, serverIds));
    if (ops.length > 0) throw new Error("An SSH session is still open on a connected server. Wait for it to close before account cleanup can finish.");
  }
  const dbJobs = await db.select().from(schema.cleanupJobs)
    .where(and(eq(schema.cleanupJobs.userId, userId), eq(schema.cleanupJobs.scope, "account")));
  const job = dbJobs[0];
  if (!job) return;
  const items = await db.select().from(schema.cleanupItems).where(eq(schema.cleanupItems.cleanupJobId, job.id));
  if (items.some((i) => i.state !== "done")) throw new Error("Some project cleanup steps are incomplete; account records were kept.");
  // GitHub App installations can be shared and are intentionally never uninstalled here.
  await db.delete(schema.auditLog).where(eq(schema.auditLog.userId, userId));
  await db.delete(schema.users).where(eq(schema.users.id, userId));
}

export async function runCleanupOnce(deps = defaultCleanupDeps(), now = new Date(), workerId = `cleanup-${randomUUID()}`) {
  const db = await getDb();
  const job = await claimCleanup(workerId, now);
  if (!job) return null;
  const heartbeat = setInterval(() => {
    void db.update(schema.cleanupJobs).set({ leaseUntil: new Date(Date.now() + CLEANUP_LEASE_MS), updatedAt: new Date() })
      .where(and(eq(schema.cleanupJobs.id, job.id), eq(schema.cleanupJobs.leaseOwner, workerId))).catch(() => {});
  }, 30_000);
  const items = await db.select().from(schema.cleanupItems).where(eq(schema.cleanupItems.cleanupJobId, job.id));
  const failures: string[] = [];
  try {
    if (job.scope === "account") await deps.closeTerminals(job.userId);
    for (const item of items) {
      if (item.state === "done") continue;
      await db.update(schema.cleanupItems).set({ state: "running", step: "waiting_for_work", error: null, attempts: sql`${schema.cleanupItems.attempts} + 1`, updatedAt: now }).where(eq(schema.cleanupItems.id, item.id));
      const result = await cleanItem(job.userId, item.id, deps, now).catch((err: unknown) => ({ error: err instanceof Error ? err.message : String(err) }));
      if ("wait" in result && result.wait) {
        await db.update(schema.cleanupItems).set({ state: "pending", step: result.step, updatedAt: now }).where(eq(schema.cleanupItems.id, item.id));
        await setJobWait(job.id, workerId, result.step, now);
        return job.id;
      }
      if ("error" in result) {
        failures.push(`${item.projectName}: ${result.error}`);
        await db.update(schema.cleanupItems).set({ state: "failed", step: "remote_failed", error: result.error.slice(0, 500), updatedAt: now }).where(eq(schema.cleanupItems.id, item.id));
      }
    }

    const updatedItems = await db.select().from(schema.cleanupItems).where(eq(schema.cleanupItems.cleanupJobId, job.id));
    const itemWarnings = updatedItems.flatMap((x) => parseWarnings(x.warnings));
    if (failures.length > 0) {
      await db.update(schema.cleanupJobs).set({ state: "failed", step: "remote_failed", error: failures.join("; ").slice(0, 1000), warnings: JSON.stringify([...new Set(itemWarnings)]), leaseOwner: null, leaseUntil: null, updatedAt: now }).where(eq(schema.cleanupJobs.id, job.id));
      return job.id;
    }
    if (job.scope === "project" && job.projectId) {
      await finalizeProject(job.userId, job.id, job.projectId);
    } else {
      const serverIds = (await db.select({ id: schema.servers.id }).from(schema.servers).where(eq(schema.servers.userId, job.userId))).map((s) => s.id);
      const ops = serverIds.length ? await db.select().from(schema.cleanupOperations).where(inArray(schema.cleanupOperations.serverId, serverIds)) : [];
      if (ops.length) {
        if (ops.some((op) => now.getTime() - op.openedAt.getTime() >= REMOTE_SESSION_STALE_MS)) throw new Error("An SSH session did not confirm that it closed. Verify the affected server before retrying.");
        await setJobWait(job.id, workerId, "waiting_for_remote_sessions", now);
        return job.id;
      }
      // No projects still observe the five-minute drain before the account is removed.
      if (now < job.notBefore) {
        await setJobWait(job.id, workerId, "draining", now);
        return job.id;
      }
      await finalizeAccount(job.userId);
    }
    return job.id;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const isRemoteGuard = message.includes("SSH session");
    await db.update(schema.cleanupJobs).set({
      state: "failed",
      step: isRemoteGuard ? "manual_remote_check" : "failed",
      error: message.slice(0, 1000),
      leaseOwner: null,
      leaseUntil: null,
      updatedAt: now,
    }).where(and(eq(schema.cleanupJobs.id, job.id), eq(schema.cleanupJobs.leaseOwner, workerId)));
    return job.id;
  } finally {
    clearInterval(heartbeat);
  }
}

export function startCleanupWorker(options: { pollMs?: number; onError?: (err: unknown) => void } = {}) {
  let stopped = false;
  let running = false;
  const pollMs = options.pollMs ?? CLEANUP_POLL_MS;
  const tick = async () => {
    if (stopped || running) return;
    running = true;
    try { await runCleanupOnce(); } catch (err) { options.onError?.(err); }
    finally { running = false; }
  };
  const timer = setInterval(() => void tick(), pollMs);
  timer.unref?.();
  void tick();
  return { stop: async () => { stopped = true; clearInterval(timer); } };
}
