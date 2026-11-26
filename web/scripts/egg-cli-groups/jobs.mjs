import { readFile } from "node:fs/promises";

// CLI group "jobs". Each export is consumed by web/scripts/egg-cli.mjs.
// commands: registry entries { name, args, options?, required?, description, runner }.
// runners: async (nest, args, flags, out, deps, fail, kit) => void.
export const commands = [
  { name: "job list", args: ["project"], description: "List scheduled jobs in one project.", runner: "jobList" },
  { name: "job get", args: ["project", "job-id"], description: "Show one scheduled job.", runner: "jobGet" },
  {
    name: "job create",
    args: ["project"],
    required: ["name", "steps"],
    options: ["name", "cron", "description", "timezone", "concurrency", "paused", "steps"],
    description: "Create a scheduled job from one command step.",
    runner: "jobCreate",
  },
  {
    name: "job update",
    args: ["project", "job-id"],
    options: ["name", "cron", "description", "concurrency", "paused"],
    description: "Change supported scheduled-job settings.",
    runner: "jobUpdate",
  },
  {
    name: "job delete",
    args: ["project", "job-id"],
    required: ["confirm"],
    options: ["confirm"],
    description: "Delete a scheduled job after confirming its exact name.",
    runner: "jobDelete",
  },
  {
    name: "job steps set",
    args: ["project", "job-id"],
    required: ["file"],
    options: ["file"],
    description: "Replace a job's step definition from a JSON file.",
    runner: "jobStepsSet",
  },
  {
    name: "job run",
    args: ["project", "job-id"],
    required: ["confirm"],
    options: ["allow-concurrent", "wait", "timeout", "confirm"],
    description: "Start a scheduled job after confirming its exact name.",
    runner: "jobRun",
  },
  {
    name: "job runs",
    args: ["project", "job-id"],
    options: ["limit", "cursor", "all"],
    description: "Show the run status snapshot available for a job.",
    runner: "jobRuns",
  },
  {
    name: "job run get",
    args: ["project", "job-id", "run-id"],
    options: ["watch"],
    description: "Show one run's status.",
    runner: "jobRunGet",
  },
  {
    name: "job run cancel",
    args: ["project", "job-id", "run-id"],
    required: ["confirm"],
    options: ["confirm"],
    description: "Stop an active run after confirming its job name.",
    runner: "jobRunCancel",
  },
  {
    name: "job run logs",
    args: ["project", "job-id", "run-id"],
    options: ["step", "follow"],
    description: "Read the logs for one job run.",
    runner: "jobRunLogs",
  },
];

export const optionTypes = {
  cron: "value",
  description: "value",
  timezone: "value",
  concurrency: "value",
  paused: "flag",
  steps: "value",
  file: "value",
  "allow-concurrent": "flag",
  all: "flag",
  watch: "flag",
  step: "value",
};

async function resolveProjectId(nest, slugOrId, kit) {
  const { projects = [] } = await nest.listProjects();
  const found = projects.find((project) => project.slug === slugOrId) ?? projects.find((project) => project.id === slugOrId);
  if (!found) throw new kit.Failure(`No project with the slug or id "${slugOrId}".`);
  return found.id;
}

async function readSteps(file, option, kit) {
  let source;
  try {
    source = await readFile(file, "utf8");
  } catch {
    throw new kit.UsageError(`--${option} must point to a readable JSON file.`);
  }

  let value;
  try {
    value = JSON.parse(source);
  } catch {
    throw new kit.UsageError(`--${option} must contain valid JSON.`);
  }

  const steps = Array.isArray(value) ? value : value?.steps;
  if (!Array.isArray(steps)) throw new kit.UsageError(`--${option} must contain a JSON step list.`);
  if (steps.length === 0) throw new kit.UsageError(`--${option} must contain at least one step.`);
  return steps;
}

function rejectUnsupported(flags, names, kit) {
  const requested = names.filter((name) => flags[name] !== undefined && flags[name] !== false);
  if (requested.length > 0) {
    throw new kit.UsageError(`Egg does not support --${requested.join(", --")} for this job command.`);
  }
}

async function confirmJobName(nest, projectId, jobId, confirm, kit) {
  const data = await nest.getJob(projectId, jobId);
  const name = data?.job?.name;
  if (typeof name !== "string" || name.length === 0) throw new kit.Failure(`Could not read the name of job ${jobId}.`);
  if (confirm !== name) throw new kit.UsageError("--confirm must exactly match the target job's name.");
}

function printData(kit, data, flags, deps, out, format) {
  return kit.printData(data, flags, deps, out, format);
}

export const runners = {
  async jobList(nest, [slug], flags, out, deps, _fail, kit) {
    const data = await nest.listJobs(await resolveProjectId(nest, slug, kit));
    return printData(kit, data, flags, deps, out, (visible) => {
      const jobs = visible.jobs ?? [];
      return jobs.length === 0
        ? "No scheduled jobs.\n"
        : kit.table(["ID", "NAME", "SCHEDULE (UTC)", "ENABLED", "NEXT RUN"], jobs.map((job) => [
          job.id,
          kit.clean(job.name),
          kit.dash(job.schedule),
          job.enabled ? "yes" : "no",
          kit.dash(job.nextRunAt),
        ]));
    });
  },

  async jobGet(nest, [slug, jobId], flags, out, deps, _fail, kit) {
    const data = await nest.getJob(await resolveProjectId(nest, slug, kit), jobId);
    return printData(kit, data, flags, deps, out, (visible) => {
      const job = visible.job ?? visible;
      return [
        `Id        ${kit.clean(job.id ?? jobId)}`,
        `Name      ${kit.clean(job.name)}`,
        `Schedule  ${kit.dash(job.schedule)} (UTC)`,
        `Enabled   ${job.enabled ? "yes" : "no"}`,
        `Next run  ${kit.dash(job.nextRunAt)}`,
        `Command   ${kit.clean(job.command)}`,
        "",
      ].join("\n");
    });
  },

  async jobCreate(nest, [slug], flags, out, deps, _fail, kit) {
    rejectUnsupported(flags, ["description", "timezone", "concurrency"], kit);
    if (!flags.cron) throw new kit.UsageError("Egg requires --cron because it cannot create a manual-only job.");
    const steps = await readSteps(flags.steps, "steps", kit);
    if (steps.length !== 1 || typeof steps[0]?.command !== "string" || steps[0].command.length === 0) {
      throw new kit.UsageError("Egg can create a job with exactly one step containing a command.");
    }
    const data = await nest.createJob(await resolveProjectId(nest, slug, kit), {
      name: flags.name,
      schedule: flags.cron,
      command: steps[0].command,
      ...(flags.paused ? { enabled: false } : {}),
    });
    return printData(kit, data, flags, deps, out, (visible) => `Created scheduled job ${kit.clean(visible.job.name)} (${visible.job.id}).\n`);
  },

  async jobUpdate(nest, [slug, jobId], flags, out, deps, _fail, kit) {
    rejectUnsupported(flags, ["description", "concurrency"], kit);
    const changes = {};
    if (flags.name !== undefined) changes.name = flags.name;
    if (flags.cron !== undefined) changes.schedule = flags.cron;
    if (flags.paused) changes.enabled = false;
    if (Object.keys(changes).length === 0) throw new kit.UsageError("job update needs at least one supported field to change.");
    const data = await nest.updateJob(await resolveProjectId(nest, slug, kit), jobId, changes);
    return printData(kit, data, flags, deps, out, (visible) => `Updated scheduled job ${kit.clean(visible.job.name)}.\n`);
  },

  async jobDelete(nest, [slug, jobId], flags, out, deps, _fail, kit) {
    const projectId = await resolveProjectId(nest, slug, kit);
    await confirmJobName(nest, projectId, jobId, flags.confirm, kit);
    const data = await nest.deleteJob(projectId, jobId);
    return printData(kit, data, flags, deps, out, () => `Deleted scheduled job ${jobId}.\n`);
  },

  async jobStepsSet(nest, [slug, jobId], flags, out, deps, _fail, kit) {
    const steps = await readSteps(flags.file, "file", kit);
    if (steps.length !== 1 || typeof steps[0]?.command !== "string" || steps[0].command.length === 0) {
      throw new kit.UsageError("Egg can replace a job definition with exactly one step containing a command.");
    }
    const data = await nest.replaceJobSteps(await resolveProjectId(nest, slug, kit), jobId, { steps });
    return printData(kit, data, flags, deps, out, () => `Updated steps for job ${jobId}.\n`);
  },

  async jobRun(nest, [slug, jobId], flags, out, deps, _fail, kit) {
    rejectUnsupported(flags, ["allow-concurrent", "wait", "timeout"], kit);
    const projectId = await resolveProjectId(nest, slug, kit);
    await confirmJobName(nest, projectId, jobId, flags.confirm, kit);
    const data = await nest.runJob(projectId, jobId);
    return printData(kit, data, flags, deps, out, (visible) =>
      visible.started ? `Started scheduled job ${jobId}.\n` : `Scheduled job ${jobId} was not started.\n`);
  },

  async jobRuns(nest, [slug, jobId], flags, out, deps, _fail, kit) {
    rejectUnsupported(flags, ["limit", "cursor", "all"], kit);
    const data = await nest.listJobRuns(await resolveProjectId(nest, slug, kit), jobId);
    return printData(kit, data, flags, deps, out, (visible) => {
      const runs = visible.runs ?? [];
      return runs.length === 0
        ? `No status is available for job ${jobId}.\n`
        : kit.table(["STATE", "EXIT CODE", "LAST ENDED"], runs.map((run) => [
          kit.dash(run.state),
          kit.dash(run.exitCode),
          kit.dash(run.lastEndedAt),
        ]));
    });
  },

  async jobRunGet(nest, [slug, jobId, runId], flags, out, deps, _fail, kit) {
    rejectUnsupported(flags, ["watch"], kit);
    const data = await nest.getJobRun(await resolveProjectId(nest, slug, kit), jobId, runId);
    return printData(kit, data, flags, deps, out, (visible) => {
      const run = visible.run ?? visible;
      return [
        `Run       ${kit.clean(run.id ?? runId)}`,
        `State     ${kit.dash(run.state)}`,
        `Started   ${kit.dash(run.startedAt)}`,
        `Ended     ${kit.dash(run.endedAt)}`,
        `Exit code ${kit.dash(run.exitCode)}`,
        "",
      ].join("\n");
    });
  },

  async jobRunCancel(nest, [slug, jobId, runId], flags, out, deps, _fail, kit) {
    const projectId = await resolveProjectId(nest, slug, kit);
    await confirmJobName(nest, projectId, jobId, flags.confirm, kit);
    const data = await nest.cancelJobRun(projectId, jobId, runId);
    return printData(kit, data, flags, deps, out, () => `Cancelled run ${runId}.\n`);
  },

  async jobRunLogs(nest, [slug, jobId, runId], flags, out, deps, _fail, kit) {
    rejectUnsupported(flags, ["step", "follow"], kit);
    const data = await nest.getJobRunLogs(await resolveProjectId(nest, slug, kit), jobId, runId);
    return printData(kit, data, flags, deps, out, (visible) => {
      const lines = visible.lines ?? [];
      if (lines.length === 0) return `No output is available for run ${runId}.\n`;
      return `${lines.map((line) => kit.clean(typeof line === "string" ? line : line.message ?? line.line ?? JSON.stringify(line))).join("\n")}\n`;
    });
  },
};
