import { and, eq } from "drizzle-orm";
import { audit } from "@/server/audit";
import { getDb, schema } from "@/server/db";
import { DEFAULT_UNIT_DIR, unitName } from "@/server/deploy/layout";
import { config } from "@/server/config";
import { removePreview, removeProject, runtimeLogs, startUnit } from "@/server/deploy/remote";
import { journalSince, type LogLevel, type LogRange } from "@/lib/log-filter";
import { decodeLogCursor, pageLogLines } from "@/lib/log-page";
import { HttpError } from "@/server/http";
import { getProjectForUser } from "@/server/projects";
import { getServerForUser, withServerSession } from "@/server/servers";
import { SshError } from "@/server/ssh/connection";
import { probeSession, type NestProbe } from "@/server/ssh/probe";

function logsUpstreamError(err: SshError): HttpError {
  switch (err.kind) {
    case "timeout":
      return new HttpError(
        504,
        "Timed out reading the logs. Your container may be stopped or starting; try again in a minute.",
        "upstream"
      );
    case "auth":
      return new HttpError(502, "Nest rejected the server's key, so the logs could not be read.", "upstream");
    case "host-key":
      return new HttpError(
        502,
        "The server's host key changed, so the logs were not read. Reconnect the server if you expected this.",
        "upstream"
      );
    default:
      return new HttpError(502, "Could not reach your container to read the logs. Try again in a minute.", "upstream");
  }
}

/** Live output of the production service, read from journald over SSH. */
export async function fetchRuntimeLogs(
  userId: string,
  projectId: string,
  lines = 200,
  search = "",
  filter: { range?: LogRange; level?: LogLevel } = {}
) {
  return (await fetchRuntimeLogPage(userId, projectId, lines, search, filter)).lines;
}

/**
 * The same read as `fetchRuntimeLogs`, plus `older`: a cursor for the lines
 * before these (null when the journal has none). Passing `before` (a cursor from
 * an earlier answer) reads the page that ends where that cursor starts. A cursor
 * that is not valid is a 400.
 */
export async function fetchRuntimeLogPage(
  userId: string,
  projectId: string,
  lines = 200,
  search = "",
  filter: { range?: LogRange; level?: LogLevel; before?: string | null } = {}
): Promise<{ lines: string[]; older: string | null }> {
  const cursor = filter.before ? decodeLogCursor(filter.before) : null;
  if (filter.before && !cursor) throw new HttpError(400, "That cursor is not valid.", "bad_cursor");
  const project = await getProjectForUser(userId, projectId);
  const server = await getServerForUser(userId, project.serverId);
  const q = search.trim().toLowerCase().slice(0, 200);
  // A search looks through the largest window the server will hand over, so
  // matches are not limited to the few lines the page already shows.
  // The level filter reads the same wide window, so the lines it keeps are not
  // limited to the warnings among the newest few.
  const level = filter.level ?? "all";
  const window = q || level !== "all" ? 1000 : lines;
  // The lines of the cursor's second that were already shown are read again and dropped.
  const asked = Math.max(1, Math.min(window + (cursor?.skip ?? 0), 1000));
  const since = filter.range ? journalSince(filter.range) : undefined;
  let res;
  try {
    res = await withServerSession(server, (s) =>
      s.script(runtimeLogs(unitName(project.slug), asked, since, cursor ? cursor.at + 1 : undefined), {
        timeoutMs: 30_000,
      })
    );
  } catch (err) {
    // An SSH failure is the container's side, not ours: say so plainly and
    // keep the raw socket detail out of the message.
    if (err instanceof SshError) throw logsUpstreamError(err);
    throw err;
  }
  if (res.code !== 0) {
    throw new HttpError(502, "Could not read the logs from your container.", "upstream");
  }
  return pageLogLines(
    res.stdout.split(/\r?\n/).filter((l) => l.length > 0),
    { lines, asked, q, level, cursor }
  );
}

/** Restart the production service without building anything. */
export async function restartService(userId: string, projectId: string) {
  const project = await getProjectForUser(userId, projectId);
  const server = await getServerForUser(userId, project.serverId);
  const res = await withServerSession(server, (s) =>
    s.script(startUnit(unitName(project.slug)), { timeoutMs: 30_000 })
  );
  if (res.code !== 0) {
    throw new HttpError(502, "Could not restart the service. It may not be deployed yet.", "upstream");
  }
  await audit(userId, "project.restart", project.id);
}

export type Usage = {
  cpuLoad: number | null;
  cpus: number | null;
  memUsedMb: number | null;
  memTotalMb: number | null;
  diskUsedMb: number | null;
  diskTotalMb: number | null;
  checkedAt: string;
};

export function usageFromProbe(p: NestProbe, at = new Date()): Usage {
  return {
    cpuLoad: p.load1,
    cpus: p.cpus,
    memUsedMb: p.memUsedMb,
    memTotalMb: p.memTotalMb,
    diskUsedMb: p.diskUsedMb,
    diskTotalMb: p.diskTotalMb,
    checkedAt: at.toISOString(),
  };
}

/** Read fresh numbers from the container and remember them. */
export async function fetchUsage(userId: string, serverId: string): Promise<Usage> {
  const server = await getServerForUser(userId, serverId);
  const probe = await withServerSession(server, probeSession);
  const db = await getDb();
  await db
    .update(schema.servers)
    .set({ probe: JSON.stringify(probe), lastCheckedAt: new Date(), status: "connected", lastError: null })
    .where(eq(schema.servers.id, server.id));
  return usageFromProbe(probe);
}

/**
 * Stop the service and delete the project's releases from the server. Previews
 * go too. `deleteData` also removes the shared data folder, so it is opt-in.
 */
export async function removeProjectFromServer(
  userId: string,
  projectId: string,
  options: { deleteData?: boolean; unitDir?: string } = {}
) {
  const project = await getProjectForUser(userId, projectId);
  const server = await getServerForUser(userId, project.serverId);
  // Same source as the deploy pipeline, so a removal looks where the unit was installed.
  const unitDir = options.unitDir ?? (config().UNIT_DIR || DEFAULT_UNIT_DIR);
  const db = await getDb();

  const previews = await db
    .select()
    .from(schema.deployments)
    .where(
      and(
        eq(schema.deployments.projectId, project.id),
        eq(schema.deployments.env, "preview"),
        eq(schema.deployments.cleanedUp, false)
      )
    );

  await withServerSession(server, async (s) => {
    const probe = await probeSession(s);
    for (const p of previews) {
      await s.script(
        removePreview({
          home: probe.home,
          slug: project.slug,
          releaseId: p.releaseId,
          unit: unitName(project.slug, { releaseId: p.releaseId }),
          unitDir,
        }),
        { timeoutMs: 60_000 }
      );
    }
    const res = await s.script(
      removeProject({
        home: probe.home,
        slug: project.slug,
        unit: unitName(project.slug),
        unitDir,
        deleteData: options.deleteData ?? false,
      }),
      { timeoutMs: 60_000 }
    );
    if (res.code !== 0) {
      throw new HttpError(502, "Could not remove the project from your container.", "upstream");
    }
  });

  await db
    .update(schema.deployments)
    .set({ cleanedUp: true })
    .where(eq(schema.deployments.projectId, project.id));
}
