import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { describeSchedule, nextRun, parseSchedule, ScheduleError } from "@/lib/cron-schedule";
import { audit } from "@/server/audit";
import { config } from "@/server/config";
import { newId } from "@/server/crypto";
import { getDb, schema } from "@/server/db";
import { DEFAULT_UNIT_DIR, currentLink } from "@/server/deploy/layout";
import {
  JOB_NAME,
  JOB_TIMEOUT_SECONDS,
  NOT_INSTALLED_EXIT,
  NO_RELEASE_EXIT,
  installJob,
  jobLogs,
  jobServiceFile,
  jobStatus,
  jobTimerFile,
  jobUnits,
  removeJob,
  runJobNow,
} from "@/server/deploy/jobs-remote";
import { NOT_OURS_EXIT } from "@/server/deploy/remote";
import { HttpError, notFound } from "@/server/http";
import { getProjectForUser, type ProjectRow } from "@/server/projects";
import { getServerForUser, withServerSession } from "@/server/servers";
import { SshError, type NestSession } from "@/server/ssh/connection";
import { probeSession } from "@/server/ssh/probe";

/**
 * Scheduled jobs: commands a systemd timer runs inside the project's current
 * release on the container. The rows here are what the person asked for; how a
 * job is doing (its last run and result) is read from the container each time.
 */

export const MAX_JOBS_PER_PROJECT = 5;

const NO_CONTROL = /^[^\u0000-\u001f\u007f]*$/;

export const jobInput = z.object({
  name: z
    .string()
    .trim()
    .regex(JOB_NAME, "Use letters, numbers, spaces, dots, dashes and underscores, up to 60 characters."),
  schedule: z.string().trim().min(1).max(100),
  command: z
    .string()
    .trim()
    .min(1, "Enter the command to run.")
    .max(500, "Keep the command under 500 characters. Put longer scripts in a file in your repository.")
    .regex(NO_CONTROL, "The command must be a single line."),
  enabled: z.boolean().default(true),
});

export const jobPatch = jobInput.partial();

export type JobView = {
  id: string;
  name: string;
  schedule: string;
  /** The schedule in words, always in UTC. */
  description: string;
  command: string;
  enabled: boolean;
  /** The next time it should run, or null when paused. */
  nextRunAt: string | null;
  timeoutSeconds: number;
};

type JobRow = typeof schema.scheduledJobs.$inferSelect;

export function jobView(row: JobRow, now = new Date()): JobView {
  let description = row.schedule;
  let next: Date | null = null;
  try {
    const s = parseSchedule(row.schedule);
    description = describeSchedule(s);
    next = row.enabled ? nextRun(s, now) : null;
  } catch {
    // A stored schedule that no longer parses is shown as it is rather than hiding the job.
  }
  return {
    id: row.id,
    name: row.name,
    schedule: row.schedule,
    description,
    command: row.command,
    enabled: row.enabled,
    nextRunAt: next ? next.toISOString() : null,
    timeoutSeconds: JOB_TIMEOUT_SECONDS,
  };
}

function scheduleOrThrow(text: string) {
  try {
    return parseSchedule(text);
  } catch (err) {
    if (err instanceof ScheduleError) throw new HttpError(400, err.message, "validation");
    throw err;
  }
}

function unitDir() {
  return config().UNIT_DIR || DEFAULT_UNIT_DIR;
}

function upstream(err: SshError): HttpError {
  switch (err.kind) {
    case "timeout":
      return new HttpError(504, "Your container did not answer in time. It may be stopped or starting; try again in a minute.", "upstream");
    case "auth":
      return new HttpError(502, "Nest rejected the server's key.", "upstream");
    case "host-key":
      return new HttpError(502, "The server's host key changed, so nothing was sent. Reconnect the server if you expected this.", "upstream");
    default:
      return new HttpError(502, "Could not reach your container. Try again in a minute.", "upstream");
  }
}

async function onContainer<T>(
  userId: string,
  projectId: string,
  fn: (ctx: { project: ProjectRow; session: NestSession; home: string }) => Promise<T>
): Promise<T> {
  const project = await getProjectForUser(userId, projectId);
  const server = await getServerForUser(userId, project.serverId);
  try {
    return await withServerSession(server, async (session) => {
      const probe = await probeSession(session);
      return fn({ project, session, home: probe.home });
    });
  } catch (err) {
    if (err instanceof SshError) throw upstream(err);
    throw err;
  }
}

async function getJob(projectId: string, jobId: string): Promise<JobRow> {
  const db = await getDb();
  const row = await db
    .select()
    .from(schema.scheduledJobs)
    .where(and(eq(schema.scheduledJobs.id, jobId), eq(schema.scheduledJobs.projectId, projectId)))
    .get();
  if (!row) throw notFound("Job not found");
  return row;
}

export async function listJobs(userId: string, projectId: string): Promise<JobView[]> {
  const project = await getProjectForUser(userId, projectId);
  return jobViews(project.id);
}

export async function jobViews(projectId: string, now = new Date()): Promise<JobView[]> {
  const db = await getDb();
  const rows = await db
    .select()
    .from(schema.scheduledJobs)
    .where(eq(schema.scheduledJobs.projectId, projectId))
    .orderBy(asc(schema.scheduledJobs.createdAt));
  return rows.map((r) => jobView(r, now));
}

/** The units a project's jobs own on the container, for removing them with the project. */
export async function jobUnitNames(projectId: string, slug: string): Promise<string[]> {
  const db = await getDb();
  const rows = await db
    .select({ id: schema.scheduledJobs.id })
    .from(schema.scheduledJobs)
    .where(eq(schema.scheduledJobs.projectId, projectId));
  return rows.flatMap((r) => {
    const u = jobUnits(slug, r.id);
    return [u.timer, u.service];
  });
}

/** Write the job's units to the container and arm (or pause) its timer. */
async function install(
  userId: string,
  projectId: string,
  row: { id: string; name: string; schedule: string; command: string; enabled: boolean }
) {
  const schedule = scheduleOrThrow(row.schedule);
  await onContainer(userId, projectId, async ({ project, session, home }) => {
    const res = await session.script(
      installJob({
        home,
        slug: project.slug,
        jobId: row.id,
        unitDir: unitDir(),
        serviceFile: jobServiceFile({
          slug: project.slug,
          jobId: row.id,
          name: row.name,
          home,
          command: row.command,
          pathPrefix: project.runtime === "python" ? `${currentLink(home, project.slug)}/.venv/bin` : undefined,
        }),
        timerFile: jobTimerFile({ slug: project.slug, jobId: row.id, name: row.name, schedule }),
        enabled: row.enabled,
      }),
      { timeoutMs: 60_000 }
    );
    if (res.code === NO_RELEASE_EXIT) {
      throw new HttpError(409, "Deploy the project once first. A job runs inside the current release, and there is none yet.", "not_deployed");
    }
    if (res.code === NOT_OURS_EXIT) {
      throw new HttpError(409, "A service with that name already exists on your container and was not made by Egg, so it was left alone.", "not_ours");
    }
    if (res.code !== 0) {
      const detail = res.stderr.trim().split(/\r?\n/).pop()?.trim().slice(0, 200);
      throw new HttpError(502, `Could not set the job up on your container${detail ? `: ${detail}` : "."}`, "upstream");
    }
  });
}

export async function createJob(userId: string, projectId: string, raw: unknown): Promise<JobView> {
  const input = jobInput.parse(raw);
  const project = await getProjectForUser(userId, projectId);
  const db = await getDb();
  const existing = await db
    .select({ id: schema.scheduledJobs.id })
    .from(schema.scheduledJobs)
    .where(eq(schema.scheduledJobs.projectId, project.id));
  if (existing.length >= MAX_JOBS_PER_PROJECT) {
    throw new HttpError(409, `A project can have ${MAX_JOBS_PER_PROJECT} jobs. Remove one to add another.`, "limit");
  }
  const schedule = scheduleOrThrow(input.schedule);
  const now = new Date();
  const row: JobRow = {
    id: newId(),
    projectId: project.id,
    name: input.name,
    schedule: schedule.expression,
    command: input.command,
    enabled: input.enabled,
    createdAt: now,
    updatedAt: now,
  };
  await install(userId, project.id, row);
  try {
    await db.insert(schema.scheduledJobs).values(row);
  } catch (err) {
    // Do not leave a timer on the container that the dashboard does not know about.
    await onContainer(userId, project.id, ({ project: p, session }) =>
      session.script(removeJob({ slug: p.slug, jobId: row.id, unitDir: unitDir() }), { timeoutMs: 60_000 })
    ).catch(() => {});
    throw err;
  }
  await audit(userId, "job.create", project.id, { job: row.id, schedule: row.schedule });
  return jobView(row);
}

export async function updateJob(userId: string, projectId: string, jobId: string, raw: unknown): Promise<JobView> {
  const patch = jobPatch.parse(raw);
  const project = await getProjectForUser(userId, projectId);
  const current = await getJob(project.id, jobId);
  const next = {
    ...current,
    ...(patch.name !== undefined ? { name: patch.name } : {}),
    ...(patch.schedule !== undefined ? { schedule: scheduleOrThrow(patch.schedule).expression } : {}),
    ...(patch.command !== undefined ? { command: patch.command } : {}),
    ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
    updatedAt: new Date(),
  };
  await install(userId, project.id, next);
  const db = await getDb();
  await db
    .update(schema.scheduledJobs)
    .set({ name: next.name, schedule: next.schedule, command: next.command, enabled: next.enabled, updatedAt: next.updatedAt })
    .where(eq(schema.scheduledJobs.id, current.id));
  await audit(userId, "job.update", project.id, { job: current.id, enabled: next.enabled });
  return jobView(next);
}

export async function deleteJob(userId: string, projectId: string, jobId: string) {
  const project = await getProjectForUser(userId, projectId);
  const current = await getJob(project.id, jobId);
  await onContainer(userId, project.id, async ({ project: p, session }) => {
    const res = await session.script(removeJob({ slug: p.slug, jobId: current.id, unitDir: unitDir() }), { timeoutMs: 60_000 });
    if (res.code !== 0) throw new HttpError(502, "Could not remove the job from your container.", "upstream");
  });
  const db = await getDb();
  await db.delete(schema.scheduledJobs).where(eq(schema.scheduledJobs.id, current.id));
  await audit(userId, "job.delete", project.id, { job: current.id });
}

export async function runJob(userId: string, projectId: string, jobId: string) {
  const project = await getProjectForUser(userId, projectId);
  const current = await getJob(project.id, jobId);
  await onContainer(userId, project.id, async ({ project: p, session }) => {
    const res = await session.script(runJobNow({ slug: p.slug, jobId: current.id, unitDir: unitDir() }), { timeoutMs: 30_000 });
    if (res.code === NOT_INSTALLED_EXIT) {
      throw new HttpError(409, "That job is not on your container any more. Save it again to put it back.", "not_installed");
    }
    if (res.code !== 0) throw new HttpError(502, "Could not start the job.", "upstream");
  });
  await audit(userId, "job.run", project.id, { job: current.id });
}

export type JobState = "running" | "failed" | "ok" | "never" | "missing";

export type JobStatus = {
  id: string;
  state: JobState;
  /** The exit code of the last failed run. */
  exitCode: number | null;
  lastEndedAt: string | null;
  /** Whether the timer is armed on the container. */
  armed: boolean;
};

/** Read what systemd printed for each job (the J<n>_Key=value lines of jobStatus). */
export function parseJobStatuses(output: string, jobIds: string[]): JobStatus[] {
  const byJob: Record<string, string>[] = jobIds.map(() => ({}));
  for (const line of output.split(/\r?\n/)) {
    const m = /^J(\d+)_(\w+)=(.*)$/.exec(line.trim());
    if (!m) continue;
    const slot = byJob[Number(m[1])];
    if (slot) slot[m[2]] = m[3];
  }
  return jobIds.map((id, i) => {
    const v = byJob[i];
    const end = Number(v.LastEnd);
    const lastEndedAt = v.LastEnd && Number.isFinite(end) && end > 0 ? new Date(end * 1000).toISOString() : null;
    const exit = Number(v.ExecMainStatus);
    const failed = v.ActiveState === "failed" || (!!v.Result && v.Result !== "success");
    const state: JobState =
      v.LoadState !== "loaded"
        ? "missing"
        : v.ActiveState === "activating" || v.ActiveState === "active"
          ? "running"
          : failed
            ? "failed"
            : lastEndedAt
              ? "ok"
              : "never";
    return {
      id,
      state,
      exitCode: state === "failed" && Number.isFinite(exit) && exit > 0 ? exit : null,
      lastEndedAt,
      armed: v.TimerActiveState === "active",
    };
  });
}

/** How each of the project's jobs is doing right now, read from the container. */
export async function fetchJobStatuses(userId: string, projectId: string): Promise<JobStatus[]> {
  const project = await getProjectForUser(userId, projectId);
  const db = await getDb();
  const rows = await db
    .select({ id: schema.scheduledJobs.id })
    .from(schema.scheduledJobs)
    .where(eq(schema.scheduledJobs.projectId, project.id))
    .orderBy(asc(schema.scheduledJobs.createdAt));
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  return onContainer(userId, project.id, async ({ project: p, session }) => {
    const res = await session.script(jobStatus({ slug: p.slug, jobIds: ids }), { timeoutMs: 30_000 });
    if (res.code !== 0) throw new HttpError(502, "Could not read the jobs from your container.", "upstream");
    return parseJobStatuses(res.stdout, ids);
  });
}

/** The recent output of one job: what it printed on its last runs. */
export async function fetchJobLogs(userId: string, projectId: string, jobId: string): Promise<string[]> {
  const project = await getProjectForUser(userId, projectId);
  const current = await getJob(project.id, jobId);
  return onContainer(userId, project.id, async ({ project: p, session }) => {
    const res = await session.script(jobLogs({ slug: p.slug, jobId: current.id, lines: 120 }), { timeoutMs: 30_000 });
    if (res.code !== 0) throw new HttpError(502, "Could not read the job's output.", "upstream");
    return res.stdout.split(/\r?\n/).filter((l) => l.length > 0);
  });
}
