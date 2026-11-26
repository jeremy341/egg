import { shellQuote } from "@/server/ssh/connection";
import { toOnCalendar, type Schedule } from "@/lib/cron-schedule";
import { SH_MARKER_HELPERS, UNIT_MARKER, UNIT_PREFIX, currentLink } from "@/server/deploy/layout";
import { NOT_OURS_EXIT, journalTail, removeOwnUnit, systemdEscape } from "@/server/deploy/remote";

/**
 * Scheduled jobs on the container: a systemd timer starts a oneshot service,
 * which runs the command inside the project's current release.
 *
 * Both unit files carry the same ownership marker as the app's service, so a
 * job never replaces a unit someone else wrote and is removed with the project.
 * Every interpolated value is shell-quoted, the schedule reaches the file only
 * as digits and day names (see toOnCalendar), and the command is escaped for
 * systemd the way the app's start command is.
 */

const HEAD = "set -euo pipefail\n";

/** Exit code when the project has no release yet, so there is nothing to run a job in. */
export const NO_RELEASE_EXIT = 31;
/** Exit code when the job's service is not installed on the container. */
export const NOT_INSTALLED_EXIT = 32;

/** A job runs for at most this long before systemd stops it. */
export const JOB_TIMEOUT_SECONDS = 30 * 60;

export const JOB_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The two unit names for a job. The short id keeps them readable and the marker keeps them safe. */
export function jobUnits(slug: string, jobId: string) {
  if (!JOB_ID.test(jobId)) throw new Error("Not a job id.");
  const base = `${UNIT_PREFIX}${slug}-job-${jobId.slice(0, 8)}`;
  return { service: `${base}.service`, timer: `${base}.timer` };
}

/** A name that is safe to put in a unit's description. */
export const JOB_NAME = /^[A-Za-z0-9][A-Za-z0-9 ._-]{0,59}$/;

export function jobServiceFile(args: {
  slug: string;
  jobId: string;
  name: string;
  home: string;
  command: string;
  /** Extra PATH entries, such as the Python venv. */
  pathPrefix?: string;
}) {
  const link = currentLink(args.home, args.slug);
  const path = args.pathPrefix
    ? `Environment=PATH=${args.pathPrefix}:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin\n`
    : "";
  return (
    `${UNIT_MARKER} project=${args.slug} job=${args.jobId}\n` +
    `[Unit]\nDescription=Egg job: ${args.name} (${args.slug})\nAfter=network.target\n\n` +
    `[Service]\nType=oneshot\nWorkingDirectory=${link}\n` +
    // The same variables the app runs with. The dash keeps a missing file from failing the job.
    `EnvironmentFile=-${link}/.env\nEnvironment=NODE_ENV=production\n` +
    path +
    `ExecStart=/bin/bash -lc ${JSON.stringify(systemdEscape(args.command))}\n` +
    `TimeoutStartSec=${JOB_TIMEOUT_SECONDS}\n` +
    // A job gives way to the app: lower priority, and first in line for the out-of-memory killer.
    `Nice=10\nOOMScoreAdjust=500\n`
  );
}

export function jobTimerFile(args: { slug: string; jobId: string; name: string; schedule: Schedule }) {
  const { service } = jobUnits(args.slug, args.jobId);
  return (
    `${UNIT_MARKER} project=${args.slug} job=${args.jobId}\n` +
    `[Unit]\nDescription=Egg schedule: ${args.name} (${args.slug})\n\n` +
    // Persistent=false: after downtime the job waits for its next time instead of running a backlog.
    `[Timer]\nOnCalendar=${toOnCalendar(args.schedule)}\nPersistent=false\nAccuracySec=10s\nUnit=${service}\n\n` +
    `[Install]\nWantedBy=timers.target\n`
  );
}

/**
 * Write both unit files and start the timer (or leave it stopped for a paused
 * job). Exit 31 when the project has no release, 30 when a unit by that name
 * exists and is not ours. Running it again for the same job replaces its files.
 */
export function installJob(args: {
  home: string;
  slug: string;
  jobId: string;
  unitDir: string;
  serviceFile: string;
  timerFile: string;
  enabled: boolean;
}) {
  const { service, timer } = jobUnits(args.slug, args.jobId);
  const guard = (unit: string) => {
    const f = shellQuote(`${args.unitDir}/${unit}`);
    return `if { [ -e ${f} ] || [ -L ${f} ]; } && ! egg_unit_marked ${f}; then echo ${shellQuote(`${unit} already exists and was not created by Egg, so it was left alone.`)} >&2; exit ${NOT_OURS_EXIT}; fi\n`;
  };
  const link = shellQuote(currentLink(args.home, args.slug));
  return (
    HEAD +
    SH_MARKER_HELPERS +
    `[ -d ${link} ] || { echo "Deploy the project once before adding a job: there is nothing to run it in yet." >&2; exit ${NO_RELEASE_EXIT}; }\n` +
    guard(service) +
    guard(timer) +
    `printf '%s' ${shellQuote(args.serviceFile)} > ${shellQuote(`${args.unitDir}/${service}`)}\n` +
    `printf '%s' ${shellQuote(args.timerFile)} > ${shellQuote(`${args.unitDir}/${timer}`)}\n` +
    `systemctl daemon-reload\n` +
    (args.enabled
      ? `systemctl enable ${shellQuote(timer)} --now >/dev/null 2>&1\n`
      : `systemctl disable ${shellQuote(timer)} --now >/dev/null 2>&1 || true\n`) +
    `echo "Installed ${timer}"\n`
  );
}

/** Stop and delete both units, but only ones that carry our marker. */
export function removeJob(args: { slug: string; jobId: string; unitDir: string }) {
  const { service, timer } = jobUnits(args.slug, args.jobId);
  return (
    SH_MARKER_HELPERS +
    // The timer first, so nothing starts the service again while it is being removed.
    removeOwnUnit(args.unitDir, timer) +
    removeOwnUnit(args.unitDir, service) +
    `true\n`
  );
}

/** Stop and delete these units, but only ones that carry our marker. Pass timers before their services. */
export function removeUnits(unitDir: string, units: string[]) {
  return SH_MARKER_HELPERS + units.map((u) => removeOwnUnit(unitDir, u)).join("") + `true
`;
}

/** Start the job once now, without waiting for it to finish. */
export function runJobNow(args: { slug: string; jobId: string; unitDir: string }) {
  const { service } = jobUnits(args.slug, args.jobId);
  const f = shellQuote(`${args.unitDir}/${service}`);
  return (
    HEAD +
    SH_MARKER_HELPERS +
    `egg_unit_marked ${f} || { echo "That job is not installed on the container." >&2; exit ${NOT_INSTALLED_EXIT}; }\n` +
    `systemctl start ${shellQuote(service)} --no-block\n` +
    `echo "Started ${service}"\n`
  );
}

/**
 * Print how each job is doing as J<n>_<Key>=value lines, where n is the
 * position in `jobs`. Reads only. The last run's end time comes out as epoch
 * seconds (J<n>_LastEnd) so the app does not have to parse systemd's date text.
 */
export function jobStatus(args: { slug: string; jobIds: string[] }) {
  return (
    args.jobIds
      .map((jobId, n) => {
        const { service, timer } = jobUnits(args.slug, jobId);
        const s = shellQuote(service);
        const t = shellQuote(timer);
        return (
          `systemctl show ${s} -p LoadState -p ActiveState -p Result -p ExecMainStatus 2>/dev/null | sed 's/^/J${n}_/' || true\n` +
          `systemctl show ${t} -p ActiveState 2>/dev/null | sed 's/^/J${n}_Timer/' || true\n` +
          `end=$(systemctl show ${s} -p ExecMainExitTimestamp 2>/dev/null | grep '^ExecMainExitTimestamp=' | head -n 1 | cut -d= -f2- || true)\n` +
          `if [ -n "$end" ] && [ "$end" != "n/a" ]; then echo "J${n}_LastEnd=$(date -d "$end" +%s 2>/dev/null || true)"; fi\n`
        );
      })
      .join("") + `true\n`
  );
}

/** The job's recent output from the journal. */
export function jobLogs(args: { slug: string; jobId: string; lines: number }) {
  return journalTail(jobUnits(args.slug, args.jobId).service, Math.max(1, Math.min(args.lines, 500)));
}
