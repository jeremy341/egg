import { and, eq, isNull, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { audit } from "@/server/audit";
import { config } from "@/server/config";
import { newId, open, seal } from "@/server/crypto";
import { getDb, schema } from "@/server/db";
import { HttpError, notFound } from "@/server/http";
import { terminals } from "@/server/terminal";
import { NestSession, SshError } from "@/server/ssh/connection";
import { generateServerKey } from "@/server/ssh/keys";
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
    status: "pending",
    createdAt: new Date(),
  });
  return getServerForUser(userId, id);
}

/** Replace the key. The old one stops working once removed in the dashboard. */
export async function rotateServerKey(userId: string, serverId: string) {
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
  const server = await getServerForUser(userId, serverId);
  // Root shells opened with this server's key must not outlive the key.
  await terminals().closeAllForUser(userId, "disabled", { serverId: server.id });
  const db = await getDb();
  const projects = await db
    .select({ id: schema.projects.id })
    .from(schema.projects)
    .where(eq(schema.projects.serverId, server.id));
  const deleteProjects = options.deleteProjects === true;

  if (deleteProjects || projects.length === 0) {
    // Foreign keys remove the projects, deployments, logs, domains and samples with it.
    await db.delete(schema.servers).where(eq(schema.servers.id, server.id));
  } else {
    // The projects need the record to point at. Drop the key and the pinned host,
    // so nothing can connect until the account is connected again.
    await db
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
      .where(eq(schema.servers.id, server.id));
  }
  await audit(userId, "server.disconnect", null, {
    server: server.nestUsername,
    projectsDeleted: deleteProjects ? projects.length : 0,
    projectsKept: deleteProjects ? 0 : projects.length,
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
  opts: { confirmHostKey?: string } = {}
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
  const session = await NestSession.connect({
    host: server.host,
    port: server.port,
    username: server.nestUsername,
    privateKey,
    pinnedHostKey: pinned ?? opts.confirmHostKey,
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
  fn: (session: NestSession) => Promise<T>
): Promise<T> {
  const session = await connectToServer(server);
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

    const session = await connectToServer(server, { confirmHostKey: opts.confirmHostKey });
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
    const error = err instanceof SshError ? err : null;
    const message = error?.message ?? "Could not connect to Nest.";
    await db
      .update(schema.servers)
      .set({ status: "error", lastError: message, lastCheckedAt: new Date() })
      .where(eq(schema.servers.id, server.id));
    return { ok: false, error: message, kind: error?.kind ?? "unknown" };
  }
}
