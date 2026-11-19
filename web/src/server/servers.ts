import { and, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { audit } from "@/server/audit";
import { config } from "@/server/config";
import { newId, open, seal } from "@/server/crypto";
import { getDb, schema, type Db } from "@/server/db";
import { HttpError, notFound } from "@/server/http";
import { terminals } from "@/server/terminal";
import { NestSession, SshError } from "@/server/ssh/connection";
import { generateServerKey } from "@/server/ssh/keys";
import { assertNoAccountCleanup, assertNoServerCleanup } from "@/server/cleanup-guards";
import { forgetDeliveriesForDeployments } from "@/server/webhooks";
import { DEFAULT_CONTAINER_BUILD_MEMORY_MB } from "@/lib/build-memory";
import {
  probeIssues,
  probeSession,
  type NestProbe,
  type ProbeIssue,
} from "@/server/ssh/probe";

export type ServerRow = typeof schema.servers.$inferSelect;

export const MAX_SERVERS_PER_USER = 5;

const NEST_USERNAME = /^[a-z0-9][a-z0-9._-]{0,31}$/i;

export function validateNestUsername(value: string): string {
  const v = value.trim();
  if (!NEST_USERNAME.test(v)) {
    throw new HttpError(
      400,
      "That does not look like a Nest username. Use the name you log in with, for example sam-r.",
      "validation"
    );
  }
  return v;
}

/** Public view of a server: never includes key material beyond the public key. */
export function publicServer(row: ServerRow) {
  return {
    id: row.id,
    nestUsername: row.nestUsername,
    host: row.host,
    publicKey: row.publicKey,
    keyFingerprint: row.keyFingerprint,
    hostKeyFingerprint: row.hostKeyFingerprint,
    status: row.status,
    lastError: row.lastError,
    probe: row.probe ? (JSON.parse(row.probe) as NestProbe) : null,
    issues: row.probe ? probeIssues(JSON.parse(row.probe) as NestProbe) : [],
    lastCheckedAt: row.lastCheckedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function listServers(userId: string) {
  const db = await getDb();
  return db
    .select()
    .from(schema.servers)
    .where(and(eq(schema.servers.userId, userId), ne(schema.servers.status, "disconnected")))
    .orderBy(schema.servers.createdAt);
}

/** Load a server only if it belongs to the user. */
export async function getServerForUser(userId: string, serverId: string) {
  const db = await getDb();
  const row = await db
    .select()
    .from(schema.servers)
    .where(and(eq(schema.servers.id, serverId), eq(schema.servers.userId, userId)))
    .get();
  if (!row) throw notFound("Server not found");
  return row;
}

export async function createServer(
  userId: string,
  nestUsername: string,
  /** Tests point this at a mock SSH server. The API never passes it. */
  target?: { host: string; port: number }
) {
  const username = validateNestUsername(nestUsername);
  await assertNoAccountCleanup(userId);
  const db = await getDb();

  const mine = await listServers(userId);
  if (mine.length >= MAX_SERVERS_PER_USER) {
    throw new HttpError(
      400,
      `You can connect up to ${MAX_SERVERS_PER_USER} servers.`,
      "limit"
    );
  }
  if (mine.some((s) => s.nestUsername.toLowerCase() === username.toLowerCase())) {
    throw new HttpError(409, `${username} is already connected.`, "conflict");
  }

  const key = generateServerKey(`egg:${username}`);
  const c = config();

  // A disconnected account that kept its projects comes back as the same server, so they reattach.
  const kept = await db
    .select()
    .from(schema.servers)
    .where(
      and(
        eq(schema.servers.userId, userId),
        eq(schema.servers.status, "disconnected"),
        sql`lower(${schema.servers.nestUsername}) = ${username.toLowerCase()}`
      )
    )
    .get();
  if (kept) {
    await db
      .update(schema.servers)
      .set({
        nestUsername: username,
        host: target?.host ?? c.NEST_HOST,
        port: target?.port ?? c.NEST_PORT,
        publicKey: key.publicKey,
        privateKeyEnc: seal(key.privateKey, `server:${kept.id}`),
        keyFingerprint: key.fingerprint,
        hostKeyFingerprint: null,
        status: "pending",
        lastError: null,
        probe: null,
      })
      .where(eq(schema.servers.id, kept.id));
    return getServerForUser(userId, kept.id);
  }

  const id = newId();
  await db.insert(schema.servers).values({
    id,
    userId,
    nestUsername: username,
    host: target?.host ?? c.NEST_HOST,
    port: target?.port ?? c.NEST_PORT,
    publicKey: key.publicKey,
    privateKeyEnc: seal(key.privateKey, `server:${id}`),
    keyFingerprint: key.fingerprint,
    buildMemoryMb: DEFAULT_CONTAINER_BUILD_MEMORY_MB,
    status: "pending",
    createdAt: new Date(),
  });
  return getServerForUser(userId, id);
}

/** Replace the key. The old one stops working once removed in the dashboard. */
export async function rotateServerKey(userId: string, serverId: string) {
  await assertNoServerCleanup(userId, serverId, true);
  const server = await getServerForUser(userId, serverId);
  const key = generateServerKey(`egg:${server.nestUsername}`);
  const db = await getDb();
  await db
    .update(schema.servers)
    .set({
      publicKey: key.publicKey,
      privateKeyEnc: seal(key.privateKey, `server:${server.id}`),
      keyFingerprint: key.fingerprint,
      status: "pending",
      lastError: null,
      probe: null,
    })
    .where(eq(schema.servers.id, server.id));
  await audit(userId, "server.rotate_key", null, { server: server.nestUsername });
  return getServerForUser(userId, serverId);
}

/** What the owner chose in the disconnect confirmation. Keeping the projects is the default. */
export const disconnectBody = z.object({ deleteProjects: z.boolean().default(false) });

/**
 * Disconnect a server. Terminals opened with its key close and Egg's key is
 * removed either way. The projects are the owner's call: by default they are
 * kept, still tied to the server record, and stop being managed until the
 * same Nest account is connected again. With `deleteProjects` they, their
 * deployments and logs are removed along with the server record.
 */
export async function deleteServer(
  userId: string,
  serverId: string,
  options: { deleteProjects?: boolean } = {}
) {
  await assertNoServerCleanup(userId, serverId);
  const server = await getServerForUser(userId, serverId);
  const db = await getDb();
  const deleteProjects = options.deleteProjects === true;
  let projectCount = 0;
  // What must hold for a disconnect, checked twice: once before any terminal
  // is closed, then alongside the destructive write. A refused disconnect
  // leaves the user's terminals alone; a cleanup that starts while the
  // terminal manager runs still aborts the write, keeping its keys and records.
  const assertDisconnectAllowed = async (
    tx: Db | Parameters<Parameters<Db["transaction"]>[0]>[0]
  ) => {
    const current = await tx.select({ status: schema.servers.status }).from(schema.servers)
      .where(and(eq(schema.servers.id, server.id), eq(schema.servers.userId, userId))).get();
    if (!current) throw notFound("Server not found");
    const adoption = await tx.select({ id: schema.adoptionPlans.id }).from(schema.adoptionPlans)
      .innerJoin(schema.projects, eq(schema.projects.id, schema.adoptionPlans.projectId))
      .where(and(eq(schema.projects.serverId, server.id), eq(schema.adoptionPlans.state, "executing"))).get();
    if (adoption) throw new HttpError(409, "An app cutover is in progress on this server.", "adoption_in_progress");
    const cleanup = await tx.select({ id: schema.cleanupJobs.id }).from(schema.cleanupJobs)
      .leftJoin(schema.cleanupItems, eq(schema.cleanupItems.cleanupJobId, schema.cleanupJobs.id))
      .where(and(eq(schema.cleanupJobs.userId, userId), inArray(schema.cleanupJobs.state, ["draining", "running", "failed"]),
        sql`(${schema.cleanupJobs.scope} = 'account' or ${schema.cleanupItems.serverId} = ${server.id})`)).get();
    if (cleanup) throw new HttpError(409, "Cleanup is in progress for this server. Remote access is temporarily paused.", "cleanup_in_progress");
    const operation = await tx.select({ id: schema.cleanupOperations.id }).from(schema.cleanupOperations)
      .where(eq(schema.cleanupOperations.serverId, server.id)).get();
    if (operation) throw new HttpError(409, "An SSH operation is still open on this server. Wait for it to finish before disconnecting.", "remote_operation_active");
    const projects = await tx.select({ id: schema.projects.id }).from(schema.projects)
      .where(eq(schema.projects.serverId, server.id));
    projectCount = projects.length;
    return projects;
  };
  await assertDisconnectAllowed(db);
  // Root shells opened with this server's key must not outlive the key.
  await terminals().closeAllForUser(userId, "disabled", { serverId: server.id });
  // Deleting the projects deletes their deployments with them, so the server
  // gets the same work guard as a per-project delete: a queued, building or
  // deploying deployment, or a job still running, blocks it.
  const assertNoServerWork = async (tx: Db | Parameters<Parameters<Db["transaction"]>[0]>[0]) => {
    const active = await tx.select({ id: schema.deployments.id }).from(schema.deployments)
      .innerJoin(schema.projects, eq(schema.projects.id, schema.deployments.projectId))
      .where(and(eq(schema.projects.serverId, server.id), inArray(schema.deployments.state, ["queued", "building", "deploying"]))).get();
    if (active) throw new HttpError(409, "A deployment is queued or running on this server. Wait for it to finish or cancel it first.", "deployment_active");
    const job = await tx.select({ id: schema.jobs.id }).from(schema.jobs)
      .innerJoin(schema.deployments, eq(schema.deployments.id, schema.jobs.deploymentId))
      .innerJoin(schema.projects, eq(schema.projects.id, schema.deployments.projectId))
      .where(and(eq(schema.projects.serverId, server.id), eq(schema.jobs.state, "running"))).get();
    if (job) throw new HttpError(409, "A deployment job is still running on this server. Check the project page before disconnecting.", "job_active");
  };
  await db.transaction(async (tx) => {
    const projects = await assertDisconnectAllowed(tx);
    if (deleteProjects && projects.length > 0) await assertNoServerWork(tx);
    if (deleteProjects || projects.length === 0) {
      const deployments = await tx
        .select({ id: schema.deployments.id })
        .from(schema.deployments)
        .innerJoin(schema.projects, eq(schema.projects.id, schema.deployments.projectId))
        .where(eq(schema.projects.serverId, server.id));
      // Foreign keys remove the projects, deployments, logs, domains and samples with it.
      await tx.delete(schema.servers).where(and(eq(schema.servers.id, server.id), eq(schema.servers.userId, userId)));
      // Delivery history survives the cascade, so links to the deleted deployments are forgotten.
      await forgetDeliveriesForDeployments(tx, deployments.map((d) => d.id));
    } else {
      // The projects need the record to point at. Drop the key and the pinned host,
      // so nothing can connect until the account is connected again.
      await tx
        .update(schema.servers)
        .set({
          status: "disconnected",
          publicKey: "",
          keyFingerprint: "",
          privateKeyEnc: seal("removed", `server:${server.id}`),
          hostKeyFingerprint: null,
          lastError: null,
          probe: null,
        })
        .where(and(eq(schema.servers.id, server.id), eq(schema.servers.userId, userId)));
    }
  });
  await audit(userId, "server.disconnect", null, {
    server: server.nestUsername,
    projectsDeleted: deleteProjects ? projectCount : 0,
    projectsKept: deleteProjects ? 0 : projectCount,
  });
}

/** A SHA256 host key fingerprint as `ssh-keygen -l` prints it. */
export const HOST_KEY_FINGERPRINT = /^SHA256:[A-Za-z0-9+/]{43}$/;

/**
 * Open an SSH session using the stored key and pinned host key. A server whose
 * host key has not been confirmed has no pinned key, and nothing connects to it
 * until the owner has confirmed the fingerprint: `confirmHostKey` is that
 * fingerprint, as the owner saw it. The connection must present exactly that key,
 * and only then is it recorded. Without a confirmation an unpinned server is
 * refused, so a deploy, a file change or a shell can never be the first
 * connection that trusts whatever answered.
 */
export async function connectToServer(
  server: ServerRow,
  opts: { confirmHostKey?: string; allowDuringCleanup?: boolean; cleanupExecutor?: boolean; adoptionExecutor?: boolean } = {}
): Promise<NestSession> {
  if (server.status === "disconnected") {
    throw new HttpError(
      409,
      `${server.nestUsername} is disconnected. Connect it again to manage its projects.`,
      "disconnected"
    );
  }
  const pinned = server.hostKeyFingerprint;
  if (!pinned && !opts.confirmHostKey) {
    throw new HttpError(
      409,
      "Confirm host key: open the Connect page, check the fingerprint of this server and confirm it first.",
      "host_key_unconfirmed"
    );
  }
  const privateKey = open(server.privateKeyEnc, `server:${server.id}`);
  const db = await getDb();
  const operationId = opts.cleanupExecutor ? null : newId();
  if (operationId) {
    // SQLite may reject competing write transactions immediately. The cleanup
    // check and reservation must remain atomic, so retry only lock contention.
    for (let attempt = 0; ; attempt++) {
      try {
        await db.transaction(async (tx) => {
          const current = await tx.select({ status: schema.servers.status }).from(schema.servers)
            .where(and(eq(schema.servers.id, server.id), eq(schema.servers.userId, server.userId))).get();
          if (!current) throw notFound("Server not found");
          if (current.status === "disconnected") {
            throw new HttpError(
              409,
              `${server.nestUsername} is disconnected. Connect it again to manage its projects.`,
              "disconnected"
            );
          }
          if (!opts.adoptionExecutor) {
            const adoption = await tx.select({ id: schema.adoptionPlans.id }).from(schema.adoptionPlans)
              .innerJoin(schema.projects, eq(schema.projects.id, schema.adoptionPlans.projectId))
              .where(and(eq(schema.projects.serverId, server.id), eq(schema.adoptionPlans.state, "executing"))).get();
            if (adoption) throw new HttpError(409, "An app cutover is in progress on this server.", "adoption_in_progress");
          }
          if (!opts.allowDuringCleanup) {
            const active = await tx.select({ id: schema.cleanupJobs.id }).from(schema.cleanupJobs)
              .leftJoin(schema.cleanupItems, eq(schema.cleanupItems.cleanupJobId, schema.cleanupJobs.id))
              .where(and(eq(schema.cleanupJobs.userId, server.userId), sql`${schema.cleanupJobs.state} in ('draining', 'running', 'failed')`,
                sql`(${schema.cleanupJobs.scope} = 'account' or ${schema.cleanupItems.serverId} = ${server.id})`)).get();
            if (active) throw new HttpError(409, "Cleanup is in progress. Remote access is paused.", "cleanup_in_progress");
          }
          await tx.insert(schema.cleanupOperations).values({ id: operationId, userId: server.userId, serverId: server.id, openedAt: new Date() });
        });
        break;
      } catch (err) {
        if (attempt >= 49 || !(err instanceof Error) || !/SQLITE_BUSY|SQLITE_LOCKED/.test(err.message)) throw err;
        await new Promise((resolve) => setTimeout(resolve, 20 + attempt * 5));
      }
    }
  }
  let session: NestSession;
  try {
    session = await NestSession.connect({
    host: server.host,
    port: server.port,
    username: server.nestUsername,
    privateKey,
    pinnedHostKey: pinned ?? opts.confirmHostKey,
    });
  } catch (err) {
    if (operationId) await db.delete(schema.cleanupOperations).where(eq(schema.cleanupOperations.id, operationId));
    throw err;
  }
  if (operationId) session.onClosed(() => {
    void db.delete(schema.cleanupOperations).where(eq(schema.cleanupOperations.id, operationId)).catch(() => {});
  });
  if (!pinned && session.hostKeyFingerprint) {
    try {
      const db = await getDb();
      await db
        .update(schema.servers)
        .set({ hostKeyFingerprint: session.hostKeyFingerprint })
        .where(and(eq(schema.servers.id, server.id), isNull(schema.servers.hostKeyFingerprint)));
    } catch (err) {
      session.close();
      throw err;
    }
  }
  return session;
}

/** Run `fn` with a session and always close it. */
export async function withServerSession<T>(
  server: ServerRow,
  fn: (session: NestSession) => Promise<T>,
  opts: { allowDuringCleanup?: boolean; cleanupExecutor?: boolean } = {}
): Promise<T> {
  const session = await connectToServer(server, opts);
  try {
    return await fn(session);
  } finally {
    session.close();
  }
}

export type TestResult =
  | { ok: true; probe: NestProbe; issues: ProbeIssue[] }
  | { ok: false; error: string; kind: SshError["kind"] | "unknown" }
  /** First connection: the owner has to confirm `hostKey` before anything else is sent. */
  | { ok: false; error: string; kind: "host-key-unconfirmed"; hostKey: string };

/**
 * Connect, probe the container and save the outcome. The first time, the host
 * key is not trusted on sight: the call reaches the host, reports its
 * fingerprint and stops. The owner confirms it (the same call with
 * `confirmHostKey` set to what they saw) and only then is it pinned. Never
 * throws for connection problems; they are returned.
 */
export async function testServer(
  userId: string,
  serverId: string,
  opts: { confirmHostKey?: string } = {}
): Promise<TestResult> {
  const server = await getServerForUser(userId, serverId);
  if (server.status === "disconnected") {
    throw new HttpError(
      409,
      `${server.nestUsername} is disconnected. Connect it again to manage its projects.`,
      "disconnected"
    );
  }
  const db = await getDb();

  try {
    if (!server.hostKeyFingerprint && !opts.confirmHostKey) {
      // Look, do not trust: reach the host, read its key, hang up.
      const seen = await NestSession.connect({
        host: server.host,
        port: server.port,
        username: server.nestUsername,
        privateKey: open(server.privateKeyEnc, `server:${server.id}`),
      });
      seen.close();
      const message = "Confirm host key";
      await db
        .update(schema.servers)
        .set({ lastError: message, lastCheckedAt: new Date() })
        .where(eq(schema.servers.id, server.id));
      return { ok: false, error: message, kind: "host-key-unconfirmed", hostKey: seen.hostKeyFingerprint };
    }

    // A read-only probe is also how a failed cleanup's connection is repaired.
    const session = await connectToServer(server, { confirmHostKey: opts.confirmHostKey, allowDuringCleanup: true });
    try {
      const probe = await probeSession(session);
      const issues = probeIssues(probe);
      await db
        .update(schema.servers)
        .set({
          status: "connected",
          lastError: null,
          probe: JSON.stringify(probe),
          lastCheckedAt: new Date(),
          hostKeyFingerprint: server.hostKeyFingerprint ?? session.hostKeyFingerprint,
        })
        .where(eq(schema.servers.id, server.id));
      return { ok: true, probe, issues };
    } finally {
      session.close();
    }
  } catch (err) {
    // A policy refusal (a cutover in progress, cleanup) is not a connection
    // failure; recording it as one would flip the server to error state.
    if (err instanceof HttpError) throw err;
    const error = err instanceof SshError ? err : null;
    const message = error?.message ?? "Could not connect to Nest.";
    await db
      .update(schema.servers)
      .set({ status: "error", lastError: message, lastCheckedAt: new Date() })
      .where(eq(schema.servers.id, server.id));
    return { ok: false, error: message, kind: error?.kind ?? "unknown" };
  }
}
